import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { ProducerCommand, ProducerEvent } from '../../domain/producer-protocol';
import { MarketDataStore } from '../../market-data/market-data.store';
import { PRODUCER_TRANSPORT_FACTORY } from '../../market-data/producer-transport';
import { ProducerControls } from './producer-controls';

describe('ProducerControls', () => {
  async function render() {
    const events = new Subject<ProducerEvent>();
    const sent: ProducerCommand[] = [];
    let created = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PRODUCER_TRANSPORT_FACTORY,
          useValue: () => {
            created += 1;
            return {
              events$: events,
              send: (command: ProducerCommand) => sent.push(command),
              dispose: () => undefined,
            };
          },
        },
      ],
    });
    const store = TestBed.inject(MarketDataStore);
    store.start();
    events.next({ type: 'started', runId: 1, seed: '1' });
    const fixture = TestBed.createComponent(ProducerControls);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = () => element.querySelector('button');
    const click = async () => {
      button()?.click();
      await fixture.whenStable();
    };
    const settle = () => fixture.whenStable();
    return { events, sent, element, button, click, settle, producersCreated: () => created };
  }

  it('describes the run: id, instruments, nominal rate across instruments and progress', async () => {
    const { element } = await render();

    const facts = [...element.querySelectorAll('dl > div')].map((fact) => [
      fact.querySelector('dt')?.textContent.trim(),
      fact.querySelector('dd')?.textContent.trim(),
    ]);
    expect(facts).toEqual([
      ['Run', '1'],
      ['Instruments', '5'],
      ['Nominal rate', '200 updates/s'],
      ['Updates this run', '0'],
    ]);
  });

  it('pauses and resumes the producer with one button whose label says what it will do', async () => {
    const { sent, button, click } = await render();
    expect(button()?.textContent.trim()).toBe('Pause');

    await click();
    expect(button()?.textContent.trim()).toBe('Resume');

    await click();
    expect(button()?.textContent.trim()).toBe('Pause');
    expect(sent.slice(1)).toEqual([
      { type: 'pause', runId: 1 },
      { type: 'resume', runId: 1 },
    ]);
  });

  it('explains a failure and offers to restart the producer', async () => {
    const { events, element, button, click, settle, producersCreated } = await render();

    events.next({ type: 'failed', runId: 1, message: 'Could not load the market generator.' });
    await settle();
    expect(element.querySelector('[role="alert"] p')?.textContent).toBe(
      'Could not load the market generator.',
    );
    expect(button()?.textContent.trim()).toBe('Restart producer');

    await click();
    expect(producersCreated()).toBe(2);
    expect(button()?.textContent.trim()).toBe('Pause');
  });
});
