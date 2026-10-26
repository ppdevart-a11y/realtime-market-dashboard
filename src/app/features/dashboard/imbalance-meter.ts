import { Component, computed, input } from '@angular/core';

/**
 * A diverging bar centred on zero: bid-heavy books extend right in the bid colour, ask-heavy
 * books extend left in the ask colour. Decorative only; the numeric value next to it carries the
 * information for assistive technology. Drawn with a transform, so updates stay on the compositor.
 */
@Component({
  selector: 'app-imbalance-meter',
  template: '<span class="fill"></span>',
  styleUrl: './imbalance-meter.scss',
  host: {
    'aria-hidden': 'true',
    '[style.--imbalance]': 'magnitude()',
    '[class.ask-heavy]': 'askHeavy()',
  },
})
export class ImbalanceMeter {
  /** Order-book imbalance in [-1, 1]; `null` renders an empty track. */
  readonly value = input.required<number | null>();

  protected readonly magnitude = computed(() => Math.abs(this.value() ?? 0));
  protected readonly askHeavy = computed(() => (this.value() ?? 0) < 0);
}
