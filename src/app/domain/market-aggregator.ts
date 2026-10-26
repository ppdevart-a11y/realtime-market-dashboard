import { orderBookImbalance, spreadCents, vwapCents } from './market-metrics';
import { MARKET_UPDATE_WORDS, MarketUpdateField as Field } from './market-update';

/** Direction of the latest trade price relative to the previous trade of the same instrument. */
export type PriceTick = 'up' | 'down' | 'unchanged';

/** Dashboard metrics of one instrument; `null` marks a value that is not available yet. */
export interface InstrumentSnapshot {
  readonly lastPriceCents: number | null;
  /** `null` until the instrument has traded twice. */
  readonly lastTick: PriceTick | null;
  readonly spreadCents: number | null;
  readonly volume: number;
  /** Fractional cents; rounded only for display. */
  readonly vwapCents: number | null;
  readonly imbalance: number | null;
}

interface InstrumentState {
  lastPriceCents: number | null;
  lastTick: PriceTick | null;
  bidCents: number | null;
  askCents: number | null;
  bidQuantity: number | null;
  askQuantity: number | null;
  volume: number;
  notionalCents: number;
}

/**
 * Folds market updates into cumulative per-instrument state for the current run.
 *
 * Constant memory: it keeps the latest book and running totals per instrument, never the event
 * history. Volume and notional are integers in doubles and stay exact below 2^53; at the
 * generator's price ceiling (62,500¢) and maximum trade size (500) that is ≥ 2.9e8 trades per
 * instrument, i.e. hours at the maximum rate. Past that the relative error (~1e-16) is still far
 * below the display precision of a cent.
 */
export class MarketAggregator {
  readonly #instruments: InstrumentState[];
  #totalUpdates = 0;

  constructor(instrumentCount: number) {
    this.#instruments = Array.from({ length: instrumentCount }, () => ({
      lastPriceCents: null,
      lastTick: null,
      bidCents: null,
      askCents: null,
      bidQuantity: null,
      askQuantity: null,
      volume: 0,
      notionalCents: 0,
    }));
  }

  /** Number of updates applied since the aggregator was created. */
  get totalUpdates(): number {
    return this.#totalUpdates;
  }

  /**
   * Applies `count` records starting at word `offset` of `records`.
   *
   * `records` may be a view over Wasm linear memory that is overwritten by the next generator call,
   * so every value is copied out here and the array itself is never retained. The batch is
   * validated before anything is applied: it is applied entirely or not at all.
   *
   * @throws {RangeError} if the window exceeds `records` or a record names an unknown instrument.
   */
  applyBatch(records: Uint32Array, offset: number, count: number): void {
    const end = offset + count * MARKET_UPDATE_WORDS;
    if (offset < 0 || end > records.length) {
      throw new RangeError(`Batch [${offset}, ${end}) exceeds the ${records.length}-word buffer`);
    }
    for (let at = offset; at < end; at += MARKET_UPDATE_WORDS) {
      const instrument = records[at + Field.Instrument];
      if (instrument >= this.#instruments.length) {
        throw new RangeError(
          `Update for instrument ${instrument} exceeds the ${this.#instruments.length} instruments of this run`,
        );
      }
    }

    for (let at = offset; at < end; at += MARKET_UPDATE_WORDS) {
      const state = this.#instruments[records[at + Field.Instrument]];
      const priceCents = records[at + Field.PriceCents];
      const tradeQuantity = records[at + Field.TradeQuantity];

      if (state.lastPriceCents !== null) {
        state.lastTick = tickBetween(state.lastPriceCents, priceCents);
      }
      state.lastPriceCents = priceCents;
      state.volume += tradeQuantity;
      state.notionalCents += priceCents * tradeQuantity;
      state.bidCents = records[at + Field.BidCents];
      state.askCents = records[at + Field.AskCents];
      state.bidQuantity = records[at + Field.BidQuantity];
      state.askQuantity = records[at + Field.AskQuantity];
    }
    this.#totalUpdates += count;
  }

  /** Current metrics of every instrument, indexed by instrument; safe to post to another thread. */
  snapshot(): InstrumentSnapshot[] {
    return this.#instruments.map((state) => ({
      lastPriceCents: state.lastPriceCents,
      lastTick: state.lastTick,
      spreadCents: spreadCents(state.bidCents, state.askCents),
      volume: state.volume,
      vwapCents: vwapCents(state.notionalCents, state.volume),
      imbalance: orderBookImbalance(state.bidQuantity, state.askQuantity),
    }));
  }
}

function tickBetween(previousCents: number, nextCents: number): PriceTick {
  if (nextCents === previousCents) {
    return 'unchanged';
  }
  return nextCents > previousCents ? 'up' : 'down';
}
