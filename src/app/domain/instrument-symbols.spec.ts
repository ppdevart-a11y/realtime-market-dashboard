import { EXCLUDED_SYMBOLS, instrumentSymbols } from './instrument-symbols';

// Comfortably above any instrument limit the app could adopt, below the ~10,000-word space.
const LARGE_DIRECTORY = 9_000;

describe('instrumentSymbols', () => {
  it('opens with the symbols used in the specification', () => {
    expect(instrumentSymbols(2)).toEqual(['ALFA', 'BETA']);
  });

  it('is deterministic and prefix-stable, so growing a run never renames an instrument', () => {
    expect(instrumentSymbols(50).slice(0, 5)).toEqual(instrumentSymbols(5));
  });

  it('produces unique four-letter symbols', () => {
    const symbols = instrumentSymbols(LARGE_DIRECTORY);

    expect(new Set(symbols).size).toBe(LARGE_DIRECTORY);
    expect(symbols.every((symbol) => /^[A-Z]{4}$/.test(symbol))).toBe(true);
  });

  it('never emits an excluded symbol', () => {
    const symbols = new Set(instrumentSymbols(LARGE_DIRECTORY));

    expect([...EXCLUDED_SYMBOLS].filter((symbol) => symbols.has(symbol))).toEqual([]);
  });

  it('refuses to invent more symbols than it can keep unique', () => {
    expect(() => instrumentSymbols(10_001)).toThrow(RangeError);
  });
});
