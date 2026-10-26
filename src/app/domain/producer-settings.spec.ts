import {
  DEFAULT_PRODUCER_SETTINGS,
  isProducerSettings,
  nominalUpdatesPerSecond,
  PRODUCER_SETTINGS_LIMITS,
  settingViolation,
} from './producer-settings';

describe('producer settings', () => {
  it('starts from the documented defaults, which are themselves valid', () => {
    expect(DEFAULT_PRODUCER_SETTINGS).toEqual({
      instrumentCount: 5,
      updatesPerBatch: 100,
      batchIntervalMs: 500,
    });
    expect(isProducerSettings(DEFAULT_PRODUCER_SETTINGS)).toBe(true);
  });

  it('enforces the documented integer ranges', () => {
    expect(PRODUCER_SETTINGS_LIMITS).toEqual({
      instrumentCount: { min: 1, max: 50 },
      updatesPerBatch: { min: 1, max: 1_000 },
      batchIntervalMs: { min: 50, max: 2_000 },
    });
  });

  describe('settingViolation', () => {
    it('accepts integers on and between the bounds', () => {
      expect(settingViolation('instrumentCount', 1)).toBeNull();
      expect(settingViolation('instrumentCount', 50)).toBeNull();
      expect(settingViolation('batchIntervalMs', 50)).toBeNull();
      expect(settingViolation('updatesPerBatch', 1_000)).toBeNull();
    });

    it('requires a value', () => {
      expect(settingViolation('updatesPerBatch', null)).toBe('required');
    });

    it('rejects fractions before checking the range', () => {
      expect(settingViolation('instrumentCount', 2.5)).toBe('integer');
      expect(settingViolation('instrumentCount', 50.5)).toBe('integer');
      expect(settingViolation('instrumentCount', Number.NaN)).toBe('integer');
    });

    it('reports which bound was crossed', () => {
      expect(settingViolation('instrumentCount', 0)).toBe('min');
      expect(settingViolation('instrumentCount', 51)).toBe('max');
      expect(settingViolation('batchIntervalMs', 49)).toBe('min');
      expect(settingViolation('updatesPerBatch', 1_001)).toBe('max');
    });
  });

  describe('isProducerSettings', () => {
    it.each([
      ['null', null],
      ['a string', '5,100,500'],
      ['a missing field', { instrumentCount: 5, updatesPerBatch: 100 }],
      ['a numeric string', { ...DEFAULT_PRODUCER_SETTINGS, instrumentCount: '5' }],
      ['a fraction', { ...DEFAULT_PRODUCER_SETTINGS, updatesPerBatch: 1.9 }],
      ['an out-of-range value', { ...DEFAULT_PRODUCER_SETTINGS, batchIntervalMs: 10 }],
    ])('rejects %s', (_, value) => {
      expect(isProducerSettings(value)).toBe(false);
    });
  });

  it('derives the nominal rate across all instruments (100 every 500 ms → 200/s)', () => {
    expect(nominalUpdatesPerSecond(DEFAULT_PRODUCER_SETTINGS)).toBe(200);
    expect(
      nominalUpdatesPerSecond({ instrumentCount: 1, updatesPerBatch: 1_000, batchIntervalMs: 50 }),
    ).toBe(20_000);
  });
});
