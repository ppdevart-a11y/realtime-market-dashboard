import { Pipe, type PipeTransform } from '@angular/core';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * Formats integer or fractional cents as US dollars. This is the only place calculated prices
 * (VWAP) are rounded. `null` (unavailable) is passed through for the template to render.
 */
@Pipe({ name: 'usdCents' })
export class UsdCentsPipe implements PipeTransform {
  transform(cents: number | null): string | null {
    return cents === null ? null : usd.format(cents / 100);
  }
}
