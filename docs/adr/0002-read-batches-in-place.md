# 2. Reading batches in place from Wasm memory

Status: accepted

## Context

At the maximum settings the generator produces 1,000 updates every 50 ms, 20,000 per second.
Each update has seven integer fields. Returning them as JavaScript objects, or as a fresh array
per call, would allocate on every batch for data that is read once and discarded.

## Decision

- An update is a `#[repr(C)]` record of seven `u32` fields, 28 bytes with no padding. Const
  assertions pin its size, alignment and every field offset; `domain/market-update.ts` mirrors the
  field order.
- Each simulator allocates its batch buffer once, for 1,000 records, and never reallocates it.
  `generate(size)` fills the first `size` records and returns the buffer's byte offset in linear
  memory.
- The worker keeps one `Uint32Array` over the whole module memory and decodes records from it
  directly. The view is recreated only when `memory.buffer` has changed, which happens when memory
  grows; the check runs after every `generate`, right before the view is handed out.
- The view is never stored or posted. `MarketAggregator.applyBatch` copies the scalars it needs
  and validates the whole batch window before applying any of it.
- At load, the worker checks the module's stride and limits (`updateStrideWords()`,
  `maxBatchSize()`, `maxInstrumentCount()`) against the TypeScript constants and refuses a
  mismatched module.

## Consequences

- No per-update allocation or copy on either side of the boundary. Whatever its size, a batch
  costs two small objects: the glue's multi-value return and the batch descriptor.
- The pointer contract is strict and is documented on `generate`: the records are valid only until
  the next call into the module, any call can grow memory and detach existing views, and posting
  a view would structured-clone the entire memory.
- The contract test covers the risky parts against the real module: memory stays flat over 2,000
  batches, two simulators interleave without interference, decoding stays correct after forced
  growth (the old view's length drops to zero), and a freed simulator throws instead of trapping.
- Copying 20,000 records per second (about 560 KB) would also be affordable. The gain is
  a steady state without garbage and a boundary that is a documented memory layout rather than
  generated serialisation code.

## Alternatives considered

- **Returning `Vec<u32>` or a typed array through wasm-bindgen.** Simple, but it copies every
  batch into a new JavaScript array.
- **Serialising updates to objects** (for example with serde-wasm-bindgen). An object per update,
  20,000 per second at the maximum rate.
- **A `SharedArrayBuffer`.** Would let the main thread read Wasm memory too, but needs
  cross-origin isolation headers and synchronisation the design does not otherwise need.
