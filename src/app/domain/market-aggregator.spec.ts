import { MarketAggregator } from './market-aggregator';
import { MARKET_UPDATE_WORDS } from './market-update';

interface Update {
  instrument: number;
  priceCents: number;
  tradeQuantity: number;
  bidCents: number;
  askCents: number;
  bidQuantity: number;
  askQuantity: number;
}

const quote = { bidCents: 10_196, askCents: 10_200, bidQuantity: 600, askQuantity: 400 };

function encode(...updates: Update[]): Uint32Array {
  return Uint32Array.from(
    updates.flatMap((u) => [
      u.instrument,
      u.priceCents,
      u.tradeQuantity,
      u.bidCents,
      u.askCents,
      u.bidQuantity,
      u.askQuantity,
    ]),
  );
}

function applyAll(aggregator: MarketAggregator, records: Uint32Array): void {
  aggregator.applyBatch(records, 0, records.length / MARKET_UPDATE_WORDS);
}

describe('MarketAggregator', () => {
  it('reports unavailable metrics and zero volume before any update', () => {
    const aggregator = new MarketAggregator(2);

    expect(aggregator.snapshot()).toEqual([
      {
        lastPriceCents: null,
        lastTick: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      },
      {
        lastPriceCents: null,
        lastTick: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      },
    ]);
    expect(aggregator.totalUpdates).toBe(0);
  });

  it('reproduces the worked example from the specification', () => {
    const aggregator = new MarketAggregator(1);

    applyAll(
      aggregator,
      encode(
        { instrument: 0, priceCents: 10_000, tradeQuantity: 10, ...quote },
        { instrument: 0, priceCents: 10_200, tradeQuantity: 30, ...quote },
      ),
    );

    expect(aggregator.snapshot()[0]).toEqual({
      lastPriceCents: 10_200,
      lastTick: 'up',
      spreadCents: 4,
      volume: 40,
      vwapCents: 10_150,
      imbalance: 0.2,
    });
  });

  it('keeps instruments isolated from each other', () => {
    const aggregator = new MarketAggregator(3);

    applyAll(
      aggregator,
      encode(
        { instrument: 2, priceCents: 5_000, tradeQuantity: 7, ...quote },
        { instrument: 0, priceCents: 10_000, tradeQuantity: 3, ...quote },
      ),
    );

    const [first, untouched, third] = aggregator.snapshot();
    expect(first).toMatchObject({ lastPriceCents: 10_000, volume: 3, vwapCents: 10_000 });
    expect(third).toMatchObject({ lastPriceCents: 5_000, volume: 7, vwapCents: 5_000 });
    expect(untouched).toMatchObject({ lastPriceCents: null, volume: 0, vwapCents: null });
  });

  it('counts every trade once, across batches and when an instrument repeats within a batch', () => {
    const aggregator = new MarketAggregator(1);

    applyAll(
      aggregator,
      encode(
        { instrument: 0, priceCents: 10_000, tradeQuantity: 1, ...quote },
        { instrument: 0, priceCents: 10_100, tradeQuantity: 2, ...quote },
      ),
    );
    applyAll(aggregator, encode({ instrument: 0, priceCents: 10_050, tradeQuantity: 3, ...quote }));

    expect(aggregator.snapshot()[0]).toMatchObject({
      lastPriceCents: 10_050,
      lastTick: 'down',
      volume: 6,
      vwapCents: (10_000 * 1 + 10_100 * 2 + 10_050 * 3) / 6,
    });
    expect(aggregator.totalUpdates).toBe(3);
  });

  it('takes spread and imbalance from the latest book, without adding book quantities to volume', () => {
    const aggregator = new MarketAggregator(1);

    applyAll(
      aggregator,
      encode(
        { instrument: 0, priceCents: 10_200, tradeQuantity: 5, ...quote },
        {
          instrument: 0,
          priceCents: 10_198,
          tradeQuantity: 5,
          bidCents: 10_198,
          askCents: 10_201,
          bidQuantity: 0,
          askQuantity: 0,
        },
      ),
    );

    expect(aggregator.snapshot()[0]).toMatchObject({
      spreadCents: 3,
      imbalance: null,
      volume: 10,
    });
  });

  it('reports an unchanged tick when consecutive trades print the same price', () => {
    const aggregator = new MarketAggregator(1);
    const trade = { instrument: 0, priceCents: 10_200, tradeQuantity: 1, ...quote };

    applyAll(aggregator, encode(trade));
    expect(aggregator.snapshot()[0]?.lastTick).toBeNull();

    applyAll(aggregator, encode(trade));
    expect(aggregator.snapshot()[0]?.lastTick).toBe('unchanged');
  });

  it('reads only the records inside the given window', () => {
    const aggregator = new MarketAggregator(1);
    const records = encode(
      { instrument: 0, priceCents: 1, tradeQuantity: 1_000, ...quote },
      { instrument: 0, priceCents: 10_000, tradeQuantity: 2, ...quote },
      { instrument: 0, priceCents: 1, tradeQuantity: 1_000, ...quote },
    );

    aggregator.applyBatch(records, MARKET_UPDATE_WORDS, 1);

    expect(aggregator.snapshot()[0]).toMatchObject({ lastPriceCents: 10_000, volume: 2 });
  });

  it('copies what it needs, so the caller may reuse the buffer', () => {
    const aggregator = new MarketAggregator(1);
    const records = encode({ instrument: 0, priceCents: 10_000, tradeQuantity: 2, ...quote });

    applyAll(aggregator, records);
    records.fill(0);

    expect(aggregator.snapshot()[0]).toMatchObject({ lastPriceCents: 10_000, volume: 2 });
  });

  it('rejects a batch that names an unknown instrument without applying any of it', () => {
    const aggregator = new MarketAggregator(2);
    const records = encode(
      { instrument: 0, priceCents: 10_000, tradeQuantity: 2, ...quote },
      { instrument: 2, priceCents: 10_000, tradeQuantity: 2, ...quote },
    );

    expect(() => {
      applyAll(aggregator, records);
    }).toThrow(RangeError);
    expect(aggregator.snapshot()[0]?.volume).toBe(0);
    expect(aggregator.totalUpdates).toBe(0);
  });
});
