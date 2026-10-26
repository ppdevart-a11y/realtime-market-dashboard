import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { App } from './app';
import { appConfig } from './app.config';
import type { ProducerCommand, ProducerEvent } from './domain/producer-protocol';
import { DEFAULT_PRODUCER_SETTINGS } from './domain/producer-settings';
import {
  PRODUCER_TRANSPORT_FACTORY,
  type ProducerTransport,
} from './market-data/producer-transport';

class RecordingTransport implements ProducerTransport {
  readonly events = new Subject<ProducerEvent>();
  readonly events$ = this.events.asObservable();
  readonly sent: ProducerCommand[] = [];

  send(command: ProducerCommand): void {
    this.sent.push(command);
  }

  dispose(): void {
    this.events.complete();
  }
}

/**
 * Boots the app with its real configuration (routes, app initializer, store), replacing only the
 * Web Worker with a recording transport. TestBed runs app initializers like a real bootstrap.
 */
async function boot(url: string) {
  const producers: RecordingTransport[] = [];
  TestBed.configureTestingModule({
    providers: [
      ...appConfig.providers,
      {
        provide: PRODUCER_TRANSPORT_FACTORY,
        useValue: () => {
          const transport = new RecordingTransport();
          producers.push(transport);
          return transport;
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(App);
  const router = TestBed.inject(Router);
  const element = fixture.nativeElement as HTMLElement;
  const navigate = async (to: string) => {
    await router.navigateByUrl(to);
    await fixture.whenStable();
  };
  await navigate(url);
  return { element, navigate, settle: () => fixture.whenStable(), producers };
}

describe('App', () => {
  it('starts exactly one producer on the defaults, whichever page is opened first', async () => {
    const { producers } = await boot('/settings');

    expect(producers).toHaveLength(1);
    expect(producers[0].sent).toEqual([
      { type: 'start', runId: 1, settings: DEFAULT_PRODUCER_SETTINGS },
    ]);
  });

  it('keeps the run and its paused state across navigation, without creating producers', async () => {
    const { element, navigate, settle, producers } = await boot('/');
    producers[0].events.next({ type: 'started', runId: 1, seed: '1' });
    await settle();
    const pauseButton = () =>
      element.querySelector<HTMLButtonElement>('app-producer-controls button');

    pauseButton()?.click();
    await settle();
    await navigate('/settings');
    await navigate('/');
    await navigate('/settings');
    await navigate('/');

    expect(producers).toHaveLength(1);
    expect(producers[0].sent).toEqual([
      { type: 'start', runId: 1, settings: DEFAULT_PRODUCER_SETTINGS },
      { type: 'pause', runId: 1 },
    ]);
    expect(pauseButton()?.textContent.trim()).toBe('Resume');
    expect(element.querySelector('app-producer-status-badge')?.textContent).toContain('Paused');
  });

  it('marks the current page in the main navigation', async () => {
    const { element, navigate } = await boot('/');
    const current = () => element.querySelector('nav [aria-current="page"]')?.textContent.trim();

    expect(current()).toBe('Dashboard');
    await navigate('/settings');
    expect(current()).toBe('Settings');
  });

  it('moves focus to the new page heading after a navigation', async () => {
    const { element, navigate } = await boot('/');

    await navigate('/settings');

    expect(document.activeElement).toBe(element.querySelector('main h1'));
    expect(document.activeElement?.textContent).toBe('Producer settings');
  });

  it('identifies a local build in the footer', async () => {
    const { element } = await boot('/');

    expect(element.querySelector('footer')?.textContent.trim()).toBe('Local build');
  });
});
