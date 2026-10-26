import { DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { nominalUpdatesPerSecond } from '../../domain/producer-settings';
import { MarketDataStore } from '../../market-data/market-data.store';

/** Facts about the active run and the one control that pauses, resumes or restarts its producer. */
@Component({
  selector: 'app-producer-controls',
  imports: [DecimalPipe],
  templateUrl: './producer-controls.html',
  styleUrl: './producer-controls.scss',
})
export class ProducerControls {
  protected readonly store = inject(MarketDataStore);

  protected readonly nominalRate = computed(() => nominalUpdatesPerSecond(this.store.settings()));

  readonly #failed = computed(() => this.store.status().kind === 'error');

  // One button whose label says what it will do. It is never replaced, so it keeps keyboard focus
  // when the producer fails or restarts.
  protected readonly actionLabel = computed(() => {
    if (this.#failed()) {
      return 'Restart producer';
    }
    return this.store.paused() ? 'Resume' : 'Pause';
  });

  protected act(): void {
    if (this.#failed()) {
      this.store.retry();
    } else if (this.store.paused()) {
      this.store.resume();
    } else {
      this.store.pause();
    }
  }
}
