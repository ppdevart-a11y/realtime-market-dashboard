//! Simulated market data for the realtime dashboard, generated in WebAssembly.
//!
//! [`MarketSimulator`] owns a fixed set of instruments, each with a mean-reverting mid price and a
//! two-sided book, and fills a preallocated buffer with batches of [`MarketUpdate`] records: one
//! simulated trade plus the top of the book after it. The `instrument` module documents the model
//! and its calibration.
//!
//! All randomness comes from [`Pcg32`], a port of the PCG reference implementation, and the model
//! uses only correctly rounded floating-point operations, so `(instrument_count, seed)` determines
//! the stream bit for bit on every platform.
//!
//! # Panics
//!
//! No input makes the crate panic: out-of-range arguments return [`SimError`], divisions are by
//! types that cannot be zero, and the model keeps every price within bounds where integer
//! arithmetic cannot overflow.

mod instrument;
mod rng;
mod simulator;
mod update;

pub use instrument::{MAX_BOOK_QUANTITY, MAX_TRADE_QUANTITY};
pub use rng::Pcg32;
pub use simulator::{MAX_BATCH_SIZE, MAX_INSTRUMENT_COUNT, MarketSimulator, SimError};
pub use update::{MarketUpdate, UPDATE_STRIDE_WORDS};
