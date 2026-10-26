import { fromEvent, map, merge, share } from 'rxjs';
import type { ProducerEvent } from '../domain/producer-protocol';
import type { ProducerTransport } from './producer-transport';

function failure(message: string): ProducerEvent {
  return { type: 'failed', runId: null, message };
}

/**
 * Runs the producer in a dedicated module worker.
 *
 * The worker reports its own failures as protocol events. The `error` event on the Worker object
 * therefore only fires when the worker could not run at all; the likeliest cause in production is
 * an old tab whose worker file was replaced by a deploy, hence the reload hint.
 *
 * @throws if the browser supports neither module workers nor WebAssembly.
 */
export function createWorkerProducerTransport(): ProducerTransport {
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
    throw new Error(
      'This browser cannot run the market data producer: it needs Web Workers and WebAssembly.',
    );
  }
  const worker = new Worker(new URL('../producer/producer.worker', import.meta.url), {
    type: 'module',
    name: 'market-producer',
  });
  return {
    events$: merge(
      fromEvent<MessageEvent<ProducerEvent>>(worker, 'message').pipe(map((event) => event.data)),
      fromEvent(worker, 'error').pipe(
        map(() =>
          failure(
            'The market data worker could not run. If the app was just updated, reload the page.',
          ),
        ),
      ),
      fromEvent(worker, 'messageerror').pipe(
        map(() => failure('A message from the market data worker could not be read.')),
      ),
    ).pipe(share()),
    send: (command) => {
      worker.postMessage(command);
    },
    dispose: () => {
      worker.terminate();
    },
  };
}
