import { Component, computed, inject, signal } from '@angular/core';
import { form, FormRoot, validate } from '@angular/forms/signals';
import {
  DEFAULT_PRODUCER_SETTINGS,
  type IntegerRange,
  isProducerSettings,
  nominalUpdatesPerSecond,
  PRODUCER_SETTINGS_LIMITS,
  type ProducerSettingKey,
  type SettingViolation,
  settingViolation,
} from '../../domain/producer-settings';
import { MarketDataStore } from '../../market-data/market-data.store';
import { NumberField } from './number-field';

/** The form's model: the producer settings, except that a field may be empty while edited. */
type SettingsDraft = Record<ProducerSettingKey, number | null>;

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

/**
 * Edits the producer settings as a draft. Nothing reaches the producer until the form is
 * submitted, and a valid submit always starts a new run, also with unchanged values and from a
 * pause, so "Apply settings" doubles as the restart.
 *
 * Validation delegates to `settingViolation`, the rule the worker applies to every start command,
 * so the form and the producer cannot disagree about what is valid.
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
  readonly #draft = signal<SettingsDraft>({ ...this.#store.settings() });

  protected readonly fields = FIELDS;

  protected readonly settingsForm = form(
    this.#draft,
    (path) => {
      for (const { key } of FIELDS) {
        validate(path[key], ({ value }) => {
          const violation = settingViolation(key, value());
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
    const draft = this.#draft();
    // A field with unparseable text keeps its last valid value in the model, so check validity too.
    if (this.settingsForm().invalid() || !isProducerSettings(draft)) {
      return 'The resulting rate appears here once every value is valid.';
    }
    return (
      `${updates(draft.updatesPerBatch)} every ${quantity.format(draft.batchIntervalMs)} ms is ` +
      `${updates(nominalUpdatesPerSecond(draft))} per second across all instruments.`
    );
  });

  protected readonly hasUnsavedChanges = computed(() => {
    const draft = this.#draft();
    const active = this.#store.settings();
    return this.settingsForm().invalid() || FIELDS.some(({ key }) => draft[key] !== active[key]);
  });

  /** Changes only the form; the defaults reach the producer when they are applied. */
  protected resetToDefaults(): void {
    this.settingsForm().reset({ ...DEFAULT_PRODUCER_SETTINGS });
  }

  #apply(): void {
    const draft = this.#draft();
    // Always true here, because submission only reaches the action once every field is valid.
    if (!isProducerSettings(draft)) {
      return;
    }
    this.#store.apply({ ...draft });
    this.settingsForm().reset();
    this.announcement.set(`Run ${this.#store.runId()} started with the new settings.`);
  }

  #focusFirstInvalidField(): void {
    FIELDS.map(({ key }) => this.settingsForm[key])
      .find((field) => field().invalid())?.()
      .focusBoundControl();
  }
}
