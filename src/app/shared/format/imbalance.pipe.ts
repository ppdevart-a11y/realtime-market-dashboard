import { Pipe, type PipeTransform } from '@angular/core';

const ratio = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});

/**
 * Formats an order-book imbalance in [-1, 1] as a signed two-decimal value ("+0.20").
 * `exceptZero` also suppresses the sign of values that round to zero, so "-0.00" never appears.
 * The hyphen is replaced by U+2212 MINUS SIGN, which aligns with "+" and reads as "minus".
 */
@Pipe({ name: 'imbalance' })
export class ImbalancePipe implements PipeTransform {
  transform(imbalance: number | null): string | null {
    return imbalance === null ? null : ratio.format(imbalance).replace('-', '−');
  }
}
