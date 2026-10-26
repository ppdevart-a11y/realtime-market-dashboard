import init, {
  MarketSimulator,
  maxBatchSize,
  maxInstrumentCount,
  updateStrideWords,
} from 'market-sim';
import { MARKET_UPDATE_WORDS } from '../domain/market-update';
import { PRODUCER_SETTINGS_LIMITS } from '../domain/producer-settings';
import type { MarketSourceFactory } from './market-source';

/**
 * Adapter from the Rust generator (`wasm/market-sim`) to the engine's `MarketSource` port.
 *
 * Batches are read in place, from one `Uint32Array` over the module's memory at the byte offset
 * `generate` returns. Memory growth replaces `memory.buffer` and detaches views of the old one;
 * creating a simulator and generating can both grow it, so the view is checked after every
 * `generate`, right before the batch is read.
 */

/**
 * Instantiates the generator module and returns a factory of sources backed by it.
 *
 * @param module URL of the `.wasm` file in the app; the module bytes themselves in tests.
 * @throws (rejects) with a message fit for the UI, and the technical detail as its `cause`, if the
 *   module cannot be fetched or compiled, or if it was built with a different record layout or
 *   different limits than this bundle expects.
 */
export async function loadWasmMarketSourceFactory(
  module: URL | BufferSource,
): Promise<MarketSourceFactory> {
  let memory: WebAssembly.Memory;
  try {
    ({ memory } = await init({ module_or_path: module }));
  } catch (error) {
    // The cause carries the technical detail for the log; the message is what the user sees.
    throw new Error('The market generator could not be loaded.', { cause: error });
  }
  if (
    updateStrideWords() !== MARKET_UPDATE_WORDS ||
    maxBatchSize() !== PRODUCER_SETTINGS_LIMITS.updatesPerBatch.max ||
    maxInstrumentCount() !== PRODUCER_SETTINGS_LIMITS.instrumentCount.max
  ) {
    throw new Error(
      'The market generator does not match this version of the app. Reload the page.',
    );
  }

  let words = new Uint32Array(memory.buffer);

  return (instrumentCount, seed) => {
    const simulator = new MarketSimulator(instrumentCount, seed);
    return {
      nextBatch: (size) => {
        const byteOffset = simulator.generate(size);
        if (words.buffer !== memory.buffer) {
          words = new Uint32Array(memory.buffer);
        }
        return { records: words, offset: byteOffset / Uint32Array.BYTES_PER_ELEMENT, count: size };
      },
      dispose: () => {
        simulator.free();
      },
    };
  };
}
