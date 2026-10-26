import { Component, computed, inject } from '@angular/core';
import { MarketDataStore } from '../market-data/market-data.store';

/**
 * Why the producer stopped, announced as an alert, followed by whatever the page offers to recover
 * (projected content). Pages place it next to their own recovery action.
 */
@Component({
  selector: 'app-producer-failure',
  template: `
    @if (message(); as text) {
      <p role="alert">{{ text }} <ng-content /></p>
    }
  `,
  styleUrl: './producer-failure.scss',
})
export class ProducerFailure {
  readonly #status = inject(MarketDataStore).status;

  protected readonly message = computed(() => {
    const status = this.#status();
    return status.kind === 'error' ? status.message : null;
  });
}
