import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import type { InstrumentRow } from '../../market-data/market-data.store';
import { ImbalancePipe } from '../../shared/format/imbalance.pipe';
import { UsdCentsPipe } from '../../shared/format/usd-cents.pipe';
import { ImbalanceMeter } from './imbalance-meter';

/**
 * Live metrics, one row per instrument. A native table rather than a virtualised list: at most
 * fifty rows render cheaply, and real rows keep find-in-page and screen-reader table navigation.
 * Rows are tracked by symbol, so each frame only patches the text nodes whose values changed.
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
