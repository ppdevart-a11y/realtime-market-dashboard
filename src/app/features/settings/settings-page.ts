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
import { MarketDataStore } from '../../market-data/market-data.store';
import { NumberField } from './number-field';
import { readNumberText } from './number-text';

/**
 * The form's model: each setting as the text in its field. Converting to numbers happens here,
 * with `readNumberText`, rather than in Signal Forms, whose `Number()` reading accepts far more
 * than the hints show.
 */
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

/** The number each field holds, or `null` for empty or unreadable text. */
function numbersOf(draft: SettingsDraft): Record<ProducerSettingKey, number | null> {
  const read = (text: string) => {
    const parsed = readNumberText(text);
    return parsed.kind === 'number' ? parsed.value : null;
  };
  return {
    instrumentCount: read(draft.instrumentCount),
    updatesPerBatch: read(draft.updatesPerBatch),
    batchIntervalMs: read(draft.batchIntervalMs),
  };
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
  imports: [FormRoot, NumberField],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  readonly #store = inject(MarketDataStore);
  /** Starts from the active run's settings each time the page opens. */
  readonly #draft = signal<SettingsDraft>(toDraft(this.#store.settings()));

  protected readonly fields = FIELDS;

  protected readonly settingsForm = form(
    this.#draft,
    (path) => {
      for (const { key } of FIELDS) {
        validate(path[key], ({ value }) => {
          const text = readNumberText(value());
          if (text.kind === 'unreadable') {
            return { kind: 'unreadable', message: UNREADABLE_MESSAGE };
          }
          const violation = settingViolation(key, text.kind === 'empty' ? null : text.value);
          return violation === null
            ? null
            : {
                kind: violation,
                message: violationMessage(violation, PRODUCER_SETTINGS_LIMITS[key]),
              };
        });
      }
    },
    {
      submission: {
        // `submit()` marks every field touched first, then runs exactly one of these.
        action: () => {
          this.#apply();
          return Promise.resolve();
        },
        onInvalid: () => {
          this.#focusFirstInvalidField();
        },
      },
    },
  );

  /** Confirmation for the polite live region; empty until the first successful apply. */
  protected readonly announcement = signal('');

  protected readonly preview = computed(() => {
    const settings = numbersOf(this.#draft());
    if (!isProducerSettings(settings)) {
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

  #apply(): void {
    const settings = numbersOf(this.#draft());
    // Always true here, because submission only reaches the action once every field is valid.
    if (!isProducerSettings(settings)) {
      return;
    }
    this.#store.apply({ ...settings });
    this.settingsForm().reset(toDraft(settings));
    this.announcement.set(`Run ${this.#store.runId()} started with the new settings.`);
  }

  #focusFirstInvalidField(): void {
    FIELDS.map(({ key }) => this.settingsForm[key])
      .find((field) => field().invalid())?.()
      .focusBoundControl();
  }
}
