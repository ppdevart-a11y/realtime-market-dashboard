# 3. Aggregating metrics in the worker

Status: accepted

## Context

Every generated trade must contribute to volume and VWAP exactly once, while the interface may
refresh less often than data is produced. The complete event history must not be retained. The
assignment leaves open where the metrics are calculated.

## Decision

- `MarketAggregator` (`src/app/domain`, plain TypeScript) runs in the worker. Per instrument it
  keeps the last trade price and its direction, the latest bid and ask and their quantities, and
  the cumulative volume and notional (price × quantity, in cents). It keeps no history.
- After every batch the worker posts one cumulative snapshot: the final metrics per instrument,
  computed by the pure functions in `market-metrics.ts` (spread, VWAP, imbalance, with `null` for
  unavailable values and zero denominators), plus the run's total update count.
- The main thread only attaches symbols to the rows and renders them. Prices are rounded only by
  the view's formatting pipes.

## Consequences

- Each trade is counted before any throttling, so skipping snapshots later can never skip trades.
- The message size depends on the number of instruments (at most 50 rows), not on the update rate.
- The metric formulas, including the assignment's worked example and the zero-denominator rules,
  are tested once, in one place, and the same files run in the worker and in the UI.
- Volume and notional are integers held in doubles. They stay exact for at least 2.9 × 10⁸ trades
  per instrument (the generator's price ceiling of 62,500¢ times its maximum trade of 500); past
  that the relative error is about 10⁻¹⁶, far below a cent.

## Alternatives considered

- **Posting raw updates to the main thread.** Up to 20,000 updates per second would cross the
  thread boundary, and every one would have to be processed on the UI thread even when nothing is
  rendered.
- **Computing metrics in Rust.** Possible, but the formulas are dashboard semantics (what
  "unavailable" means, how the worked example rounds) and read best next to the UI's types and
  tests. The Wasm library's job is to generate updates.
- **Posting raw cumulative state and computing metrics on the main thread.** The same message size;
  sending final metrics makes the snapshot exactly what the table shows.
