/**
 * A batch of market updates in the wire layout described by `MarketUpdateField`.
 *
 * `records` may be a view over Wasm linear memory: it is valid only until the next call into
 * the source, must be consumed synchronously, and must never be stored or posted to another
 * thread (structured clone would copy the whole underlying memory).
 */
export interface MarketBatch {
  readonly records: Uint32Array;
  /** Index of the first word of the first record. */
  readonly offset: number;
  /** Number of records. */
  readonly count: number;
}

/** A stateful generator of market updates for one run. */
export interface MarketSource {
  /** Generates the next `size` updates, continuing from the state left by the previous call. */
  nextBatch(size: number): MarketBatch;
  /** Releases the generator. The source must not be used afterwards. */
  dispose(): void;
}

export type MarketSourceFactory = (instrumentCount: number, seed: bigint) => MarketSource;
