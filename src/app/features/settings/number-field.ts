import { Component, computed, input } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';

/** Shown for an error that carries no message; the validators in this app always supply one. */
const FALLBACK_ERROR_MESSAGE = 'Enter a valid value.';

let nextId = 0;

/**
 * A labelled input for a whole-number setting, bound to a Signal Forms field that holds the text
 * exactly as typed.
 *
 * A text input with `inputmode="numeric"` rather than `type="number"`: number inputs change value
 * on scroll, accept "e", and expose partial input inconsistently to assistive technology (the
 * GOV.UK Design System's reasoning). The field stays text because Signal Forms would read a numeric
 * model with `Number()`, which also accepts `0x10` and `1e1`; the form reads the text with its own
 * strict rules instead (`readNumberText`).
 *
 * The hint is always linked to the input. An error is shown, and linked through `aria-invalid`
 * and `aria-describedby`, only once the field has been touched (left, or the form submitted), so
 * nothing is flagged while a value is still being typed.
 */
@Component({
  selector: 'app-number-field',
  imports: [FormField],
  template: `
    <label [for]="inputId">{{ label() }}</label>
    <p class="hint" [id]="hintId">{{ hint() }}</p>
    @if (error(); as message) {
      <p class="error" [id]="errorId">
        <span class="visually-hidden">Error:</span>
        {{ message }}
      </p>
    }
    <input
      type="text"
      inputmode="numeric"
      autocomplete="off"
      spellcheck="false"
      aria-required="true"
      [id]="inputId"
      [formField]="field()"
      [attr.aria-invalid]="error() === null ? null : 'true'"
      [attr.aria-describedby]="describedBy()"
    />
  `,
  styleUrl: './number-field.scss',
})
export class NumberField {
  readonly field = input.required<FieldTree<string>>();
  readonly label = input.required<string>();
  /** States what the field accepts, including the allowed range. */
  readonly hint = input.required<string>();

  readonly #id = ++nextId;
  protected readonly inputId = `number-field-${String(this.#id)}`;
  protected readonly hintId = `${this.inputId}-hint`;
  protected readonly errorId = `${this.inputId}-error`;

  /** The first error to show, or `null` while the field is valid or untouched. */
  protected readonly error = computed(() => {
    const state = this.field()();
    if (!state.touched()) {
      return null;
    }
    const first = state.errors().at(0);
    return first === undefined ? null : (first.message ?? FALLBACK_ERROR_MESSAGE);
  });

  protected readonly describedBy = computed(() =>
    this.error() === null ? this.hintId : `${this.hintId} ${this.errorId}`,
  );
}
