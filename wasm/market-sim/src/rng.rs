//! PCG32 (XSH-RR 64/32), ported line by line from the reference `pcg_basic.c`.
//!
//! References: M. E. O'Neill, "PCG: A Family of Simple Fast Space-Efficient Statistically Good
//! Algorithms for Random Number Generation", HMC-CS-2014-0905;
//! <https://github.com/imneme/pcg-c-basic>.

use core::num::NonZeroU32;

/// Multiplier of the underlying 64-bit LCG (`6364136223846793005ULL` in `pcg_basic.c`).
const MULTIPLIER: u64 = 6_364_136_223_846_793_005;

/// 2^-32. Multiplying a `u32` by it is exact in `f64`, so [`Pcg32::unit`] covers `[0, 1)`
/// without rounding up to 1.
const U32_TO_UNIT: f64 = 1.0 / 4_294_967_296.0;

/// A PCG32 generator: 64-bit state, 32-bit output, period 2^64 within each of 2^63 streams.
///
/// For the same `(initstate, initseq)` it produces exactly the sequence of the C reference
/// (`pcg32_random_r`, and `pcg32_boundedrand_r` for [`Pcg32::below`]); the tests check this
/// against the published output of `pcg32-demo`.
#[derive(Clone, Debug)]
pub struct Pcg32 {
    state: u64,
    /// Stream selector, always odd.
    increment: u64,
}

impl Pcg32 {
    /// Seeds the generator like `pcg32_srandom_r(rng, initstate, initseq)`.
    ///
    /// `initseq` selects the stream (its top bit is discarded) and `initstate` the starting
    /// point within it.
    #[must_use]
    pub fn new(initstate: u64, initseq: u64) -> Self {
        let mut rng = Self {
            state: 0,
            increment: (initseq << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(initstate);
        rng.next_u32();
        rng
    }

    /// Returns the next uniformly distributed `u32` (`pcg32_random_r`).
    #[expect(
        clippy::cast_possible_truncation,
        reason = "XSH-RR keeps the low 32 bits of the shifted state by design"
    )]
    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(MULTIPLIER).wrapping_add(self.increment);
        // Xorshift the high bits down, then rotate by the top five bits of the old state.
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rotation = (old >> 59) as u32;
        xorshifted.rotate_right(rotation)
    }

    /// Returns a uniformly distributed value in `0..bound` (`pcg32_boundedrand_r`).
    ///
    /// Draws below `2^32 mod bound` are rejected, so the accepted range is a multiple of `bound`
    /// and `value % bound` is unbiased. This is the reference method rather than Lemire's
    /// multiply-shift so that bounded draws also reproduce the published vectors. Each draw is
    /// accepted with probability above 1/2, so the loop ends after fewer than two draws on
    /// average. `NonZeroU32` rules out division by zero at the type level.
    pub fn below(&mut self, bound: NonZeroU32) -> u32 {
        // (2^32 - bound) % bound == 2^32 % bound, without 64-bit division.
        let threshold = bound.get().wrapping_neg() % bound;
        loop {
            let value = self.next_u32();
            if value >= threshold {
                return value % bound;
            }
        }
    }

    /// Returns a uniformly distributed `f64` in `[0, 1)` with 32 bits of resolution.
    pub fn unit(&mut self) -> f64 {
        f64::from(self.next_u32()) * U32_TO_UNIT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn non_zero(value: u32) -> NonZeroU32 {
        NonZeroU32::new(value).expect("test bounds are non-zero")
    }

    /// Replays the first round of `pcg32-demo` (pcg-c-basic `bc39cd7`, seeded with
    /// `pcg32_srandom_r(&rng, 42u, 54u)`) and the 32-bit line of its second round. Round one also
    /// matches pcg-c's `test-high/expected/check-pcg32.out` (`83252d9`). The coins, dice and
    /// card shuffle exercise `below` with bounds 2, 6 and 52 down to 2.
    #[test]
    fn reproduces_the_pcg32_demo_transcript() {
        let mut rng = Pcg32::new(42, 54);

        let words: Vec<u32> = (0..6).map(|_| rng.next_u32()).collect();
        assert_eq!(
            words,
            [
                0xa15c_02b7,
                0x7b47_f409,
                0xba1d_3330,
                0x83d2_f293,
                0xbfa4_784b,
                0xcbed_606e
            ],
            "round 1, 32bit"
        );

        let coins: String = (0..65)
            .map(|_| {
                if rng.below(non_zero(2)) == 1 {
                    'H'
                } else {
                    'T'
                }
            })
            .collect();
        assert_eq!(
            coins, "HHTTTHTHHHTHTTTHHHHHTTTHHHTHTHTHTTHTTTHHHHHHTTTTHHTTTTTHTTTTTTTHT",
            "round 1, coins"
        );

        let rolls: Vec<u32> = (0..33).map(|_| rng.below(non_zero(6)) + 1).collect();
        assert_eq!(
            rolls,
            [
                3, 4, 1, 1, 2, 2, 3, 2, 4, 3, 2, 4, 3, 3, 5, 2, 3, 1, 3, 1, 5, 1, 4, 1, 5, 6, 4, 6,
                6, 2, 6, 3, 3
            ],
            "round 1, rolls"
        );

        // Fisher-Yates exactly as in the demo: card `c` is rank `c / 4` of suit `c % 4`.
        let mut cards: Vec<usize> = (0..52).collect();
        for remaining in (2..=52_u32).rev() {
            let chosen = rng.below(non_zero(remaining)) as usize;
            cards.swap(chosen, remaining as usize - 1);
        }
        let ranks = b"A23456789TJQK";
        let suits = b"hcds";
        let dealt: Vec<String> = cards
            .iter()
            .map(|&card| {
                format!(
                    "{}{}",
                    char::from(ranks[card / 4]),
                    char::from(suits[card % 4])
                )
            })
            .collect();
        assert_eq!(
            dealt.join(" "),
            "Qd Ks 6d 3s 3d 4c 3h Td Kc 5c Jh Kd Jd As 4s 4h Ad Th Ac Jc 7s Qs 2s 7h Kh 2d \
             6c Ah 4d Qh 9h 6s 5s 2c 9c Ts 8d 9s 3c 8c Js 5d 2h 6h 7d 8s 9d 5h 8h Qc 7c Tc",
            "round 1, cards"
        );

        let words: Vec<u32> = (0..6).map(|_| rng.next_u32()).collect();
        assert_eq!(
            words,
            [
                0x74ab_93ad,
                0x1c1d_a000,
                0x494f_f896,
                0x3446_2f2f,
                0xd308_a3e5,
                0x0fa8_3bab
            ],
            "round 2, 32bit"
        );
    }

    #[test]
    fn below_one_is_zero_and_consumes_exactly_one_draw() {
        let mut bounded = Pcg32::new(7, 11);
        let mut reference = Pcg32::new(7, 11);

        assert_eq!(bounded.below(NonZeroU32::MIN), 0);
        reference.next_u32();
        assert_eq!(bounded.next_u32(), reference.next_u32());
    }

    /// The trade-size formula relies on `unit() < 1` to stay within the available quantity.
    #[test]
    fn unit_never_reaches_one() {
        assert_eq!(f64::from(u32::MIN) * U32_TO_UNIT, 0.0);
        assert!(f64::from(u32::MAX) * U32_TO_UNIT < 1.0);
    }
}
