//! The record the simulator writes and JavaScript reads in place.

use core::mem::offset_of;

/// One simulated trade and the top of the book right after it.
///
/// Prices are integer cents and quantities are whole units. The trade consumes quantity but never
/// moves the quotes, so `price_cents` always equals `bid_cents` (a sell hit the bid) or
/// `ask_cents` (a buy lifted the ask), while the quantities are the post-trade book.
///
/// # Layout
///
/// `#[repr(C)]` with seven `u32` fields and no padding: 28 bytes, 4-byte aligned, fields in
/// declaration order. Wasm memory is little-endian, so JavaScript decodes a batch through a
/// `Uint32Array`: word `k` of record `i` is at index `pointer / 4 + i * UPDATE_STRIDE_WORDS + k`.
/// The field order is part of that contract, and the const assertions below fail the build if
/// it changes.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MarketUpdate {
    /// Instrument index in `0..instrument_count`; the UI maps indices to symbols.
    pub instrument: u32,
    /// Price of the trade.
    pub price_cents: u32,
    /// Quantity of the trade, at least 1.
    pub trade_quantity: u32,
    /// Best bid, at least 1 cent and always below `ask_cents`.
    pub bid_cents: u32,
    /// Best ask.
    pub ask_cents: u32,
    /// Quantity displayed at the bid after the trade; zero when the trade swept it.
    pub bid_quantity: u32,
    /// Quantity displayed at the ask after the trade; zero when the trade swept it.
    pub ask_quantity: u32,
}

/// Number of `u32` words in one [`MarketUpdate`].
pub const UPDATE_STRIDE_WORDS: u32 = 7;

const _: () = {
    assert!(size_of::<MarketUpdate>() == UPDATE_STRIDE_WORDS as usize * size_of::<u32>());
    assert!(align_of::<MarketUpdate>() == align_of::<u32>());
    assert!(offset_of!(MarketUpdate, instrument) == 0);
    assert!(offset_of!(MarketUpdate, price_cents) == 4);
    assert!(offset_of!(MarketUpdate, trade_quantity) == 8);
    assert!(offset_of!(MarketUpdate, bid_cents) == 12);
    assert!(offset_of!(MarketUpdate, ask_cents) == 16);
    assert!(offset_of!(MarketUpdate, bid_quantity) == 20);
    assert!(offset_of!(MarketUpdate, ask_quantity) == 24);
};
