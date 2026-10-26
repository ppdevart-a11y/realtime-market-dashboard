/**
 * Dashboard metric formulas. Inputs are integer cents and quantities as produced by the
 * generator; outputs are unrounded, because rounding is a presentation concern. `null` means
 * "unavailable": an input has not been observed yet or the formula's denominator is zero.
 */

/** Ask minus bid, in cents. */
export function spreadCents(bidCents: number | null, askCents: number | null): number | null {
  return bidCents === null || askCents === null ? null : askCents - bidCents;
}

/**
 * Volume-weighted average price, in (fractional) cents: `Σ(price × quantity) / Σ quantity`.
 *
 * @param notionalCents cumulative `price × quantity` of every trade in the run
 * @param volume cumulative traded quantity in the run
 */
export function vwapCents(notionalCents: number, volume: number): number | null {
  return volume === 0 ? null : notionalCents / volume;
}

/**
 * `(bid − ask) / (bid + ask)` over the latest displayed book quantities, in `[-1, 1]`.
 * Positive values mean more resting buy interest than sell interest.
 */
export function orderBookImbalance(
  bidQuantity: number | null,
  askQuantity: number | null,
): number | null {
  if (bidQuantity === null || askQuantity === null) {
    return null;
  }
  const depth = bidQuantity + askQuantity;
  return depth === 0 ? null : (bidQuantity - askQuantity) / depth;
}
