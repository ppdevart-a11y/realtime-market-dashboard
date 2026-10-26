import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NEVER } from 'rxjs';
import { App } from './app';
import { routes } from './app.routes';
import { PRODUCER_TRANSPORT_FACTORY } from './market-data/producer-transport';

describe('App shell', () => {
  async function render(url = '/') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        {
          provide: PRODUCER_TRANSPORT_FACTORY,
          useValue: () => ({ events$: NEVER, send: () => undefined, dispose: () => undefined }),
        },
      ],
    });
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const navigate = async (to: string) => {
      await router.navigateByUrl(to);
      await fixture.whenStable();
    };
    return { element, navigate };
  }

  it('marks the current page in the main navigation', async () => {
    const { element, navigate } = await render();
    const current = () => element.querySelector('nav [aria-current="page"]')?.textContent.trim();

    expect(current()).toBe('Dashboard');
    await navigate('/settings');
    expect(current()).toBe('Settings');
  });

  it('moves focus to the new page heading after a navigation', async () => {
    const { element, navigate } = await render();

    await navigate('/settings');

    expect(document.activeElement).toBe(element.querySelector('main h1'));
    expect(document.activeElement?.textContent).toBe('Producer settings');
  });

  it('identifies a local build in the footer', async () => {
    const { element } = await render();

    expect(element.querySelector('footer')?.textContent.trim()).toBe('Local build');
  });
});
