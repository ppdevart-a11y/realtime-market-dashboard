import { MARKET_UPDATE_WORDS } from '../domain/market-update';
import type { ProducerEvent } from '../domain/producer-protocol';
import { DEFAULT_PRODUCER_SETTINGS } from '../domain/producer-settings';
import type { MarketSourceFactory } from './market-source';
import { createProducerHost } from './producer-host';
import { ManualScheduler } from './testing/manual-scheduler';

const createSource: MarketSourceFactory = () => ({
  nextBatch: (size) => ({
    records: new Uint32Array(size * MARKET_UPDATE_WORDS).map((_, index) =>
      index % MARKET_UPDATE_WORDS === 3 ? 99 : index % MARKET_UPDATE_WORDS === 4 ? 101 : 1,
    ),
    offset: 0,
    count: size,
  }),
  dispose: () => undefined,
});

function setup() {
  let resolveSources: (factory: MarketSourceFactory) => void = () => undefined;
  let rejectSources: (error: unknown) => void = () => undefined;
  const sources = new Promise<MarketSourceFactory>((resolve, reject) => {
    resolveSources = resolve;
    rejectSources = reject;
  });
  const scheduler = new ManualScheduler();
  const posted: ProducerEvent[] = [];
  const logged: unknown[] = [];
  const host = createProducerHost({
    post: (event) => posted.push(event),
    sources,
    scheduler,
    randomSeed: () => 7n,
    logError: (error) => logged.push(error),
  });
  // Lets the promise callbacks run, as the worker's event loop would between tasks.
  const settle = () => new Promise((resolve) => setTimeout(resolve));
  return { host, scheduler, posted, logged, resolveSources, rejectSources, settle };
}

const start = (runId: number) => ({
  type: 'start' as const,
  runId,
  settings: DEFAULT_PRODUCER_SETTINGS,
});

describe('createProducerHost', () => {
  it('queues commands until the generator is ready, then replays them in order', async () => {
    const { host, scheduler, posted, resolveSources, settle } = setup();

    host.receive(start(1));
    host.receive({ type: 'pause', runId: 1 });
    expect(posted).toEqual([]);

    resolveSources(createSource);
    await settle();
    scheduler.advanceBy(10_000);

    expect(posted).toEqual([{ type: 'started', runId: 1, seed: '7' }]);
  });

  it('fails the latest run when the generator cannot load, and every later start too', async () => {
    const { host, posted, logged, rejectSources, settle } = setup();
    const cause = new Error('failed to fetch Wasm: 404');

    host.receive(start(1));
    rejectSources(new Error('The market generator could not be loaded.', { cause }));
    await settle();
    host.receive(start(2));

    expect(posted).toEqual([
      { type: 'failed', runId: 1, message: 'The market generator could not be loaded.' },
      { type: 'failed', runId: 2, message: 'The market generator could not be loaded.' },
    ]);
    expect((logged[0] as Error).cause).toBe(cause);
  });

  it('retires after the generator fails during a run', async () => {
    const failing: MarketSourceFactory = () => ({
      nextBatch: () => {
        throw new Error('RuntimeError: unreachable');
      },
      dispose: () => undefined,
    });
    const { host, scheduler, posted, resolveSources, settle } = setup();
    resolveSources(failing);
    await settle();

    host.receive(start(1));
    scheduler.advanceBy(0);
    host.receive(start(2));

    expect(posted).toEqual([
      { type: 'started', runId: 1, seed: '7' },
      { type: 'failed', runId: 1, message: 'The market generator stopped unexpectedly.' },
      { type: 'failed', runId: 2, message: 'The market generator stopped unexpectedly.' },
    ]);
  });

  it('reports a malformed command without retiring', async () => {
    const { host, posted, resolveSources, settle } = setup();
    resolveSources(createSource);
    await settle();

    host.receive({ type: 'start', runId: 1 });
    host.receive(start(2));

    expect(posted).toEqual([
      {
        type: 'failed',
        runId: null,
        message: 'The market data producer received a malformed command.',
      },
      { type: 'started', runId: 2, seed: '7' },
    ]);
  });

  it('attributes an error that escaped every handler to the latest run', async () => {
    const { host, posted, logged, resolveSources, settle } = setup();
    resolveSources(createSource);
    await settle();
    host.receive(start(3));
    const escaped = new Error('boom');

    host.fail(escaped);

    expect(posted.at(-1)).toEqual({
      type: 'failed',
      runId: 3,
      message: 'The market data producer failed unexpectedly.',
    });
    expect(logged).toEqual([escaped]);
  });
});
