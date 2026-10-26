import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import type { InstrumentRow } from '../../market-data/market-data.store';
import { ImbalancePipe } from '../../shared/format/imbalance.pipe';
import { UsdCentsPipe } from '../../shared/format/usd-cents.pipe';
import { ImbalanceMeter } from './imbalance-meter';

/**
 * Live metrics, one row per instrument, in a native table: at most 50 rows, and real rows keep
 * find-in-page and table navigation for screen readers. Rows are tracked by symbol, so a frame
 * patches only the text that changed.
 */
@Component({
  selector: 'app-market-table',
  imports: [DecimalPipe, NgTemplateOutlet, UsdCentsPipe, ImbalancePipe, ImbalanceMeter],
  templateUrl: './market-table.html',
  styleUrl: './market-table.scss',
})
export class MarketTable {
  readonly rows = input.required<readonly InstrumentRow[]>();
}
