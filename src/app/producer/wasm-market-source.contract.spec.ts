import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MARKET_UPDATE_WORDS, MarketUpdateField as Field } from '../domain/market-update';
import type { MarketBatch, MarketSourceFactory } from './market-source';
import { loadWasmMarketSourceFactory } from './wasm-market-source';

/*
 * Contract between the compiled generator and the TypeScript decoder, run against the real
 * `.wasm` that `npm run wasm:build` produced. The Rust tests prove the model; these prove that
 * what crosses the boundary is read the way it was written. Paths resolve from the repository
 * root because specs run from a bundle.
 */

const wasmBytes = readFileSync(resolve(process.cwd(), 'wasm/market-sim/pkg/market_sim_bg.wasm'));
const golden = readFileSync(
  resolve(process.cwd(), 'wasm/market-sim/tests/fixtures/golden-5-42.txt'),
  'utf8',
);

/** Fixture header: `# instrument_count=5 seed=42 batch_sizes=1,7,100`, then one record per line. */
function parseGolden() {
  const lines = golden.split('\n');
  const header = new Map(
    [...(lines[0] ?? '').matchAll(/(\w+)=([\d,]+)/g)].map(([, key, value]) => [key, value]),
  );
  return {
    instrumentCount: Number(header.get('instrument_count')),
    seed: BigInt(header.get('seed') ?? ''),
    batchSizes: (header.get('batch_sizes') ?? '').split(',').map(Number),
    records: lines
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split(' ').map(Number)),
  };
}

function decode(batch: MarketBatch): number[][] {
  return Array.from({ length: batch.count }, (_, index) => {
    const start = batch.offset + index * MARKET_UPDATE_WORDS;
    return Array.from(batch.records.subarray(start, start + MARKET_UPDATE_WORDS));
  });
}

describe('Wasm market source (compiled module)', () => {
  let createSource: MarketSourceFactory;

  beforeAll(async () => {
    createSource = await loadWasmMarketSourceFactory(wasmBytes);
  });

  it('stays small enough to load with the page', () => {
    expect(wasmBytes.byteLength).toBeLessThan(32 * 1_024);
  });

  it('reproduces the golden stream shared with the Rust tests, field by field', () => {
    const { instrumentCount, seed, batchSizes, records } = parseGolden();
    const source = createSource(instrumentCount, seed);

    const decoded = batchSizes.flatMap((size) => decode(source.nextBatch(size)));
    source.dispose();

    expect(decoded).toEqual(records);
  });

  it('returns batches of the requested size whose records satisfy every invariant', () => {
    for (const [instrumentCount, seed] of [
      [1, 1n],
      [5, 2n],
      [50, 2n ** 64n - 1n],
    ] as const) {
      const source = createSource(instrumentCount, seed);
      for (const size of [1, 100, 1_000]) {
        const batch = source.nextBatch(size);
        const updates = decode(batch);

        expect(updates).toHaveLength(size);
        expect(Number.isInteger(batch.offset)).toBe(true);
        for (const update of updates) {
          const [instrument, price, quantity, bid, ask, bidQuantity, askQuantity] = update;
          expect(instrument).toBeLessThan(instrumentCount);
          expect(bid).toBeGreaterThanOrEqual(1);
          expect(ask).toBeGreaterThan(bid);
          expect([bid, ask]).toContain(price);
          expect(quantity).toBeGreaterThanOrEqual(1);
          expect(quantity).toBeLessThanOrEqual(500);
          // Book quantities are u32, hence never negative; the model also caps them.
          expect(Math.max(bidQuantity, askQuantity)).toBeLessThanOrEqual(10_000);
        }
      }
      source.dispose();
    }
  });

  it('keeps memory flat across thousands of batches, so no history is retained', () => {
    const source = createSource(50, 3n);
    const first = source.nextBatch(1_000);
    const byteLength = first.records.byteLength;

    for (let i = 0; i < 2_000; i++) {
      source.nextBatch(1_000);
    }

    expect(source.nextBatch(1_000).records.byteLength).toBe(byteLength);
    source.dispose();
  });

  it('rejects inputs outside the limits without disturbing the stream', () => {
    const reference = createSource(5, 4n);
    const subject = createSource(5, 4n);

    expect(() => subject.nextBatch(0)).toThrow('batch size 0 is outside 1..=1000');
    expect(() => subject.nextBatch(1_001)).toThrow('batch size 1001 is outside 1..=1000');
    expect(() => createSource(0, 1n)).toThrow('instrument count 0 is outside 1..=50');
    expect(() => createSource(51, 1n)).toThrow('instrument count 51 is outside 1..=50');
    expect(decode(subject.nextBatch(10))).toEqual(decode(reference.nextBatch(10)));

    reference.dispose();
    subject.dispose();
  });

  it('runs two simulators side by side without interference, as during a run hand-over', () => {
    const alone = createSource(5, 5n);
    const expected = [decode(alone.nextBatch(50)), decode(alone.nextBatch(50))];
    alone.dispose();

    const outgoing = createSource(5, 5n);
    const incoming = createSource(5, 5n);
    const interleaved = [decode(outgoing.nextBatch(50)), decode(incoming.nextBatch(50))];
    interleaved.push(decode(outgoing.nextBatch(50)), decode(incoming.nextBatch(50)));
    outgoing.dispose();
    incoming.dispose();

    expect(interleaved).toEqual([expected[0], expected[0], expected[1], expected[1]]);
  });

  it('keeps decoding correctly after the module memory grows', () => {
    const { instrumentCount, seed, batchSizes, records } = parseGolden();
    const [firstSize, ...laterSizes] = batchSizes;
    const source = createSource(instrumentCount, seed);
    const before = source.nextBatch(firstSize);
    const decoded = decode(before);

    // Each simulator preallocates a 28 KB batch buffer, so a hundred of them force growth.
    const ballast = Array.from({ length: 100 }, (_, index) => createSource(50, BigInt(index)));
    for (const size of laterSizes) {
      const batch = source.nextBatch(size);
      expect(batch.records.buffer).not.toBe(before.records.buffer);
      decoded.push(...decode(batch));
    }
    for (const extra of ballast) {
      extra.dispose();
    }
    source.dispose();

    expect(before.records.byteLength).toBe(0);
    expect(decoded).toEqual(records);
  });

  it('throws instead of trapping when a disposed simulator is used', () => {
    const source = createSource(1, 6n);
    source.dispose();

    expect(() => source.nextBatch(1)).toThrow();
    expect(() => {
      source.dispose();
    }).toThrow();
  });

  it('lays records out exactly as the TypeScript field map expects', () => {
    const source = createSource(1, 7n);
    const batch = source.nextBatch(1);
    const at = (field: number) => batch.records[batch.offset + field];

    expect(at(Field.Instrument)).toBe(0);
    expect([at(Field.BidCents), at(Field.AskCents)]).toContain(at(Field.PriceCents));
    expect(at(Field.AskCents)).toBeGreaterThan(at(Field.BidCents));
    source.dispose();
  });
});
