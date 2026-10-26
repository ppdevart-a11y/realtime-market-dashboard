//! Simulated market data for the realtime dashboard, generated in WebAssembly.
//!
//! All randomness comes from [`Pcg32`], a port of the PCG reference implementation, so a seed
//! always produces the same stream on every platform.

mod rng;

pub use rng::Pcg32;
