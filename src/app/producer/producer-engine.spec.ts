import { MARKET_UPDATE_WORDS } from '../domain/market-update';
import type { ProducerEvent } from '../domain/producer-protocol';
import type { ProducerSettings } from '../domain/producer-settings';
import type { MarketBatch, MarketSource } from './market-source';
import { ProducerEngine } from './producer-engine';
import { ManualScheduler } from './testing/manual-scheduler';

class FakeSource implements MarketSource {
  readonly batchSizes: number[] = [];
  disposed = false;
  failNextBatch = false;

  constructor(
    readonly instrumentCount: number,
    readonly seed: bigint,
    private readonly log: string[],
  ) {}

  nextBatch(size: number): MarketBatch {
    if (this.failNextBatch) {
      throw new Error('unreachable');
    }
    this.batchSizes.push(size);
    const records = new Uint32Array(size * MARKET_UPDATE_WORDS);
    for (let i = 0; i < size; i++) {
      records.set(
        [i % this.instrumentCount, 10_000, 1, 9_999, 10_001, 10, 10],
        i * MARKET_UPDATE_WORDS,
      );
    }
    return { records, offset: 0, count: size };
  }

  dispose(): void {
    this.disposed = true;
    this.log.push(`dispose source ${this.seed}`);
  }
}

const settings: ProducerSettings = { instrumentCount: 2, updatesPerBatch: 3, batchIntervalMs: 500 };

function setup(options: { failToCreate?: boolean } = {}) {
  const scheduler = new ManualScheduler();
  const events: ProducerEvent[] = [];
  const errors: unknown[] = [];
  const log: string[] = [];
  const sources: FakeSource[] = [];
  let seed = 41n;
  const engine = new ProducerEngine({
    scheduler,
    randomSeed: () => ++seed,
    createSource: (instrumentCount, sourceSeed) => {
      if (options.failToCreate) {
        throw new Error('instantiate failed');
      }
      log.push(`create source ${sourceSeed}`);
      const source = new FakeSource(instrumentCount, sourceSeed, log);
      sources.push(source);
      return source;
    },
    emit: (event) => events.push(event),
    logError: (error) => errors.push(error),
  });
  const snapshots = (runId?: number) =>
    events.filter(
      (event): event is Extract<ProducerEvent, { type: 'snapshot' }> =>
        event.type === 'snapshot' && (runId === undefined || event.runId === runId),
    );
  return { engine, scheduler, events, errors, log, sources, snapshots };
}

describe('ProducerEngine', () => {
  it('announces a run with its seed and produces one batch per interval', () => {
    const { engine, scheduler, events, sources, snapshots } = setup();

    engine.handle({ type: 'start', runId: 1, settings });

    expect(events).toEqual([{ type: 'started', runId: 1, seed: '42' }]);
    expect(sources[0]?.instrumentCount).toBe(2);

    scheduler.advanceBy(0);
    scheduler.advanceBy(1_000);

    expect(sources[0]?.batchSizes).toEqual([3, 3, 3]);
    expect(snapshots(1).map((snapshot) => snapshot.totalUpdates)).toEqual([3, 6, 9]);
    expect(
      snapshots(1)
        .at(-1)
        ?.instruments.map((instrument) => instrument.volume),
    ).toEqual([6, 3]);
  });

  it('defers the first batch so a pause queued right behind the start wins', () => {
    const { engine, scheduler, sources } = setup();

    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'pause', runId: 1 });
    scheduler.advanceBy(10_000);

    expect(sources[0]?.batchSizes).toEqual([]);
  });

  it('generates nothing while paused and resumes with the totals intact', () => {
    const { engine, scheduler, sources, snapshots } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.advanceBy(0);

    engine.handle({ type: 'pause', runId: 1 });
    scheduler.advanceBy(10_000);
    expect(sources[0]?.batchSizes).toHaveLength(1);

    engine.handle({ type: 'resume', runId: 1 });
    scheduler.advanceBy(0);

    expect(sources).toHaveLength(1);
    expect(snapshots(1).map((snapshot) => snapshot.totalUpdates)).toEqual([3, 6]);
  });

  it('after a long pause, resumes with one batch and then the regular cadence', () => {
    const { engine, scheduler, sources } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.advanceBy(0);
    engine.handle({ type: 'pause', runId: 1 });
    scheduler.advanceBy(60_000);

    engine.handle({ type: 'resume', runId: 1 });
    scheduler.advanceBy(499);

    expect(sources[0]?.batchSizes).toHaveLength(2);
    scheduler.advanceBy(1);
    expect(sources[0]?.batchSizes).toHaveLength(3);
  });

  it('keeps the cadence when pause and resume happen within one interval', () => {
    const { engine, scheduler, sources } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.advanceBy(0);

    scheduler.advanceBy(100);
    engine.handle({ type: 'pause', runId: 1 });
    scheduler.advanceBy(100);
    engine.handle({ type: 'resume', runId: 1 });
    engine.handle({ type: 'pause', runId: 1 });
    engine.handle({ type: 'resume', runId: 1 });
    scheduler.advanceBy(299);

    expect(sources[0]?.batchSizes).toHaveLength(1);
    scheduler.advanceBy(1);
    expect(sources[0]?.batchSizes).toHaveLength(2);
  });

  it('compensates small timer delays without drifting', () => {
    const { engine, scheduler, sources } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.advanceBy(0);

    scheduler.stall(520);
    scheduler.advanceBy(0);
    expect(sources[0]?.batchSizes).toHaveLength(2);

    scheduler.advanceBy(479);
    expect(sources[0]?.batchSizes).toHaveLength(2);
    scheduler.advanceBy(1);
    expect(sources[0]?.batchSizes).toHaveLength(3);
  });

  it('produces a single batch after a stall instead of catching up', () => {
    const { engine, scheduler, sources } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.advanceBy(0);

    scheduler.stall(5_000);
    scheduler.advanceBy(0);
    expect(sources[0]?.batchSizes).toHaveLength(2);

    scheduler.advanceBy(499);
    expect(sources[0]?.batchSizes).toHaveLength(2);
    scheduler.advanceBy(1);
    expect(sources[0]?.batchSizes).toHaveLength(3);
  });

  it('replaces a running run: stops and disposes it before creating the next one', () => {
    const { engine, scheduler, log, sources, snapshots } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.advanceBy(0);

    engine.handle({ type: 'start', runId: 2, settings: { ...settings, instrumentCount: 1 } });
    scheduler.advanceBy(1_000);

    expect(log).toEqual(['create source 42', 'dispose source 42', 'create source 43']);
    expect(sources[0]?.batchSizes).toHaveLength(1);
    expect(snapshots(2).map((snapshot) => snapshot.totalUpdates)).toEqual([3, 6, 9]);
    expect(snapshots(2)[0]?.instruments).toHaveLength(1);
  });

  it('starts generating when a new run replaces a paused one', () => {
    const { engine, scheduler, sources } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'pause', runId: 1 });

    engine.handle({ type: 'start', runId: 2, settings });
    scheduler.advanceBy(0);

    expect(sources[1]?.batchSizes).toEqual([3]);
  });

  it('ignores pause and resume addressed to a run that is no longer current', () => {
    const { engine, scheduler, sources } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'start', runId: 2, settings });

    engine.handle({ type: 'pause', runId: 1 });
    scheduler.advanceBy(0);

    expect(sources[1]?.batchSizes).toHaveLength(1);
  });

  it('fails the run when the generator cannot be created, logging the cause', () => {
    const { engine, scheduler, events, errors } = setup({ failToCreate: true });

    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.advanceBy(1_000);

    expect(events).toEqual([
      { type: 'failed', runId: 1, message: 'The producer stopped unexpectedly.' },
    ]);
    expect(errors).toEqual([new Error('instantiate failed')]);
  });

  it('fails the run, releases the generator and stops ticking when a batch throws', () => {
    const { engine, scheduler, events, sources } = setup();
    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.advanceBy(0);

    const [source] = sources;
    source.failNextBatch = true;
    scheduler.advanceBy(5_000);

    expect(events.at(-1)).toEqual({
      type: 'failed',
      runId: 1,
      message: 'The producer stopped unexpectedly.',
    });
    expect(source.disposed).toBe(true);
    expect(source.batchSizes).toHaveLength(1);
  });
});
