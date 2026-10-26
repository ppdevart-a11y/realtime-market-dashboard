//! Batch generation over a fixed set of instruments.

use core::fmt;
use core::num::NonZeroU32;

use crate::instrument::Instrument;
use crate::{MarketUpdate, Pcg32};

/// Largest accepted instrument count. The settings form enforces the same limit, and the
/// TypeScript contract test checks that both sides agree.
pub const MAX_INSTRUMENT_COUNT: u32 = 50;

/// Largest accepted batch size, and the capacity of the preallocated output buffer.
pub const MAX_BATCH_SIZE: u32 = 1_000;

/// PCG stream shared by every simulator: the default stream of `pcg_basic.c`
/// (`PCG32_INITIALIZER.inc >> 1`). Only `initstate` comes from the caller; a second 64-bit seed
/// word would add no useful variety to a demo feed.
const STREAM: u64 = 0xda3e_39cb_94b9_5bdb >> 1;

/// Activity weights are `2^k` for `k` in `0..ACTIVITY_LEVELS`, i.e. {1, 2, 4, 8, 16}. A
/// log-uniform spread makes trading volumes differ by an order of magnitude across instruments.
const ACTIVITY_LEVELS: NonZeroU32 = NonZeroU32::new(5).unwrap();

/// Input rejected by [`MarketSimulator`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SimError {
    /// The instrument count was outside `1..=MAX_INSTRUMENT_COUNT`.
    InstrumentCount {
        /// The rejected count.
        requested: u32,
    },
    /// The batch size was outside `1..=MAX_BATCH_SIZE`.
    BatchSize {
        /// The rejected size.
        requested: u32,
    },
}

impl fmt::Display for SimError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InstrumentCount { requested } => write!(
                f,
                "instrument count {requested} is outside 1..={MAX_INSTRUMENT_COUNT}"
            ),
            Self::BatchSize { requested } => {
                write!(f, "batch size {requested} is outside 1..={MAX_BATCH_SIZE}")
            }
        }
    }
}

impl std::error::Error for SimError {}

/// Generates batches of market updates for a fixed set of instruments.
///
/// Instruments keep their state between calls, so each batch continues the previous one and
/// splitting the same number of updates into different batch sizes yields the same stream. The
/// stream depends only on `(instrument_count, seed)` and is identical on every platform.
pub struct MarketSimulator {
    rng: Pcg32,
    instruments: Box<[Instrument]>,
    /// Running totals of the activity weights: instrument `i` owns the tickets from the previous
    /// total up to, but excluding, `cumulative_weights[i]`.
    cumulative_weights: Box<[u32]>,
    total_weight: NonZeroU32,
    /// Allocated once with [`MAX_BATCH_SIZE`] records and never reallocated, so its address is
    /// stable for the simulator's lifetime.
    batch: Box<[MarketUpdate]>,
}

impl MarketSimulator {
    /// Creates `instrument_count` instruments whose anchors, spreads, depths and activity
    /// weights are drawn from `seed`.
    ///
    /// # Errors
    ///
    /// [`SimError::InstrumentCount`] if `instrument_count` is outside
    /// `1..=MAX_INSTRUMENT_COUNT`.
    pub fn new(instrument_count: u32, seed: u64) -> Result<Self, SimError> {
        let invalid = SimError::InstrumentCount {
            requested: instrument_count,
        };
        if !(1..=MAX_INSTRUMENT_COUNT).contains(&instrument_count) {
            return Err(invalid);
        }

        let mut rng = Pcg32::new(seed, STREAM);
        let mut total = 0;
        let (instruments, cumulative_weights): (Vec<_>, Vec<_>) = (0..instrument_count)
            .map(|index| {
                let instrument = Instrument::new(index, &mut rng);
                total += 1 << rng.below(ACTIVITY_LEVELS);
                (instrument, total)
            })
            .unzip();
        // At least one instrument with a weight of at least 1, so this cannot fail; reusing the
        // validation error keeps the constructor free of panics.
        let total_weight = NonZeroU32::new(total).ok_or(invalid)?;

        Ok(Self {
            rng,
            instruments: instruments.into_boxed_slice(),
            cumulative_weights: cumulative_weights.into_boxed_slice(),
            total_weight,
            batch: vec![MarketUpdate::default(); MAX_BATCH_SIZE as usize].into_boxed_slice(),
        })
    }

    /// Generates the next `size` updates and returns them.
    ///
    /// Instruments are drawn by activity weight with replacement, so one instrument can appear
    /// several times in a batch. The records live in a buffer that every call reuses, so the
    /// slice is valid only until the next call.
    ///
    /// # Errors
    ///
    /// [`SimError::BatchSize`] if `size` is outside `1..=MAX_BATCH_SIZE`. Nothing is generated
    /// and the stream is unaffected.
    pub fn generate(&mut self, size: u32) -> Result<&[MarketUpdate], SimError> {
        if !(1..=MAX_BATCH_SIZE).contains(&size) {
            return Err(SimError::BatchSize { requested: size });
        }

        let Self {
            rng,
            instruments,
            cumulative_weights,
            total_weight,
            batch,
        } = self;
        let batch = &mut batch[..size as usize];
        for update in batch.iter_mut() {
            let ticket = rng.below(*total_weight);
            // `ticket < total_weight`, the last running total, so the index is in bounds.
            let index = cumulative_weights.partition_point(|&end| end <= ticket);
            *update = instruments[index].step(rng);
        }
        Ok(batch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instrument::{MAX_BOOK_QUANTITY, MAX_STEP, MAX_TRADE_QUANTITY};

    fn simulator(instrument_count: u32, seed: u64) -> MarketSimulator {
        MarketSimulator::new(instrument_count, seed).expect("valid instrument count")
    }

    /// Concatenates the batches generated for `sizes`.
    fn stream(instrument_count: u32, seed: u64, sizes: &[u32]) -> Vec<MarketUpdate> {
        let mut subject = simulator(instrument_count, seed);
        sizes
            .iter()
            .flat_map(|&size| subject.generate(size).expect("valid size").to_vec())
            .collect()
    }

    #[test]
    fn rejects_instrument_counts_outside_the_limits() {
        for requested in [0, MAX_INSTRUMENT_COUNT + 1, u32::MAX] {
            assert_eq!(
                MarketSimulator::new(requested, 0).err(),
                Some(SimError::InstrumentCount { requested })
            );
        }
        for accepted in [1, MAX_INSTRUMENT_COUNT] {
            assert!(MarketSimulator::new(accepted, 0).is_ok());
        }
    }

    #[test]
    fn returns_exactly_the_requested_number_of_updates() {
        let mut subject = simulator(5, 1);
        for size in [1, 100, MAX_BATCH_SIZE] {
            assert_eq!(
                subject.generate(size).expect("valid size").len(),
                size as usize
            );
        }
    }

    #[test]
    fn rejected_batch_sizes_leave_the_stream_untouched() {
        let mut rejected = simulator(5, 2);
        for requested in [0, MAX_BATCH_SIZE + 1, u32::MAX] {
            assert_eq!(
                rejected.generate(requested),
                Err(SimError::BatchSize { requested })
            );
        }
        let after_errors = rejected.generate(100).expect("valid size").to_vec();
        assert_eq!(after_errors, stream(5, 2, &[100]));
    }

    #[test]
    fn reuses_one_buffer_for_every_batch() {
        let mut subject = simulator(5, 3);
        let first = subject
            .generate(MAX_BATCH_SIZE)
            .expect("valid size")
            .as_ptr();
        for size in [1, 500, MAX_BATCH_SIZE] {
            assert_eq!(subject.generate(size).expect("valid size").as_ptr(), first);
        }
    }

    #[test]
    fn batch_boundaries_do_not_change_the_stream() {
        assert_eq!(stream(5, 4, &[500, 500]), stream(5, 4, &[1_000]));
        assert_eq!(stream(50, 4, &[1, 7, 100, 892]), stream(50, 4, &[1_000]));
    }

    #[test]
    fn the_seed_determines_the_stream() {
        assert_eq!(stream(5, 5, &[1_000]), stream(5, 5, &[1_000]));
        assert_ne!(stream(5, 5, &[1_000]), stream(5, 6, &[1_000]));
    }

    #[test]
    fn every_update_satisfies_the_record_invariants() {
        for seed in 0..16 {
            for instrument_count in [1, 5, MAX_INSTRUMENT_COUNT] {
                let mut subject = simulator(instrument_count, seed);
                for _ in 0..20 {
                    for update in subject.generate(MAX_BATCH_SIZE).expect("valid size") {
                        assert!(update.instrument < instrument_count, "{update:?}");
                        assert!(update.bid_cents >= 1, "{update:?}");
                        assert!(update.ask_cents > update.bid_cents, "{update:?}");
                        assert!(
                            update.price_cents == update.bid_cents
                                || update.price_cents == update.ask_cents,
                            "{update:?}"
                        );
                        assert!(
                            (1..=MAX_TRADE_QUANTITY).contains(&update.trade_quantity),
                            "{update:?}"
                        );
                        assert!(update.bid_quantity <= MAX_BOOK_QUANTITY, "{update:?}");
                        assert!(update.ask_quantity <= MAX_BOOK_QUANTITY, "{update:?}");
                    }
                }
            }
        }
    }

    /// Each trade price is the bid or ask around a mid that moved at most `MAX_STEP` since the
    /// instrument's previous update, so consecutive prices differ by at most that move plus
    /// both spreads.
    #[test]
    fn prices_evolve_from_the_previous_update_of_the_same_instrument() {
        let mut previous: [Option<MarketUpdate>; MAX_INSTRUMENT_COUNT as usize] =
            [None; MAX_INSTRUMENT_COUNT as usize];
        for update in stream(MAX_INSTRUMENT_COUNT, 7, &[MAX_BATCH_SIZE; 200]) {
            let slot = &mut previous[update.instrument as usize];
            if let Some(before) = *slot {
                let jump = f64::from(update.price_cents.abs_diff(before.price_cents));
                let limit = MAX_STEP * f64::from(before.ask_cents)
                    + f64::from(before.ask_cents - before.bid_cents)
                    + f64::from(update.ask_cents - update.bid_cents);
                assert!(jump <= limit, "{before:?} -> {update:?}");
            }
            *slot = Some(update);
        }
    }

    #[test]
    fn every_instrument_trades() {
        let mut traded = [false; MAX_INSTRUMENT_COUNT as usize];
        for update in stream(MAX_INSTRUMENT_COUNT, 8, &[MAX_BATCH_SIZE; 10]) {
            traded[update.instrument as usize] = true;
        }
        assert!(traded.iter().all(|&seen| seen));
    }

    #[test]
    fn errors_name_the_rejected_value_and_the_limits() {
        assert_eq!(
            SimError::InstrumentCount { requested: 51 }.to_string(),
            "instrument count 51 is outside 1..=50"
        );
        assert_eq!(
            SimError::BatchSize { requested: 1_001 }.to_string(),
            "batch size 1001 is outside 1..=1000"
        );
    }
}
