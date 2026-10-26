//! Price and order-book model of one instrument, advanced once per update of that instrument.
//!
//! Trade time: the rate changes how fast prices move, never how far. Only correctly rounded
//! IEEE-754 operations (no `exp`/`ln`/`powi`/`mul_add`, no `f64::clamp`), so native and Wasm
//! streams are bit-identical.
//!
//! # One step
//!
//! 1. **Book.** Each displayed quantity closes `1/8` of its gap to the instrument's typical depth
//!    `D` and takes uniform noise in `±D/4`, within `0..=MAX_BOOK_QUANTITY`.
//! 2. **Mid.** With the deviation `x = mid / anchor - 1` and the pre-trade book imbalance `i`,
//!    `mid ← mid · (1 + r)` where `r = −θ·x + σ·ε + κ·i` and `ε` is a unit-variance draw bounded
//!    by `±2√3`. The mid is then held within `[0.75, 1.25] × anchor`.
//! 3. **Quotes.** The spread is the instrument's base spread in basis points, jittered by a
//!    factor in `[0.5, 1.5)` and rounded to whole cents, at least 1 cent;
//!    `bid = round(mid − spread / 2)` and `ask = bid + spread`, so `bid ≤ mid ≤ ask`.
//! 4. **Trade.** Against a side that displays quantity: a buy lifts the ask, a sell hits the bid.
//!    If both sides are empty, a new resting order first refills one of them, so every update
//!    still carries a trade. The quantity is `1 + ⌊min(available, MAX_TRADE_QUANTITY) · u³⌋`.
//!
//! The trade consumes quantity but never moves the quotes, so the trade price is always the
//! update's bid or ask and the reported book is the post-trade state.
//!
//! # Relative deviation instead of log-price
//!
//! A textbook Ornstein–Uhlenbeck price reverts `ln(mid / anchor)`; here `x = mid / anchor − 1`
//! with multiplicative steps does, which needs no `exp` or `ln` (their precision `std` leaves
//! unspecified). `ln(1 + x) = x − x²/2 + …`, so both agree to first order and differ by less than
//! 2.5 % of `x` within the ±5 % range the price explores.

use core::num::NonZeroU32;

use crate::{MarketUpdate, Pcg32};

/// Mean reversion per step (θ): a deviation from the anchor halves in `ln 2 / θ ≈ 1,386` steps.
const MEAN_REVERSION: f64 = 5e-4;

/// Scale of the random part of a step (σ) as a fraction of the mid: 3 basis points. The
/// deviation settles to a standard deviation of `σ / √(2θ − θ²) ≈ 0.95 %`.
const VOLATILITY: f64 = 3e-4;

/// Drift per step at full book imbalance (κ), as a fraction of the mid: 0.2 basis points. The
/// measured correlation between imbalance and the next return is about +0.02.
const IMBALANCE_DRIFT: f64 = 2e-5;

/// Lower limit of the mid relative to the anchor.
///
/// Both limits sit about 26 stationary standard deviations away and were never reached in
/// simulation. They exist to make price bounds provable: every mid stays between $7.50 and $625,
/// and every quote within half a spread of it, far from the 1-cent floor and from integer overflow.
const MIN_MID_TO_ANCHOR: f64 = 0.75;

/// Upper limit of the mid relative to the anchor; see [`MIN_MID_TO_ANCHOR`].
const MAX_MID_TO_ANCHOR: f64 = 1.25;

/// Cheapest anchor price, in cents ($10).
const MIN_ANCHOR_CENTS: f64 = 1_000.0;

/// Width of the anchor range, in cents, so anchors span $10 to $500. The uniform draw is squared,
/// which puts the median near $132 and the cheapest instruments' spreads at the 1-cent floor.
const ANCHOR_SPAN_CENTS: f64 = 49_000.0;

/// Narrowest base spread, in basis points of the mid.
const MIN_SPREAD_BPS: f64 = 2.0;

/// Width of the base-spread range, in basis points, so base spreads span `[2, 12)`.
const SPREAD_BPS_SPAN: f64 = 10.0;

/// Smallest typical displayed quantity per side.
const MIN_DEPTH: NonZeroU32 = NonZeroU32::new(200).unwrap();

/// Number of possible depths, so depths span `200..=2_000` (about 700 per side on average,
/// comparable to the 600/400 example in the assignment).
const DEPTH_CHOICES: NonZeroU32 = NonZeroU32::new(1_801).unwrap();

/// Book quantities close `1 / BOOK_REVERSION_DIVISOR` of the gap to the depth per step, so a
/// swept side refills within a few updates.
const BOOK_REVERSION_DIVISOR: i64 = 8;

/// Upper bound of a displayed quantity, a hard limit that simulation never reached (observed
/// quantities stayed below 4,500).
pub const MAX_BOOK_QUANTITY: u32 = 10_000;

/// Largest single trade.
pub const MAX_TRADE_QUANTITY: u32 = 500;

/// `√3`: scales the sum of four uniform draws (variance 4/12) to unit variance.
const SQRT_3: f64 = 1.732_050_807_568_877_2;

/// Basis points per unit.
const BASIS_POINTS: f64 = 10_000.0;

const TWO: NonZeroU32 = NonZeroU32::new(2).unwrap();

/// Largest relative change of the mid in one step: full reversion from the rail, the bound of
/// `ε` and full imbalance drift.
#[cfg(test)]
pub(crate) const MAX_STEP: f64 =
    MEAN_REVERSION * (MAX_MID_TO_ANCHOR - 1.0) + VOLATILITY * 2.0 * SQRT_3 + IMBALANCE_DRIFT;

/// The side of the book a trade executes against.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    /// A sell hits the bid.
    Bid,
    /// A buy lifts the ask.
    Ask,
}

/// State of one simulated instrument.
pub(crate) struct Instrument {
    index: u32,
    /// Level the mid reverts to, in cents.
    anchor_cents: f64,
    /// Current mid price, in cents. Kept unrounded; only quotes are rounded to cents.
    mid_cents: f64,
    /// Base spread, in basis points of the mid.
    spread_bps: f64,
    /// Typical displayed quantity per side.
    depth: NonZeroU32,
    bid_quantity: u32,
    ask_quantity: u32,
}

impl Instrument {
    /// Draws a new instrument with the given index. The mid starts at the anchor and each side
    /// of the book between half and one and a half times the depth.
    pub(crate) fn new(index: u32, rng: &mut Pcg32) -> Self {
        let skew = rng.unit();
        let anchor_cents = MIN_ANCHOR_CENTS + ANCHOR_SPAN_CENTS * skew * skew;
        let spread_bps = MIN_SPREAD_BPS + SPREAD_BPS_SPAN * rng.unit();
        let depth = MIN_DEPTH.saturating_add(rng.below(DEPTH_CHOICES));
        let bid_quantity = depth.get() / 2 + rng.below(depth);
        let ask_quantity = depth.get() / 2 + rng.below(depth);
        Self {
            index,
            anchor_cents,
            mid_cents: anchor_cents,
            spread_bps,
            depth,
            bid_quantity,
            ask_quantity,
        }
    }

    /// Advances the instrument by one trade and returns the resulting update.
    pub(crate) fn step(&mut self, rng: &mut Pcg32) -> MarketUpdate {
        self.bid_quantity = self.walk(self.bid_quantity, rng);
        self.ask_quantity = self.walk(self.ask_quantity, rng);
        let imbalance = imbalance(self.bid_quantity, self.ask_quantity);
        self.advance_mid(imbalance, rng);
        let (bid_cents, ask_cents) = quote(self.mid_cents, self.spread_bps * (0.5 + rng.unit()));

        let (side, available) = self.take_side(rng);
        let trade_quantity = trade_quantity(available, rng.unit());
        // `trade_quantity <= available` by construction, so the subtraction cannot underflow.
        let remaining = available.get() - trade_quantity;
        let price_cents = match side {
            Side::Bid => {
                self.bid_quantity = remaining;
                bid_cents
            }
            Side::Ask => {
                self.ask_quantity = remaining;
                ask_cents
            }
        };

        MarketUpdate {
            instrument: self.index,
            price_cents,
            trade_quantity,
            bid_cents,
            ask_cents,
            bid_quantity: self.bid_quantity,
            ask_quantity: self.ask_quantity,
        }
    }

    /// Moves a displayed quantity one step towards the depth, with noise.
    fn walk(&self, quantity: u32, rng: &mut Pcg32) -> u32 {
        let reach = self.depth.get() / 4;
        let noise =
            i64::from(rng.below(NonZeroU32::MIN.saturating_add(2 * reach))) - i64::from(reach);
        let reversion =
            (i64::from(self.depth.get()) - i64::from(quantity)) / BOOK_REVERSION_DIVISOR;
        let next = (i64::from(quantity) + reversion + noise).clamp(0, i64::from(MAX_BOOK_QUANTITY));
        // Infallible after the clamp; the fallback only avoids a panic path.
        u32::try_from(next).unwrap_or(MAX_BOOK_QUANTITY)
    }

    fn advance_mid(&mut self, imbalance: f64, rng: &mut Pcg32) {
        let deviation = self.mid_cents / self.anchor_cents - 1.0;
        let change =
            -MEAN_REVERSION * deviation + VOLATILITY * unit_bell(rng) + IMBALANCE_DRIFT * imbalance;
        // `max`/`min` rather than `f64::clamp`, whose panic message links ~24 KB of float formatting.
        self.mid_cents = (self.mid_cents * (1.0 + change))
            .max(self.anchor_cents * MIN_MID_TO_ANCHOR)
            .min(self.anchor_cents * MAX_MID_TO_ANCHOR);
    }

    /// Chooses the side the trade executes against and the quantity it displays before the
    /// trade, refilling one side first if the book is empty.
    fn take_side(&mut self, rng: &mut Pcg32) -> (Side, NonZeroU32) {
        match (
            NonZeroU32::new(self.bid_quantity),
            NonZeroU32::new(self.ask_quantity),
        ) {
            (Some(bid), Some(ask)) => {
                if rng.below(TWO) == 0 {
                    (Side::Ask, ask)
                } else {
                    (Side::Bid, bid)
                }
            }
            (Some(bid), None) => (Side::Bid, bid),
            (None, Some(ask)) => (Side::Ask, ask),
            (None, None) => {
                let fresh = NonZeroU32::MIN.saturating_add(rng.below(self.depth));
                if rng.below(TWO) == 0 {
                    self.ask_quantity = fresh.get();
                    (Side::Ask, fresh)
                } else {
                    self.bid_quantity = fresh.get();
                    (Side::Bid, fresh)
                }
            }
        }
    }
}

/// `(bid − ask) / (bid + ask)`, or 0 for an empty book.
fn imbalance(bid_quantity: u32, ask_quantity: u32) -> f64 {
    if bid_quantity == 0 && ask_quantity == 0 {
        return 0.0;
    }
    let bid = f64::from(bid_quantity);
    let ask = f64::from(ask_quantity);
    (bid - ask) / (bid + ask)
}

/// Irwin–Hall(4) rescaled to mean 0 and variance 1. Unlike a Gaussian it is bounded (`±2√3`),
/// which makes the largest single step provable.
fn unit_bell(rng: &mut Pcg32) -> f64 {
    (rng.unit() + rng.unit() + rng.unit() + rng.unit() - 2.0) * SQRT_3
}

/// Returns `(bid, ask)` in cents for a mid in cents and a spread in basis points.
///
/// Guarantees `1 <= bid < ask` and, for a mid of at least 1 cent, `bid <= mid <= ask`: the spread
/// is at least 1 cent and the bid is the mid minus half the spread, rounded to the nearest cent.
fn quote(mid_cents: f64, spread_bps: f64) -> (u32, u32) {
    let spread = round_cents(mid_cents * spread_bps / BASIS_POINTS).max(1);
    let bid = round_cents(mid_cents - f64::from(spread) / 2.0).max(1);
    (bid, bid + spread)
}

/// Trade size for a side displaying `available`, given `u` in `[0, 1)`.
///
/// Always in `1..=min(available, MAX_TRADE_QUANTITY)`: `cap · u³ < cap` because `u < 1`, so its
/// floor is at most `cap − 1`. Cubing skews towards small trades (the median is an eighth of the
/// cap).
fn trade_quantity(available: NonZeroU32, u: f64) -> u32 {
    let cap = available.get().min(MAX_TRADE_QUANTITY);
    1 + floor_u32(f64::from(cap) * u * u * u)
}

/// Rounds half up to whole cents.
fn round_cents(cents: f64) -> u32 {
    floor_u32(cents + 0.5)
}

/// `⌊x⌋` for the finite, bounded values used here; negative input becomes 0.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the saturating `as` conversion is the intended floor for these bounded inputs"
)]
fn floor_u32(x: f64) -> u32 {
    x as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instrument(anchor_cents: f64, bid_quantity: u32, ask_quantity: u32) -> Instrument {
        Instrument {
            index: 0,
            anchor_cents,
            mid_cents: anchor_cents,
            spread_bps: MIN_SPREAD_BPS + SPREAD_BPS_SPAN,
            depth: MIN_DEPTH,
            bid_quantity,
            ask_quantity,
        }
    }

    #[test]
    fn quote_keeps_the_mid_inside_a_positive_spread() {
        let mut rng = Pcg32::new(1, 2);
        for _ in 0..100_000 {
            let mid = 700.0 + 70_000.0 * rng.unit();
            let spread_bps = (MIN_SPREAD_BPS + SPREAD_BPS_SPAN) * 1.5 * rng.unit();
            let (bid, ask) = quote(mid, spread_bps);
            assert!(bid >= 1 && bid < ask, "{bid} / {ask} at mid {mid}");
            assert!(
                f64::from(bid) <= mid && mid <= f64::from(ask),
                "{bid} / {ask} at mid {mid}"
            );
        }
    }

    #[test]
    fn quote_floors_the_spread_at_one_cent() {
        assert_eq!(quote(1_000.3, MIN_SPREAD_BPS), (1_000, 1_001));
        assert_eq!(quote(999.7, MIN_SPREAD_BPS), (999, 1_000));
    }

    #[test]
    fn trade_quantity_stays_within_the_available_quantity_and_the_cap() {
        let largest_unit = f64::from(u32::MAX) / 4_294_967_296.0;
        let one = NonZeroU32::MIN;
        let many = NonZeroU32::new(MAX_BOOK_QUANTITY).unwrap();
        let seven = NonZeroU32::new(7).unwrap();

        assert_eq!(trade_quantity(one, largest_unit), 1);
        assert_eq!(trade_quantity(seven, 0.0), 1);
        assert_eq!(trade_quantity(seven, largest_unit), 7);
        assert_eq!(trade_quantity(many, largest_unit), MAX_TRADE_QUANTITY);
    }

    #[test]
    fn trades_only_against_a_side_that_displays_quantity() {
        let mut rng = Pcg32::new(3, 4);
        let mut ask_only = instrument(10_000.0, 0, 7);
        let mut bid_only = instrument(10_000.0, 7, 0);
        for _ in 0..1_000 {
            assert_eq!(
                ask_only.take_side(&mut rng),
                (Side::Ask, NonZeroU32::new(7).unwrap())
            );
            assert_eq!(
                bid_only.take_side(&mut rng),
                (Side::Bid, NonZeroU32::new(7).unwrap())
            );
        }
    }

    #[test]
    fn an_empty_book_is_refilled_before_the_trade() {
        let mut rng = Pcg32::new(5, 6);
        for _ in 0..1_000 {
            let mut swept = instrument(10_000.0, 0, 0);
            let (side, available) = swept.take_side(&mut rng);
            let displayed = match side {
                Side::Bid => (swept.bid_quantity, swept.ask_quantity),
                Side::Ask => (swept.ask_quantity, swept.bid_quantity),
            };
            assert_eq!(displayed, (available.get(), 0));
            assert!(available <= MIN_DEPTH);
        }
    }

    /// Starting on a rail with the imbalance pushing outwards, a step either moves back inside
    /// or is held exactly on the rail; the second case must actually occur.
    #[test]
    #[expect(
        clippy::float_cmp,
        reason = "min/max return the rail operand itself, so a held mid equals it exactly"
    )]
    fn the_mid_is_held_on_the_rail() {
        let mut rng = Pcg32::new(7, 8);
        let mut subject = instrument(10_000.0, 500, 500);
        for (rail, imbalance) in [
            (10_000.0 * MAX_MID_TO_ANCHOR, 1.0),
            (10_000.0 * MIN_MID_TO_ANCHOR, -1.0),
        ] {
            let mut held = 0;
            for _ in 0..1_000 {
                subject.mid_cents = rail;
                subject.advance_mid(imbalance, &mut rng);
                let distance = (subject.mid_cents - 10_000.0).abs();
                assert!(
                    distance <= (rail - 10_000.0).abs(),
                    "left the rail at {rail}"
                );
                if subject.mid_cents == rail {
                    held += 1;
                }
            }
            assert!(held > 0, "the rail at {rail} never engaged");
        }
    }

    /// The rail bounds every price: from 1 cent below the cheapest possible mid to the dearest
    /// mid plus the widest possible spread.
    #[test]
    fn prices_stay_within_the_rail_derived_bounds() {
        let lowest = MIN_ANCHOR_CENTS * MIN_MID_TO_ANCHOR - 1.0;
        let highest = (MIN_ANCHOR_CENTS + ANCHOR_SPAN_CENTS)
            * MAX_MID_TO_ANCHOR
            * (1.0 + (MIN_SPREAD_BPS + SPREAD_BPS_SPAN) * 1.5 / BASIS_POINTS)
            + 1.0;
        let mut rng = Pcg32::new(9, 10);
        for anchor in [MIN_ANCHOR_CENTS, MIN_ANCHOR_CENTS + ANCHOR_SPAN_CENTS] {
            let mut subject = instrument(anchor, 500, 500);
            for _ in 0..200_000 {
                let update = subject.step(&mut rng);
                assert!(f64::from(update.bid_cents) >= lowest, "{update:?}");
                assert!(f64::from(update.ask_cents) <= highest, "{update:?}");
            }
        }
    }

    #[test]
    fn the_mid_moves_at_most_max_step_per_update() {
        let mut rng = Pcg32::new(11, 12);
        let mut subject = Instrument::new(0, &mut rng);
        for _ in 0..200_000 {
            let before = subject.mid_cents;
            subject.step(&mut rng);
            let change = (subject.mid_cents / before - 1.0).abs();
            assert!(
                change <= MAX_STEP,
                "relative change {change} exceeds {MAX_STEP}"
            );
        }
    }

    #[test]
    fn imbalance_is_zero_for_an_empty_book() {
        assert_eq!(imbalance(0, 0), 0.0);
        assert_eq!(imbalance(600, 400), 0.2);
        assert_eq!(imbalance(0, 5), -1.0);
    }
}
