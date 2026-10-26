import { ImbalancePipe } from './imbalance.pipe';

describe('ImbalancePipe', () => {
  const pipe = new ImbalancePipe();

  it('shows two decimals with an explicit sign, using a true minus', () => {
    expect(pipe.transform(0.2)).toBe('+0.20');
    expect(pipe.transform(-0.2)).toBe('−0.20');
    expect(pipe.transform(1)).toBe('+1.00');
    expect(pipe.transform(-1)).toBe('−1.00');
  });

  it('never shows a signed zero', () => {
    expect(pipe.transform(0)).toBe('0.00');
    expect(pipe.transform(-0.001)).toBe('0.00');
    expect(pipe.transform(0.004)).toBe('0.00');
  });

  it('passes "unavailable" through for the view to render', () => {
    expect(pipe.transform(null)).toBeNull();
  });
});
