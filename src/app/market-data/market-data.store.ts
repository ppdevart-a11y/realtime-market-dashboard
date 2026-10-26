import { computed, DestroyRef, inject, Service, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  animationFrameScheduler,
  auditTime,
  connect,
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
 * Application-wide state of the market data producer: the active run, its settings, its status
 * and the latest metrics per instrument.
 *
 * A root service, so the run outlives navigation and exactly one producer exists per app. Every
 * run gets a new id; events are read through a per-run projection (`switchMap`), so anything
 * still queued from a replaced run — including a snapshot already waiting for an animation
 * frame — is discarded instead of overwriting the new run.
 *
 * Pause and resume take effect in the UI immediately: commands reach the producer in order, and
 * the only way one could be lost is the producer dying, which is reported as an error anyway.
 */
@Service()
export class MarketDataStore {
  readonly #createTransport = inject(PRODUCER_TRANSPORT_FACTORY);
  readonly #runs = new Subject<ActiveRun>();
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
        switchMap((run) => this.#eventsOf(run)),
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

  /** Starts a new run with the current settings on a fresh producer. */
  retry(): void {
    this.#beginRun(this.#settings());
  }

  #request(state: 'running' | 'paused'): void {
    const transport = this.#transport;
    if (transport === null || this.#phase().kind === 'error' || this.#requested() === state) {
      return;
    }
    this.#requested.set(state);
    transport.send({ type: state === 'paused' ? 'pause' : 'resume', runId: this.#runId() });
  }

  #beginRun(settings: ProducerSettings): void {
    const transport = this.#transportForNextRun();
    if (transport === null) {
      return;
    }
    const id = this.#runId() + 1;
    this.#runId.set(id);
    this.#settings.set(settings);
    this.#requested.set('running');
    this.#phase.set({ kind: 'starting' });
    this.#snapshot.set(null);
    // Subscribe to the new run's events before asking for them.
    this.#runs.next({ id, transport });
    transport.send({ type: 'start', runId: id, settings });
  }

  /** The current producer, or a new one if there is none or the current one failed. */
  #transportForNextRun(): ProducerTransport | null {
    if (this.#transport !== null && this.#phase().kind !== 'error') {
      return this.#transport;
    }
    this.#transport?.dispose();
    this.#transport = null;
    try {
      this.#transport = this.#createTransport();
      return this.#transport;
    } catch (error) {
      this.#phase.set({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'The market data producer could not be created.',
      });
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
