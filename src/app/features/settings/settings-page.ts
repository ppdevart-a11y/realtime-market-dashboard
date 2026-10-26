import { Component, computed, inject, signal } from '@angular/core';
import { form, FormRoot, validate } from '@angular/forms/signals';
import {
  DEFAULT_PRODUCER_SETTINGS,
  type IntegerRange,
  isProducerSettings,
  nominalUpdatesPerSecond,
  PRODUCER_SETTINGS_LIMITS,
  type ProducerSettingKey,
  type ProducerSettings,
  type SettingViolation,
  settingViolation,
} from '../../domain/producer-settings';
import { ProducerFailure } from '../../layout/producer-failure';
import { MarketDataStore } from '../../market-data/market-data.store';
import { NumberField } from './number-field';
import { readNumberText } from './number-text';

/** The form's model: each setting as the text in its field, read with `readNumberText`. */
type SettingsDraft = Record<ProducerSettingKey, string>;

const quantity = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const plural = new Intl.PluralRules('en-US');

function updates(count: number): string {
  return `${quantity.format(count)} ${plural.select(count) === 'one' ? 'update' : 'updates'}`;
}

function rangeOf(key: ProducerSettingKey): string {
  const { min, max } = PRODUCER_SETTINGS_LIMITS[key];
  return `from ${quantity.format(min)} to ${quantity.format(max)}`;
}

/** Label and hint per setting. Typed as a record, so a new setting cannot lack its copy. */
const FIELD_COPY = {
  instrumentCount: {
    label: 'Instrument count',
    hint: `Whole number ${rangeOf('instrumentCount')}.`,
  },
  updatesPerBatch: {
    label: 'Updates per batch',
    hint: `Whole number ${rangeOf('updatesPerBatch')}, shared by all instruments.`,
  },
  batchIntervalMs: {
    label: 'Batch interval',
    hint: `Whole number of milliseconds ${rangeOf('batchIntervalMs')}.`,
  },
} satisfies Record<ProducerSettingKey, { readonly label: string; readonly hint: string }>;

/** The fields in display order, which is also the order invalid fields receive focus. */
const FIELDS = (Object.keys(FIELD_COPY) as ProducerSettingKey[]).map((key) => ({
  key,
  ...FIELD_COPY[key],
}));

/** For text that is not a number in the hints' format, such as `0x10`, `1e1` or `-5`. */
const UNREADABLE_MESSAGE = 'Enter a whole number using digits, such as 500 or 1,000.';

function violationMessage(violation: SettingViolation, { min, max }: IntegerRange): string {
  switch (violation) {
    case 'required':
      return 'Enter a value.';
    case 'integer':
      return 'Enter a whole number.';
    case 'min':
      return `Enter ${quantity.format(min)} or more.`;
    case 'max':
      return `Enter ${quantity.format(max)} or less.`;
  }
}

/** Shows settings the way the hints print numbers ("1,000"), which `readNumberText` reads back. */
function toDraft(settings: ProducerSettings): SettingsDraft {
  return {
    instrumentCount: quantity.format(settings.instrumentCount),
    updatesPerBatch: quantity.format(settings.updatesPerBatch),
    batchIntervalMs: quantity.format(settings.batchIntervalMs),
  };
}

/** The whole number each field holds, or `null` for any other text. */
function numbersOf(draft: SettingsDraft): Record<ProducerSettingKey, number | null> {
  const read = (text: string) => {
    const parsed = readNumberText(text);
    return parsed.kind === 'whole' ? parsed.value : null;
  };
  return {
    instrumentCount: read(draft.instrumentCount),
    updatesPerBatch: read(draft.updatesPerBatch),
    batchIntervalMs: read(draft.batchIntervalMs),
  };
}

/**
 * The settings the draft describes, or `null` unless every field holds a valid value. Uses the
 * same rules as the field validators, so it is the form's validity and its value in one reading.
 */
function readSettings(draft: SettingsDraft): ProducerSettings | null {
  const values = numbersOf(draft);
  return isProducerSettings(values) ? values : null;
}

/**
 * Edits the producer settings as a draft. Nothing reaches the producer until the form is
 * submitted, and a valid submit always starts a new run, also with unchanged values and from a
 * pause, so "Apply settings" doubles as the restart.
 *
 * Validation delegates to `settingViolation`, the rule the worker applies to every start command,
 * so the form and the producer cannot disagree about what is valid. The form itself only adds the
 * rule for text it cannot read.
 */
@Component({
  selector: 'app-settings-page',
  imports: [FormRoot, NumberField, ProducerFailure],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  readonly #store = inject(MarketDataStore);
  /** Starts from the active run's settings each time the page opens. */
  readonly #draft = signal<SettingsDraft>(toDraft(this.#store.settings()));

  protected readonly fields = FIELDS;

  protected readonly settingsForm = form(this.#draft, (path) => {
    for (const { key } of FIELDS) {
      validate(path[key], ({ value }) => {
        const text = readNumberText(value());
        if (text.kind === 'unreadable') {
          return { kind: 'unreadable', message: UNREADABLE_MESSAGE };
        }
        const violation =
          text.kind === 'fraction'
            ? 'integer'
            : settingViolation(key, text.kind === 'whole' ? text.value : null);
        return violation === null
          ? null
          : {
              kind: violation,
              message: violationMessage(violation, PRODUCER_SETTINGS_LIMITS[key]),
            };
      });
    }
  });

  /** Confirmation for the polite live region; empty until the first successful apply. */
  protected readonly announcement = signal('');

  protected readonly preview = computed(() => {
    const settings = readSettings(this.#draft());
    if (settings === null) {
      return 'The resulting rate appears here once every value is valid.';
    }
    return (
      `${updates(settings.updatesPerBatch)} every ${quantity.format(settings.batchIntervalMs)} ms ` +
      `is ${updates(nominalUpdatesPerSecond(settings))} per second across all instruments.`
    );
  });

  /** Compares numbers, not text, so " 5 " or "1,000" for an unchanged value is no change. */
  protected readonly hasUnsavedChanges = computed(() => {
    const values = numbersOf(this.#draft());
    const active = this.#store.settings();
    return FIELDS.some(({ key }) => values[key] !== active[key]);
  });

  /** Changes only the form; the defaults reach the producer when they are applied. */
  protected resetToDefaults(): void {
    this.settingsForm().reset(toDraft(DEFAULT_PRODUCER_SETTINGS));
  }

  /**
   * Submits the form (Apply settings or Enter). Valid settings start a new run; otherwise every
   * error is revealed and the first invalid field receives focus.
   *
   * Handled here rather than through Signal Forms' `submit()`, whose action must return a promise:
   * applying is synchronous, and the reading that decides validity also yields the values.
   */
  protected applySettings(): void {
    const settings = readSettings(this.#draft());
    if (settings === null) {
      this.settingsForm().markAsTouched();
      this.#focusFirstInvalidField();
      return;
    }
    this.#store.apply(settings);
    // Shows the values as the hints print them, and clears touched state for the next edit.
    this.settingsForm().reset(toDraft(settings));
    // The worker has not confirmed the run yet; the status badge announces when it is running.
    this.announcement.set(`Settings applied. Run ${this.#store.runId()} is starting.`);
  }

  #focusFirstInvalidField(): void {
    for (const { key } of FIELDS) {
      const field = this.settingsForm[key]();
      if (field.invalid()) {
        field.focusBoundControl();
        return;
      }
    }
  }
}
