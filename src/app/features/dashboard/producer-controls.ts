import { DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { nominalUpdatesPerSecond } from '../../domain/producer-settings';
import { MarketDataStore } from '../../market-data/market-data.store';

/** Facts about the active run and the control to pause, resume or restart its producer. */
@Component({
  selector: 'app-producer-controls',
  imports: [DecimalPipe],
  templateUrl: './producer-controls.html',
  styleUrl: './producer-controls.scss',
})
export class ProducerControls {
  protected readonly store = inject(MarketDataStore);

  protected readonly nominalRate = computed(() => nominalUpdatesPerSecond(this.store.settings()));

  protected readonly paused = computed(() => {
    const status = this.store.status();
    return status.kind === 'paused' || (status.kind === 'starting' && status.paused);
  });

  protected readonly failure = computed(() => {
    const status = this.store.status();
    return status.kind === 'error' ? status.message : null;
  });

  protected togglePause(): void {
    if (this.paused()) {
      this.store.resume();
    } else {
      this.store.pause();
    }
  }
}
