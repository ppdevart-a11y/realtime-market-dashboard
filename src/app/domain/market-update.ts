/**
 * Wire layout of one market update as written by the Wasm generator: seven u32 words per record,
 * in this order. It mirrors `MarketUpdate` in `wasm/market-sim/src/update.rs`; the contract test
 * against the compiled module fails if either side changes alone.
 *
 * Each record is one trade plus the book as it stands after that trade: the trade price always
 * equals the bid (a sell hit it) or the ask (a buy lifted it).
 */
export const MarketUpdateField = {
  Instrument: 0,
  PriceCents: 1,
  TradeQuantity: 2,
  BidCents: 3,
  AskCents: 4,
  BidQuantity: 5,
  AskQuantity: 6,
} as const;

/** Number of u32 words in one record. */
export const MARKET_UPDATE_WORDS = 7;
