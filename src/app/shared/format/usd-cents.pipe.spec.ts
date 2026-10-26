import { UsdCentsPipe } from './usd-cents.pipe';

describe('UsdCentsPipe', () => {
  const pipe = new UsdCentsPipe();

  it('formats integer cents as US dollars', () => {
    expect(pipe.transform(10_200)).toBe('$102.00');
    expect(pipe.transform(4)).toBe('$0.04');
    expect(pipe.transform(1_234_567)).toBe('$12,345.67');
  });

  it('rounds fractional cents (VWAP) only here, half away from zero', () => {
    expect(pipe.transform(10_150)).toBe('$101.50');
    expect(pipe.transform(10_000.5)).toBe('$100.01');
    expect(pipe.transform(10_000.49)).toBe('$100.00');
  });

  it('passes "unavailable" through for the view to render', () => {
    expect(pipe.transform(null)).toBeNull();
  });
});
