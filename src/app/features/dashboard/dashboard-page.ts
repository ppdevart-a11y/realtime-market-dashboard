import { Component, inject } from '@angular/core';
import { ProducerFailure } from '../../layout/producer-failure';
import { MarketDataStore } from '../../market-data/market-data.store';
import { MarketTable } from './market-table';
import { ProducerControls } from './producer-controls';

@Component({
  selector: 'app-dashboard-page',
  imports: [MarketTable, ProducerControls, ProducerFailure],
  template: `
    <div class="page-header">
      <h1 tabindex="-1">Live market</h1>
      <app-producer-controls />
      <app-producer-failure>Restart the producer to try again.</app-producer-failure>
    </div>
    <app-market-table [rows]="store.instruments()" />
  `,
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  protected readonly store = inject(MarketDataStore);
}
