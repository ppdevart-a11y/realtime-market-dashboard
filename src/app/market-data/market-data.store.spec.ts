import { TestBed } from '@angular/core/testing';
import { type Observable, Subject } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import type { ProducerCommand, ProducerEvent } from '../domain/producer-protocol';
import { DEFAULT_PRODUCER_SETTINGS, type ProducerSettings } from '../domain/producer-settings';
import { MarketDataStore, PRODUCER_STARTUP_TIMEOUT_MS } from './market-data.store';
import { PRODUCER_TRANSPORT_FACTORY, type ProducerTransport } from './producer-transport';

class FakeTransport implements ProducerTransport {
  readonly sent: ProducerCommand[] = [];
  disposed = false;

  constructor(readonly events$: Observable<ProducerEvent> = new Subject<ProducerEvent>()) {}

  emit(event: ProducerEvent): void {
    (this.events$ as Subject<ProducerEvent>).next(event);
  }

  send(command: ProducerCommand): void {
    this.sent.push(command);
  }

  dispose(): void {
    this.disposed = true;
  }
}

function setup(events$?: Observable<ProducerEvent>) {
  const transports: FakeTransport[] = [];
  TestBed.configureTestingModule({
    providers: [
      {
        provide: PRODUCER_TRANSPORT_FACTORY,
        useValue: () => {
          const transport = new FakeTransport(events$);
          transports.push(transport);
          return transport;
        },
      },
    ],
  });
  const latest = (): FakeTransport => {
    const transport = transports.at(-1);
    if (transport === undefined) {
      throw new Error('No producer was created');
    }
    return transport;
  };
  return { store: TestBed.inject(MarketDataStore), transports, latest };
}

function snapshot(runId: number, totalUpdates: number, instrumentCount = 5): ProducerEvent {
  return {
    type: 'snapshot',
    runId,
    totalUpdates,
    instruments: Array.from({ length: instrumentCount }, () => ({
      lastPriceCents: 10_000,
      lastTick: null,
      spreadCents: 2,
      volume: totalUpdates,
      vwapCents: 10_000,
      imbalance: 0,
    })),
  };
}

const started = (runId: number): ProducerEvent => ({ type: 'started', runId, seed: '1' });
const smallRun: ProducerSettings = {
  instrumentCount: 2,
  updatesPerBatch: 10,
  batchIntervalMs: 100,
};

describe('MarketDataStore', () => {
  describe('lifecycle', () => {
    it('creates no producer until started, then exactly one running the defaults', () => {
      const { store, transports, latest } = setup();
      expect(transports).toHaveLength(0);

      store.start();
      store.start();

      expect(transports).toHaveLength(1);
      expect(latest().sent).toEqual([
        { type: 'start', runId: 1, settings: DEFAULT_PRODUCER_SETTINGS },
      ]);
    });

    it('shows every instrument as unavailable, with zero volume, before data arrives', () => {
      const { store } = setup();

      store.start();

      expect(store.status()).toEqual({ kind: 'starting', paused: false });
      expect(store.totalUpdates()).toBe(0);
      expect(store.instruments().map((row) => row.symbol)).toEqual([
        'ALFA',
        'BETA',
        'TERA',
        'POLI',
        'LAHU',
      ]);
      for (const row of store.instruments()) {
        expect(row).toMatchObject({
          lastPriceCents: null,
          spreadCents: null,
          volume: 0,
          vwapCents: null,
          imbalance: null,
        });
      }
    });

    it('reports running once the producer confirms the run', () => {
      const { store, latest } = setup();
      store.start();

      latest().emit(started(1));

      expect(store.status()).toEqual({ kind: 'running' });
    });

    it('pauses and resumes the current run', () => {
      const { store, latest } = setup();
      store.start();
      latest().emit(started(1));

      store.pause();
      expect(store.status()).toEqual({ kind: 'paused' });

      store.resume();
      expect(store.status()).toEqual({ kind: 'running' });
      expect(latest().sent.slice(1)).toEqual([
        { type: 'pause', runId: 1 },
        { type: 'resume', runId: 1 },
      ]);
    });

    it('keeps a pause requested while the producer is still starting', () => {
      const { store, latest } = setup();
      store.start();

      store.pause();
      expect(store.status()).toEqual({ kind: 'starting', paused: true });

      latest().emit(started(1));
      expect(store.status()).toEqual({ kind: 'paused' });
    });

    it('applies settings as a new, running run on the same producer, even from a pause', () => {
      const { store, transports, latest } = setup();
      store.start();
      latest().emit(started(1));
      store.pause();

      store.apply(smallRun);

      expect(transports).toHaveLength(1);
      expect(store.runId()).toBe(2);
      expect(store.settings()).toEqual(smallRun);
      expect(store.status()).toEqual({ kind: 'starting', paused: false });
      expect(store.instruments().map((row) => row.symbol)).toEqual(['ALFA', 'BETA']);
      expect(latest().sent.at(-1)).toEqual({ type: 'start', runId: 2, settings: smallRun });
    });

    it('ignores lifecycle events of a previous run', () => {
      const { store, latest } = setup();
      store.start();
      store.apply(smallRun);

      latest().emit(started(1));
      latest().emit({ type: 'failed', runId: 1, message: 'stale' });

      expect(store.status()).toEqual({ kind: 'starting', paused: false });
    });
  });

  describe('failures', () => {
    it('surfaces a run failure and ignores pause and resume until recovered', () => {
      const { store, latest } = setup();
      store.start();
      latest().emit({ type: 'failed', runId: 1, message: 'The generator trapped.' });

      store.pause();

      expect(store.status()).toEqual({ kind: 'error', message: 'The generator trapped.' });
      expect(latest().sent).toHaveLength(1);
    });

    it('surfaces failures of the producer itself', () => {
      const { store, latest } = setup();
      store.start();

      latest().emit({ type: 'failed', runId: null, message: 'The worker could not be started.' });

      expect(store.status()).toEqual({
        kind: 'error',
        message: 'The worker could not be started.',
      });
    });

    it('retries with a fresh producer and the same settings', () => {
      const { store, transports, latest } = setup();
      store.start();
      const failed = latest();
      failed.emit({ type: 'failed', runId: 1, message: 'boom' });

      store.retry();
      failed.emit(started(2));

      expect(failed.disposed).toBe(true);
      expect(transports).toHaveLength(2);
      expect(latest().sent).toEqual([
        { type: 'start', runId: 2, settings: DEFAULT_PRODUCER_SETTINGS },
      ]);
      expect(store.status()).toEqual({ kind: 'starting', paused: false });

      latest().emit(started(2));
      expect(store.status()).toEqual({ kind: 'running' });
    });

    it('restarts on a new producer even when the current one is healthy', () => {
      const { store, transports, latest } = setup();
      store.start();
      const healthy = latest();
      healthy.emit(started(1));

      store.retry();

      expect(healthy.disposed).toBe(true);
      expect(transports).toHaveLength(2);
      expect(latest().sent).toEqual([
        { type: 'start', runId: 2, settings: DEFAULT_PRODUCER_SETTINGS },
      ]);
    });

    it('replaces a failed producer when new settings are applied', () => {
      const { store, transports, latest } = setup();
      store.start();
      latest().emit({ type: 'failed', runId: 1, message: 'boom' });

      store.apply(smallRun);

      expect(transports).toHaveLength(2);
      expect(latest().sent).toEqual([{ type: 'start', runId: 2, settings: smallRun }]);
    });

    it('reports an error state instead of throwing when no producer can be created', () => {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: PRODUCER_TRANSPORT_FACTORY,
            useValue: () => {
              throw new Error('This browser cannot run Web Workers.');
            },
          },
        ],
      });
      const store = TestBed.inject(MarketDataStore);

      expect(() => {
        store.start();
      }).not.toThrow();
      expect(store.status()).toEqual({
        kind: 'error',
        message: 'This browser cannot run Web Workers.',
      });
    });

    it('disposes the producer when the application shuts down', () => {
      const { store, latest } = setup();
      store.start();

      TestBed.resetTestingModule();

      expect(latest().disposed).toBe(true);
    });
  });

  describe('timing', () => {
    let testScheduler: TestScheduler;

    beforeEach(() => {
      testScheduler = new TestScheduler((actual, expected) => {
        expect(actual).toEqual(expected);
      });
    });

    it('renders on animation frames, always the latest snapshot, without losing totals', () => {
      testScheduler.run(({ hot, cold, animate }) => {
        const events = hot<ProducerEvent>('-sab--c', {
          s: started(1),
          a: snapshot(1, 3),
          b: snapshot(1, 6),
          c: snapshot(1, 9),
        });
        animate('-----x--x');
        const { store } = setup(events);
        const rendered: number[] = [];

        store.start();
        cold('----a--b-c').subscribe(() => rendered.push(store.totalUpdates()));

        testScheduler.flush();
        expect(rendered).toEqual([0, 6, 9]);
      });
    });

    it('drops a previous-run snapshot that is still waiting for a frame when settings are applied', () => {
      testScheduler.run(({ hot, cold, animate }) => {
        const events = hot<ProducerEvent>('-sa---Sbo', {
          s: started(1),
          a: snapshot(1, 3),
          S: started(2),
          b: snapshot(2, 4, 2),
          o: snapshot(1, 99),
        });
        animate('-----x---x');
        const { store } = setup(events);
        const observed: { runId: number; totalUpdates: number; rows: number }[] = [];
        const observe = () =>
          observed.push({
            runId: store.runId(),
            totalUpdates: store.totalUpdates(),
            rows: store.instruments().length,
          });

        store.start();
        cold('---x').subscribe(() => {
          store.apply(smallRun);
        });
        cold('------x---x').subscribe(observe);

        testScheduler.flush();
        expect(observed).toEqual([
          { runId: 2, totalUpdates: 0, rows: 2 },
          { runId: 2, totalUpdates: 4, rows: 2 },
        ]);
      });
    });

    it('fails a run whose producer never confirms it', () => {
      testScheduler.run(({ cold }) => {
        const { store } = setup();
        const statuses: string[] = [];

        store.start();
        cold(`${PRODUCER_STARTUP_TIMEOUT_MS - 1}ms a 1ms b`).subscribe(() =>
          statuses.push(store.status().kind),
        );

        testScheduler.flush();
        expect(statuses).toEqual(['starting', 'error']);
      });
    });
  });
});
