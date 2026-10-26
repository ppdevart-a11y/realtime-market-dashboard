import { Component, computed, inject } from '@angular/core';
import { MarketDataStore } from '../market-data/market-data.store';

/**
 * The producer's state, visible on every page. It is the only live region for producer state, so
 * a state change is announced once, wherever the user is; counters never enter a live region.
 */
@Component({
  selector: 'app-producer-status-badge',
  template: `
    <span class="dot" aria-hidden="true"></span>
    <span class="visually-hidden">Producer status:</span>
    {{ label() }}
  `,
  styleUrl: './producer-status-badge.scss',
  host: { role: 'status', '[attr.data-state]': 'state()' },
})
export class ProducerStatusBadge {
  readonly #status = inject(MarketDataStore).status;

  protected readonly state = computed(() => this.#status().kind);

  protected readonly label = computed(() => {
    const status = this.#status();
    switch (status.kind) {
      case 'starting':
        return status.paused ? 'Starting (paused)' : 'Starting';
      case 'running':
        return 'Running';
      case 'paused':
        return 'Paused';
      case 'error':
        return 'Error';
    }
  });
}
