import {
  isProducerCommand,
  type ProducerCommand,
  type ProducerEvent,
} from '../domain/producer-protocol';
import { describeError } from '../shared/describe-error';
import type { MarketSourceFactory } from './market-source';
import { ProducerEngine } from './producer-engine';
import type { Scheduler } from './scheduler';

export interface ProducerHostDependencies {
  readonly post: (event: ProducerEvent) => void;
  /** The generator being loaded. Rejections carry a user-facing message and a technical cause. */
  readonly sources: Promise<MarketSourceFactory>;
  readonly scheduler: Scheduler;
  readonly randomSeed: () => bigint;
  /** Receives the technical detail that user-facing messages leave out. */
  readonly logError: (error: unknown) => void;
}

export interface ProducerHost {
  /** Handles one message from the UI thread. */
  receive(data: unknown): void;
  /** Handles an error that escaped every other handler in the worker. */
  fail(error: unknown): void;
}

/**
 * The worker's message loop: everything in the worker besides wiring to `self`, kept apart so it
 * can be tested with a fake channel and a generator that loads when the test says so.
 *
 * - The UI posts its first command while the module is still downloading. Commands that arrive
 *   before the generator is ready are queued and replayed in order, so a pause sent right after
 *   a start is never lost.
 * - Every command is isolated: anything thrown becomes a `failed` event for that run.
 * - The first failure of any kind retires the host: later starts are answered with `failed`. A
 *   trapped Wasm instance may be corrupt, so the UI recovers by replacing the worker.
 */
export function createProducerHost(deps: ProducerHostDependencies): ProducerHost {
  let engine: ProducerEngine | null = null;
  let failure: string | null = null;
  let latestRunId: number | null = null;
  const pending: ProducerCommand[] = [];

  function post(event: ProducerEvent): void {
    if (event.type === 'failed') {
      failure ??= event.message;
    }
    deps.post(event);
  }

  function fail(runId: number | null, message: string, error: unknown): void {
    deps.logError(error);
    post({ type: 'failed', runId, message });
  }

  function dispatch(command: ProducerCommand): void {
    if (failure !== null) {
      if (command.type === 'start') {
        deps.post({ type: 'failed', runId: command.runId, message: failure });
      }
      return;
    }
    if (engine === null) {
      pending.push(command);
      return;
    }
    try {
      engine.handle(command);
    } catch (error) {
      fail(command.runId, 'The producer stopped unexpectedly.', error);
    }
  }

  deps.sources.then(
    (createSource) => {
      engine = new ProducerEngine({
        createSource,
        randomSeed: deps.randomSeed,
        scheduler: deps.scheduler,
        emit: post,
        logError: deps.logError,
      });
      for (const command of pending.splice(0)) {
        dispatch(command);
      }
    },
    (error: unknown) => {
      fail(latestRunId, describeError(error), error);
    },
  );

  return {
    receive(data) {
      if (!isProducerCommand(data)) {
        // A bug on the sending side, not damage to the generator: reported, but not retiring.
        deps.logError(data);
        deps.post({
          type: 'failed',
          runId: null,
          message: 'The producer received a command it could not read.',
        });
        return;
      }
      latestRunId = data.runId;
      dispatch(data);
    },
    fail(error) {
      // The worker may be in an inconsistent state: nothing it generates from here on is trusted.
      engine?.stop();
      fail(latestRunId, 'The producer stopped unexpectedly.', error);
    },
  };
}
