import type { ProducerEvent } from '../domain/producer-protocol';
import { createWorkerProducerTransport } from './worker-producer-transport';

class FakeWorker extends EventTarget {
  static readonly instances: FakeWorker[] = [];
  readonly posted: unknown[] = [];
  terminated = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('createWorkerProducerTransport', () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function create() {
    const transport = createWorkerProducerTransport();
    const worker = FakeWorker.instances[0];
    const events: ProducerEvent[] = [];
    const subscription = transport.events$.subscribe((event) => events.push(event));
    return { transport, worker, events, subscription };
  }

  it('starts one named module worker', () => {
    const { worker } = create();

    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.options).toEqual({ type: 'module', name: 'market-producer' });
  });

  it('relays commands and protocol events', () => {
    const { transport, worker, events } = create();
    const started: ProducerEvent = { type: 'started', runId: 1, seed: '7' };

    transport.send({ type: 'pause', runId: 1 });
    worker.dispatchEvent(new MessageEvent('message', { data: started }));

    expect(worker.posted).toEqual([{ type: 'pause', runId: 1 }]);
    expect(events).toEqual([started]);
  });

  it('reports a worker that cannot run, with a hint for tabs that outlived a deploy', () => {
    const { worker, events } = create();

    worker.dispatchEvent(new Event('error'));

    expect(events).toEqual([
      {
        type: 'failed',
        runId: null,
        message:
          'The market data worker could not run. If the app was just updated, reload the page.',
      },
    ]);
  });

  it('reports messages that could not be deserialised', () => {
    const { worker, events } = create();

    worker.dispatchEvent(new MessageEvent('messageerror'));

    expect(events).toEqual([
      {
        type: 'failed',
        runId: null,
        message: 'A message from the market data worker could not be read.',
      },
    ]);
  });

  it('terminates the worker when disposed', () => {
    const { transport, worker } = create();

    transport.dispose();

    expect(worker.terminated).toBe(true);
  });

  it('refuses to start where workers are unavailable', () => {
    vi.stubGlobal('Worker', undefined);

    expect(() => createWorkerProducerTransport()).toThrow(
      'This browser cannot run the market data producer: it needs Web Workers and WebAssembly.',
    );
  });
});
