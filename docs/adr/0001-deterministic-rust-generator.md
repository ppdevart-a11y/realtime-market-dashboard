# 1. A deterministic market generator in Rust

Status: accepted

## Context

The assignment requires a candidate-written WebAssembly library in which randomness and price
generation really run: a TypeScript generator behind a trivial Wasm call does not count. The
generator must keep per-instrument state, return batches of the requested size and keep every
value valid. Its output crosses a language boundary, so a bug can sit on either side of it, and
tests of the model should not need a browser.

## Decision

- The generator is a Rust crate, `wasm/market-sim`, built with wasm-pack 0.15 and wasm-bindgen
  0.2.129 (pinned exactly). The toolchain is pinned in `rust-toolchain.toml` at the repository
  root. All logic lives in plain Rust; `bindings.rs` is the only `#[wasm_bindgen]` code, so the
  model is tested natively with `cargo test`.
- Randomness comes from a line-by-line port of the PCG32 reference (`pcg_basic.c`), including its
  rejection method for bounded draws. The test replays the published `pcg32-demo` transcript:
  raw words, coin tosses, dice rolls and a card shuffle.
- The price model uses only correctly rounded IEEE-754 operations: no `exp`, `ln`, `powi` or
  `mul_add`, whose precision `std` leaves unspecified. It reverts the relative deviation from an
  anchor with multiplicative steps instead of reverting the log-price; the two agree to first
  order (`instrument.rs` documents the model step by step).
- One golden fixture, `wasm/market-sim/tests/fixtures/golden-5-42.txt`, records the first 108
  updates for a fixed seed. The Rust tests compare native output with it, and the TypeScript
  contract test compares the compiled `.wasm`, read through the production adapter, with the
  same file.

## Consequences

- A seed determines the stream bit for bit on every platform. The worker's `started` event
  carries each run's seed, so a run can be replayed exactly.
- The fixture catches what invariants cannot: two fields of the same kind swapped (such as bid
  and ask quantity) keep every record valid but flip the sign of the imbalance.
- After an intentional model change, `GOLDEN_BLESS=1 cargo test` regenerates the fixture, and
  its diff is reviewed like code.
- The module is about 20 KB (9.7 KB gzipped). Size is guarded by the contract test (< 32 KiB);
  one `f64::clamp` once added 24 KB of float-formatting code, so the crate avoids it.
- The parameters were calibrated by simulating the extreme settings, from one instrument at
  20,000 updates per second for an hour to fifty instruments at the default rate: the worst
  deviation from the anchor was about ±5 % and the price limits were never reached. One side of
  the book was empty after about 1.3 % of updates and both sides after about 0.005 %, which the
  dashboard shows as an unavailable imbalance.
- Contributors need rustup and wasm-pack in addition to Node.

## Alternatives considered

- **AssemblyScript.** Closer to TypeScript, but its tests also run inside Wasm, whereas
  `cargo test` runs the model natively, over millions of updates, in seconds.
- **C++ with Emscripten, or Go/TinyGo.** Heavier toolchains, and larger glue or a runtime with a
  garbage collector for a few hundred lines of arithmetic.
- **The `rand` crates.** A dependency for one small generator, with bounded sampling that has no
  published vectors to test against.
- **A log-price model with `exp`/`ln`.** The textbook form, but its results may differ between
  native and Wasm builds, which would rule out the shared fixture.
