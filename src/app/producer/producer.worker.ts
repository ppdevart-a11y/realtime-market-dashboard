import wasmUrl from 'market-sim/market_sim_bg.wasm';
import {
  isProducerCommand,
  type ProducerCommand,
  type ProducerEvent,
} from '../domain/producer-protocol';
import { describeError } from '../shared/describe-error';
import { ProducerEngine } from './producer-engine';
import { timerScheduler } from './scheduler';
import { loadWasmMarketSourceFactory } from './wasm-market-source';

/*
 * Worker entry point: connects the engine to postMessage and to the Wasm generator.
 *
 * The UI posts its first command while the module is still downloading. Commands that arrive
 * before the generator is ready are queued and replayed in order, so a pause sent right after a
 * start is never lost. Every command is isolated: anything thrown becomes a `failed` event, and
 * after a failure the worker refuses new runs, because a trapped Wasm instance may be corrupt;
 * the UI recovers by replacing the worker.
 */

let engine: ProducerEngine | null = null;
let failure: string | null = null;
let latestRunId: number | null = null;
const pending: ProducerCommand[] = [];

function emit(event: ProducerEvent): void {
  postMessage(event);
}

function fail(runId: number | null, message: string): void {
  failure ??= message;
  emit({ type: 'failed', runId, message });
}

function dispatch(command: ProducerCommand): void {
  if (failure !== null) {
    if (command.type === 'start') {
      emit({ type: 'failed', runId: command.runId, message: failure });
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
    fail(command.runId, `The market data producer failed: ${describeError(error)}`);
  }
}

addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isProducerCommand(event.data)) {
    emit({
      type: 'failed',
      runId: null,
      message: 'The market data producer received a malformed command.',
    });
    return;
  }
  latestRunId = event.data.runId;
  dispatch(event.data);
});

// Handled here, so the browser does not also report them to the page as a generic worker error.
addEventListener('error', (event) => {
  event.preventDefault();
  fail(latestRunId, `The market data producer failed: ${event.message}`);
});
addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  fail(latestRunId, `The market data producer failed: ${describeError(event.reason)}`);
});

loadWasmMarketSourceFactory(new URL(wasmUrl, location.href)).then(
  (createSource) => {
    engine = new ProducerEngine({
      createSource,
      randomSeed: () => crypto.getRandomValues(new BigUint64Array(1))[0],
      scheduler: timerScheduler,
      emit,
    });
    for (const command of pending.splice(0)) {
      dispatch(command);
    }
  },
  (error: unknown) => {
    fail(latestRunId, describeError(error));
  },
);
