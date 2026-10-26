# Architecture decision records

Each record covers one decision: its context, the decision itself, its consequences and the
alternatives that were rejected. The project README summarises them; these records give the
reasoning.

| Record                                             | Decision                                                     |
| -------------------------------------------------- | ------------------------------------------------------------ |
| [0001](0001-deterministic-rust-generator.md)       | A deterministic market generator in Rust                     |
| [0002](0002-read-batches-in-place.md)              | Reading batches in place from Wasm memory                    |
| [0003](0003-metrics-in-the-worker.md)              | Aggregating metrics in the worker                            |
| [0004](0004-run-isolation-and-frame-conflation.md) | Run ids, a per-run projection and frame conflation           |
| [0005](0005-one-long-lived-producer.md)            | One long-lived producer                                      |
| [0006](0006-delivery.md)                           | Delivery: GitHub Actions to Cloudflare Workers static assets |
