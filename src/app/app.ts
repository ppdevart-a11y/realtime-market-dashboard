import { afterNextRender, Component, ElementRef, inject, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';
import { buildSha } from './build-info';
import { ProducerStatusBadge } from './layout/producer-status-badge';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ProducerStatusBadge],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly buildSha = buildSha;

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const injector = inject(Injector);
    // A client-side navigation does not move focus the way a page load does; put it on the new
    // page's heading so keyboard and screen-reader users start at the content they asked for.
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        skip(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        afterNextRender(
          {
            write: () => {
              host.nativeElement.querySelector<HTMLElement>('main h1')?.focus();
            },
          },
          { injector },
        );
      });
  }
}
