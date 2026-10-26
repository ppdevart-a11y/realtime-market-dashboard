/** Parameters of one producer run. All values are integers. */
export interface ProducerSettings {
  /** Number of instruments the generator quotes. */
  readonly instrumentCount: number;
  /** Total updates per batch, across all instruments (one instrument may repeat). */
  readonly updatesPerBatch: number;
  /** Requested time between batches, in milliseconds. */
  readonly batchIntervalMs: number;
}

export type ProducerSettingKey = keyof ProducerSettings;

/** Inclusive integer bounds. */
export interface IntegerRange {
  readonly min: number;
  readonly max: number;
}

/**
 * The single source of truth for what a valid run looks like: the settings form validates
 * against it and the worker re-checks every start command with it. The generator enforces the
 * same maxima natively, and the Wasm contract test asserts that both sides agree.
 */
export const PRODUCER_SETTINGS_LIMITS: Readonly<Record<ProducerSettingKey, IntegerRange>> = {
  instrumentCount: { min: 1, max: 50 },
  updatesPerBatch: { min: 1, max: 1_000 },
  batchIntervalMs: { min: 50, max: 2_000 },
};

export const DEFAULT_PRODUCER_SETTINGS: ProducerSettings = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};

/** Why a single setting is invalid, in the order the checks apply. */
export type SettingViolation = 'required' | 'integer' | 'min' | 'max';

/** Validates one setting; `null` means the value is acceptable. */
export function settingViolation(
  key: ProducerSettingKey,
  value: number | null,
): SettingViolation | null {
  if (value === null) {
    return 'required';
  }
  if (!Number.isInteger(value)) {
    return 'integer';
  }
  const { min, max } = PRODUCER_SETTINGS_LIMITS[key];
  if (value < min) {
    return 'min';
  }
  return value > max ? 'max' : null;
}

/**
 * Type guard for settings that arrive untyped, e.g. through `postMessage`.
 *
 * It must run before any value reaches the generator: wasm-bindgen converts JS numbers to `u32`
 * with wrapping (`1.9` → 1, `2 ** 32 + 5` → 5), so the Wasm side cannot tell a bad value apart.
 */
export function isProducerSettings(value: unknown): value is ProducerSettings {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<ProducerSettingKey, unknown>>;
  return (Object.keys(PRODUCER_SETTINGS_LIMITS) as ProducerSettingKey[]).every((key) => {
    const field = candidate[key];
    return typeof field === 'number' && settingViolation(key, field) === null;
  });
}

/** Nominal throughput of a run across all instruments, in updates per second. */
export function nominalUpdatesPerSecond(settings: ProducerSettings): number {
  return (settings.updatesPerBatch * 1_000) / settings.batchIntervalMs;
}
