import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { ProducerEvent } from '../domain/producer-protocol';
import { MarketDataStore } from '../market-data/market-data.store';
import { PRODUCER_TRANSPORT_FACTORY } from '../market-data/producer-transport';
import { ProducerStatusBadge } from './producer-status-badge';

describe('ProducerStatusBadge', () => {
  function render() {
    const events = new Subject<ProducerEvent>();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PRODUCER_TRANSPORT_FACTORY,
          useValue: () => ({ events$: events, send: () => undefined, dispose: () => undefined }),
        },
      ],
    });
    const store = TestBed.inject(MarketDataStore);
    const fixture = TestBed.createComponent(ProducerStatusBadge);
    const element = fixture.nativeElement as HTMLElement;
    const read = async () => {
      await fixture.whenStable();
      return element.textContent.replace(/\s+/g, ' ').trim();
    };
    return { events, store, element, read };
  }

  it('is a status live region', () => {
    const { element } = render();

    expect(element.getAttribute('role')).toBe('status');
  });

  it('follows the producer through its states', async () => {
    const { events, store, read } = render();

    store.start();
    store.pause();
    expect(await read()).toBe('Producer status: Starting (paused)');

    events.next({ type: 'started', runId: 1, seed: '1' });
    expect(await read()).toBe('Producer status: Paused');

    store.resume();
    expect(await read()).toBe('Producer status: Running');

    events.next({ type: 'failed', runId: 1, message: 'boom' });
    expect(await read()).toBe('Producer status: Error');
  });
});
