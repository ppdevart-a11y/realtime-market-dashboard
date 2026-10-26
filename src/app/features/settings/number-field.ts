import { Component, computed, input } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';

/** The only error without a message: Signal Forms' own, for text that is not a number. */
const PARSE_ERROR_MESSAGE = 'Enter a number using digits only.';

let nextId = 0;

/**
 * A labelled input for a whole-number setting, bound to a Signal Forms field of `number | null`.
 *
 * A text input with `inputmode="numeric"` rather than `type="number"`: number inputs change value
 * on scroll, accept "e", and expose partial input inconsistently to assistive technology (the
 * GOV.UK Design System's reasoning). Signal Forms parses the text into the model: empty text
 * becomes `null` and anything that is not a number becomes a `parse` error.
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
  readonly field = input.required<FieldTree<number | null>>();
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
    return first === undefined ? null : (first.message ?? PARSE_ERROR_MESSAGE);
  });

  protected readonly describedBy = computed(() =>
    this.error() === null ? this.hintId : `${this.hintId} ${this.errorId}`,
  );
}
