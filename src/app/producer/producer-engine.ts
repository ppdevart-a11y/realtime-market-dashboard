import { MarketAggregator } from '../domain/market-aggregator';
import type { ProducerCommand, ProducerEvent } from '../domain/producer-protocol';
import type { ProducerSettings } from '../domain/producer-settings';
import type { MarketSource, MarketSourceFactory } from './market-source';
import type { Scheduler } from './scheduler';

export interface ProducerEngineDependencies {
  readonly createSource: MarketSourceFactory;
  /** Seed for each run's generator; a port so tests can make runs reproducible. */
  readonly randomSeed: () => bigint;
  readonly scheduler: Scheduler;
  readonly emit: (event: ProducerEvent) => void;
}

interface Run {
  readonly id: number;
  readonly settings: ProducerSettings;
  readonly source: MarketSource;
  readonly aggregator: MarketAggregator;
  paused: boolean;
  /** When the latest batch was due, on the scheduler clock; `null` before the first batch. */
  lastDueAt: number | null;
  cancelNextBatch: (() => void) | null;
}

/**
 * The producer's run lifecycle, independent of the worker and of Wasm so it can be tested with
 * a fake source and a manual clock.
 *
 * Invariants:
 * - At most one run exists. A `start` supersedes the current run before anything else happens,
 *   so a replaced run never keeps generating unseen, even if its successor fails to start.
 * - Commands are handled synchronously, in arrival order, and batches only ever run from the
 *   scheduler. A `pause` queued right behind a `start` therefore always wins over the first batch.
 * - Batches follow the requested interval measured between due times, so timer lateness does not
 *   accumulate. After a stall longer than an interval, one batch runs and the cadence restarts
 *   from there: no catch-up burst, and nothing is generated for the time a run was paused.
 * - Any exception from the generator is fatal. A Wasm trap can leave the instance poisoned, so the
 *   engine reports the failure and refuses further work; the UI recovers by replacing the worker.
 */
export class ProducerEngine {
  readonly #deps: ProducerEngineDependencies;
  #run: Run | null = null;
  #stopped = false;

  constructor(dependencies: ProducerEngineDependencies) {
    this.#deps = dependencies;
  }

  handle(command: ProducerCommand): void {
    switch (command.type) {
      case 'start':
        this.#start(command.runId, command.settings);
        break;
      case 'pause':
        this.#pause(command.runId);
        break;
      case 'resume':
        this.#resume(command.runId);
        break;
    }
  }

  #start(runId: number, settings: ProducerSettings): void {
    this.#discardRun();
    if (this.#stopped) {
      this.#deps.emit({
        type: 'failed',
        runId,
        message: 'The market generator stopped after an earlier failure. Restart the producer.',
      });
      return;
    }

    const seed = this.#deps.randomSeed();
    let source: MarketSource;
    try {
      source = this.#deps.createSource(settings.instrumentCount, seed);
    } catch (error) {
      this.#fail(runId, error);
      return;
    }

    this.#run = {
      id: runId,
      settings,
      source,
      aggregator: new MarketAggregator(settings.instrumentCount),
      paused: false,
      lastDueAt: null,
      cancelNextBatch: null,
    };
    this.#deps.emit({ type: 'started', runId, seed: seed.toString() });
    this.#scheduleBatch(this.#run, this.#deps.scheduler.now());
  }

  #pause(runId: number): void {
    const run = this.#run;
    if (run?.id !== runId || run.paused) {
      return;
    }
    run.paused = true;
    run.cancelNextBatch?.();
    run.cancelNextBatch = null;
  }

  #resume(runId: number): void {
    const run = this.#run;
    if (run?.id !== runId || !run.paused) {
      return;
    }
    run.paused = false;
    const now = this.#deps.scheduler.now();
    // A quick pause/resume keeps the original phase, so toggling can never exceed the rate.
    const due =
      run.lastDueAt === null ? now : Math.max(now, run.lastDueAt + run.settings.batchIntervalMs);
    this.#scheduleBatch(run, due);
  }

  #scheduleBatch(run: Run, dueAt: number): void {
    const delay = Math.max(0, dueAt - this.#deps.scheduler.now());
    run.cancelNextBatch = this.#deps.scheduler.schedule(() => {
      this.#produceBatch(run, dueAt);
    }, delay);
  }

  #produceBatch(run: Run, dueAt: number): void {
    run.cancelNextBatch = null;
    try {
      const batch = run.source.nextBatch(run.settings.updatesPerBatch);
      run.aggregator.applyBatch(batch.records, batch.offset, batch.count);
    } catch (error) {
      this.#fail(run.id, error);
      return;
    }
    run.lastDueAt = dueAt;
    this.#deps.emit({
      type: 'snapshot',
      runId: run.id,
      instruments: run.aggregator.snapshot(),
      totalUpdates: run.aggregator.totalUpdates,
    });

    const now = this.#deps.scheduler.now();
    const nextDueAt = dueAt + run.settings.batchIntervalMs;
    // Late by less than an interval: keep the grid. Missed a whole slot: re-anchor on now.
    this.#scheduleBatch(run, nextDueAt > now ? nextDueAt : now + run.settings.batchIntervalMs);
  }

  #fail(runId: number, error: unknown): void {
    this.#stopped = true;
    this.#discardRun();
    const reason = error instanceof Error ? error.message : String(error);
    this.#deps.emit({
      type: 'failed',
      runId,
      message: `The market generator stopped unexpectedly: ${reason}`,
    });
  }

  #discardRun(): void {
    const run = this.#run;
    if (run === null) {
      return;
    }
    this.#run = null;
    run.cancelNextBatch?.();
    try {
      run.source.dispose();
    } catch {
      // Disposing a generator whose instance trapped can throw again; there is nothing left to free.
    }
  }
}
