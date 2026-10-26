//! JavaScript bindings: the only `#[wasm_bindgen]` code in the crate.
//!
//! A thin shell over [`MarketSimulator`]. Validation, errors and all generation logic live in the
//! core and are tested natively; this module only converts types. It compiles on every target so
//! the same lints and documentation checks apply, but only the wasm32 build exports it.
//!
//! Doc comments on exported items are copied into the generated TypeScript declarations, so they
//! use plain code spans rather than rustdoc links.

use wasm_bindgen::prelude::*;

use crate::{
    MAX_BATCH_SIZE, MAX_INSTRUMENT_COUNT, MarketSimulator, MarketUpdate, UPDATE_STRIDE_WORDS,
};

/// `MarketSimulator` as exported to JavaScript under the same name.
///
/// Call `free()` (or `[Symbol.dispose]()`) exactly once when the simulator is replaced or no
/// longer needed: it releases the instruments and the batch buffer. Any later call on the
/// object, including a second `free()`, throws `Error("null pointer passed to rust")`. The
/// generated glue also registers a `FinalizationRegistry`, but garbage collection gives no
/// timing guarantee.
#[wasm_bindgen(js_name = MarketSimulator)]
pub struct WasmMarketSimulator(MarketSimulator);

#[wasm_bindgen(js_class = MarketSimulator)]
impl WasmMarketSimulator {
    /// `new MarketSimulator(instrumentCount, seed)`.
    ///
    /// `seed` must be a `bigint`: a `number` throws `TypeError`, and a `bigint` outside the
    /// `u64` range wraps modulo 2^64.
    ///
    /// # Errors
    ///
    /// Throws an `Error` naming the rejected value if `instrumentCount` is outside 1 to
    /// `maxInstrumentCount()`.
    #[wasm_bindgen(constructor)]
    pub fn new(
        #[wasm_bindgen(js_name = instrumentCount)] instrument_count: u32,
        seed: u64,
    ) -> Result<Self, JsError> {
        Ok(Self(MarketSimulator::new(instrument_count, seed)?))
    }

    /// Generates `size` updates and returns the byte offset of the first one in the module's
    /// `memory.buffer`.
    ///
    /// # Pointer contract
    ///
    /// 1. The offset is 4-byte aligned and is followed by `size` consecutive records of
    ///    `updateStrideWords()` little-endian `u32` words each, in the field order of the Rust
    ///    `MarketUpdate`.
    /// 2. The records are valid only until the next call into any export of this module
    ///    instance. The next `generate` overwrites them, and any call may allocate and grow the
    ///    memory, which detaches every existing view (`byteLength` becomes 0) and replaces
    ///    `memory.buffer`.
    /// 3. The offset is the same for every call on one simulator, because the buffer is
    ///    allocated once. A cached `Uint32Array` over the whole memory may therefore be reused,
    ///    but only while `view.buffer === memory.buffer`.
    /// 4. After `free()`, the offset points to released memory.
    /// 5. Never pass a view to `postMessage`: structured cloning copies the entire underlying
    ///    buffer, not just the viewed range.
    ///
    /// # Errors
    ///
    /// Throws an `Error` naming the rejected value if `size` is outside 1 to `maxBatchSize()`;
    /// the stream is unaffected. JavaScript numbers reach `size` through
    /// `ToInt32`-style wrapping (`1.9` becomes 1, `2 ** 32 + 5` becomes 5), so callers must check
    /// for integers in range before calling.
    pub fn generate(&mut self, size: u32) -> Result<*const MarketUpdate, JsError> {
        Ok(self.0.generate(size)?.as_ptr())
    }
}

/// `updateStrideWords()`: the number of `u32` words per record. JavaScript checks it once at
/// start-up against the stride it decodes with.
#[wasm_bindgen(js_name = updateStrideWords)]
#[must_use]
pub fn update_stride_words() -> u32 {
    UPDATE_STRIDE_WORDS
}

/// `maxBatchSize()`: the largest batch `generate` accepts. The TypeScript contract test checks
/// it against the settings limits.
#[wasm_bindgen(js_name = maxBatchSize)]
#[must_use]
pub fn max_batch_size() -> u32 {
    MAX_BATCH_SIZE
}

/// `maxInstrumentCount()`: the largest instrument count the constructor accepts. The TypeScript
/// contract test checks it against the settings limits.
#[wasm_bindgen(js_name = maxInstrumentCount)]
#[must_use]
pub fn max_instrument_count() -> u32 {
    MAX_INSTRUMENT_COUNT
}
