import { computed, DestroyRef, inject, Service, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  animationFrameScheduler,
  auditTime,
  connect,
  EMPTY,
  filter,
  map,
  merge,
  type Observable,
  Subject,
  switchMap,
  takeUntil,
  timer,
} from 'rxjs';
import { instrumentSymbols } from '../domain/instrument-symbols';
import type { InstrumentSnapshot } from '../domain/market-aggregator';
import type { ProducerEvent } from '../domain/producer-protocol';
import { DEFAULT_PRODUCER_SETTINGS, type ProducerSettings } from '../domain/producer-settings';
import { describeError } from '../shared/describe-error';
import { PRODUCER_TRANSPORT_FACTORY, type ProducerTransport } from './producer-transport';

/** How long a producer may take to confirm a run (loading Wasm included) before it is failed. */
export const PRODUCER_STARTUP_TIMEOUT_MS = 15_000;

export type ProducerStatus =
  | { readonly kind: 'starting'; readonly paused: boolean }
  | { readonly kind: 'running' }
  | { readonly kind: 'paused' }
  | { readonly kind: 'error'; readonly message: string };

/** One dashboard row: the instrument's symbol and its current metrics. */
export interface InstrumentRow extends InstrumentSnapshot {
  readonly symbol: string;
}

type Phase =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string };

type SnapshotEvent = Extract<ProducerEvent, { type: 'snapshot' }>;

interface ActiveRun {
  readonly id: number;
  readonly transport: ProducerTransport;
}

const UNAVAILABLE: InstrumentSnapshot = {
  lastPriceCents: null,
  lastTick: null,
  spreadCents: null,
  volume: 0,
  vwapCents: null,
  imbalance: null,
};

/**
 * Root service: one producer per app, surviving navigation. Events are read per run (`switchMap`),
 * so nothing from a replaced run, including a snapshot waiting for a frame, reaches state.
 */
@Service()
export class MarketDataStore {
  readonly #createTransport = inject(PRODUCER_TRANSPORT_FACTORY);
  /** The run whose events are applied; `null` when no producer could be created for it. */
  readonly #runs = new Subject<ActiveRun | null>();
  #transport: ProducerTransport | null = null;

  readonly #runId = signal(0);
  readonly #settings = signal<ProducerSettings>(DEFAULT_PRODUCER_SETTINGS);
  readonly #requested = signal<'running' | 'paused'>('running');
  readonly #phase = signal<Phase>({ kind: 'starting' });
  readonly #snapshot = signal<SnapshotEvent | null>(null);

  /** Id of the active run; 0 before the first run starts. */
  readonly runId = this.#runId.asReadonly();
  /** Settings of the active run (not the settings form's draft). */
  readonly settings = this.#settings.asReadonly();

  readonly status = computed<ProducerStatus>(() => {
    const phase = this.#phase();
    if (phase.kind === 'error') {
      return phase;
    }
    if (phase.kind === 'starting') {
      return { kind: 'starting', paused: this.#requested() === 'paused' };
    }
    return { kind: this.#requested() };
  });

  /** Whether the user asked the current run to pause, also while it is still starting. */
  readonly paused = computed(() => this.#requested() === 'paused');

  /** One row per instrument of the active run; rows exist, with unavailable values, before data. */
  readonly instruments = computed<readonly InstrumentRow[]>(() => {
    const snapshot = this.#snapshot();
    return instrumentSymbols(this.#settings().instrumentCount).map((symbol, index) => ({
      symbol,
      ...(snapshot?.instruments[index] ?? UNAVAILABLE),
    }));
  });

  /** Updates generated in the active run so far. */
  readonly totalUpdates = computed(() => this.#snapshot()?.totalUpdates ?? 0);

  constructor() {
    this.#runs
      .pipe(
        switchMap((run) => (run === null ? EMPTY : this.#eventsOf(run))),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.#apply(event);
      });
    inject(DestroyRef).onDestroy(() => {
      this.#transport?.dispose();
    });
  }

  /** Starts the first run with the current settings. Idempotent and never throws. */
  start(): void {
    if (this.#runId() === 0) {
      this.#beginRun(this.#settings());
    }
  }

  pause(): void {
    this.#request('paused');
  }

  resume(): void {
    this.#request('running');
  }

  /** Replaces the active run with a new one: totals reset, and generation runs even if paused. */
  apply(settings: ProducerSettings): void {
    this.#beginRun(settings);
  }

  /** Replaces the producer, whatever its state, and starts a new run with the current settings. */
  retry(): void {
    this.#beginRun(this.#settings(), { replaceProducer: true });
  }

  #request(state: 'running' | 'paused'): void {
    const transport = this.#transport;
    if (transport === null || this.#phase().kind === 'error' || this.#requested() === state) {
      return;
    }
    this.#requested.set(state);
    transport.send({ type: state === 'paused' ? 'pause' : 'resume', runId: this.#runId() });
  }

  #beginRun(settings: ProducerSettings, { replaceProducer = false } = {}): void {
    // Recorded before the producer is created, so a restart after a failure retries these.
    this.#settings.set(settings);
    this.#requested.set('running');
    this.#snapshot.set(null);
    const transport = this.#transportForNextRun(replaceProducer);
    if (transport === null) {
      // The previous run's producer is gone; nothing it still emits may touch the error state.
      this.#runs.next(null);
      return;
    }
    const id = this.#runId() + 1;
    this.#runId.set(id);
    this.#phase.set({ kind: 'starting' });
    // Subscribe to the new run's events before asking for them.
    this.#runs.next({ id, transport });
    transport.send({ type: 'start', runId: id, settings });
  }

  /** The current producer, or a new one when asked for, when there is none or when it failed. */
  #transportForNextRun(replace: boolean): ProducerTransport | null {
    if (!replace && this.#transport !== null && this.#phase().kind !== 'error') {
      return this.#transport;
    }
    this.#transport?.dispose();
    this.#transport = null;
    try {
      this.#transport = this.#createTransport();
      return this.#transport;
    } catch (error) {
      this.#phase.set({ kind: 'error', message: describeError(error) });
      return null;
    }
  }

  #eventsOf(run: ActiveRun): Observable<ProducerEvent> {
    return run.transport.events$.pipe(
      filter((event) => event.runId === run.id || event.runId === null),
      connect((events$) => {
        const lifecycle$ = events$.pipe(filter((event) => event.type !== 'snapshot'));
        // Snapshots are cumulative, so dropping all but the latest per frame loses no trade: it
        // only bounds render work, and a hidden tab (no frames) renders nothing at all.
        const snapshots$ = events$.pipe(
          filter((event) => event.type === 'snapshot'),
          auditTime(0, animationFrameScheduler),
        );
        // A producer that confirms after the timeout still takes the run over, so a slow network
        // recovers by itself instead of demanding a restart.
        const startupTimeout$ = timer(PRODUCER_STARTUP_TIMEOUT_MS).pipe(
          takeUntil(lifecycle$),
          map((): ProducerEvent => ({
            type: 'failed',
            runId: run.id,
            message: `The market data producer did not respond within ${PRODUCER_STARTUP_TIMEOUT_MS / 1_000} seconds.`,
          })),
        );
        return merge(lifecycle$, snapshots$, startupTimeout$);
      }),
    );
  }

  #apply(event: ProducerEvent): void {
    switch (event.type) {
      case 'started':
        this.#phase.set({ kind: 'ready' });
        break;
      case 'snapshot':
        this.#snapshot.set(event);
        break;
      case 'failed':
        this.#phase.set({ kind: 'error', message: event.message });
        break;
    }
  }
}
