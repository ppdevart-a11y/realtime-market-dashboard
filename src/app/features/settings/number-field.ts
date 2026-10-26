import { Component, computed, input } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';

/** Shown for an error that carries no message; the validators in this app always supply one. */
const FALLBACK_ERROR_MESSAGE = 'Enter a valid value.';

let nextId = 0;

/**
 * Text input, `inputmode="numeric"`, not `type="number"` (scroll changes the value, accepts "e";
 * GOV.UK). Holds raw text that the form parses strictly; errors and their ARIA links appear once
 * the field is touched.
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
  protected readonly inputId = `number-field-${this.#id}`;
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
