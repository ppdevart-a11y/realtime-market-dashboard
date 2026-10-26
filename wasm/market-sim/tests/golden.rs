//! Pins the exact output for one instrument count, seed and sequence of batch sizes.
//!
//! The TypeScript contract test reads the same fixture and compares it with the compiled `.wasm`.
//! Together they show that native and Wasm builds agree bit for bit and that JavaScript decodes
//! the fields in the right order: swapping two fields of the same kind, such as the bid and ask
//! quantities, passes every invariant but not this comparison.
//!
//! After an intentional change to the model, regenerate the fixture with
//! `GOLDEN_BLESS=1 cargo test --test golden` and review its diff like code.

use std::fmt::Write as _;
use std::path::PathBuf;
use std::{env, fs};

use market_sim::{MarketSimulator, MarketUpdate};

const INSTRUMENT_COUNT: u32 = 5;
const SEED: u64 = 42;
const BATCH_SIZES: [u32; 3] = [1, 7, 100];

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/golden-5-42.txt")
}

/// Header lines start with `#`; the first one states the inputs as `key=value` pairs so the
/// TypeScript test can read them instead of repeating them.
fn render(updates: &[MarketUpdate]) -> String {
    let batch_sizes = BATCH_SIZES.map(|size| size.to_string()).join(",");
    let mut text = format!(
        "# instrument_count={INSTRUMENT_COUNT} seed={SEED} batch_sizes={batch_sizes}\n\
         # one update per line, fields in MarketUpdate order:\n\
         # instrument price_cents trade_quantity bid_cents ask_cents bid_quantity ask_quantity\n"
    );
    for update in updates {
        writeln!(
            text,
            "{} {} {} {} {} {} {}",
            update.instrument,
            update.price_cents,
            update.trade_quantity,
            update.bid_cents,
            update.ask_cents,
            update.bid_quantity,
            update.ask_quantity
        )
        .expect("writing to a String cannot fail");
    }
    text
}

#[test]
fn output_matches_the_golden_fixture() {
    let mut simulator =
        MarketSimulator::new(INSTRUMENT_COUNT, SEED).expect("valid instrument count");
    let mut updates = Vec::new();
    for size in BATCH_SIZES {
        updates.extend_from_slice(simulator.generate(size).expect("valid batch size"));
    }
    let actual = render(&updates);

    let path = fixture_path();
    if env::var_os("GOLDEN_BLESS").is_some() {
        fs::write(&path, &actual).expect("fixture is writable");
        return;
    }
    let expected = fs::read_to_string(&path).expect("fixture exists; bless it to create it");
    for (number, (actual, expected)) in actual.lines().zip(expected.lines()).enumerate() {
        assert_eq!(
            actual,
            expected,
            "line {} of {} differs; after an intentional model change run \
             `GOLDEN_BLESS=1 cargo test --test golden`",
            number + 1,
            path.display()
        );
    }
    assert_eq!(
        actual.lines().count(),
        expected.lines().count(),
        "line count differs"
    );
}
