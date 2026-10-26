import { orderBookImbalance, spreadCents, vwapCents } from './market-metrics';

describe('market metrics', () => {
  describe('spreadCents', () => {
    it('is ask minus bid (worked example: $101.96 / $102.00 → $0.04)', () => {
      expect(spreadCents(10_196, 10_200)).toBe(4);
    });

    it('is unavailable until both sides have been quoted', () => {
      expect(spreadCents(null, 10_200)).toBeNull();
      expect(spreadCents(10_196, null)).toBeNull();
      expect(spreadCents(null, null)).toBeNull();
    });
  });

  describe('vwapCents', () => {
    it('weights each trade by its quantity (worked example: 10 @ $100, 30 @ $102 → $101.50)', () => {
      const notionalCents = 10_000 * 10 + 10_200 * 30;

      expect(vwapCents(notionalCents, 40)).toBe(10_150);
    });

    it('keeps sub-cent precision; rounding is left to the view', () => {
      expect(vwapCents(10_000 + 10_001, 2)).toBe(10_000.5);
    });

    it('is unavailable while no volume has traded (zero denominator)', () => {
      expect(vwapCents(0, 0)).toBeNull();
    });
  });

  describe('orderBookImbalance', () => {
    it('is (bid − ask) / (bid + ask) (worked example: 600 / 400 → 0.20)', () => {
      expect(orderBookImbalance(600, 400)).toBe(0.2);
    });

    it('is negative when the ask side is heavier and bounded by ±1 when one side is empty', () => {
      expect(orderBookImbalance(400, 600)).toBe(-0.2);
      expect(orderBookImbalance(500, 0)).toBe(1);
      expect(orderBookImbalance(0, 500)).toBe(-1);
    });

    it('is unavailable when both sides are empty (zero denominator)', () => {
      expect(orderBookImbalance(0, 0)).toBeNull();
    });

    it('is unavailable until both quantities are known', () => {
      expect(orderBookImbalance(null, 400)).toBeNull();
      expect(orderBookImbalance(600, null)).toBeNull();
    });
  });
});
