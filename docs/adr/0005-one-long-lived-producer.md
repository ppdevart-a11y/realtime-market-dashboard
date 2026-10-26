# 5. One long-lived producer

Status: accepted

## Context

Navigating between the pages must preserve the active run and its running or paused state, and
must not create additional producers. Applying settings replaces the run. Producer resources must
be released when they are replaced or no longer needed, and initialisation errors must be shown.

## Decision

- `MarketDataStore` is a root service. An app initializer starts it, so the first run begins
  whichever page is opened first, and no page owns the producer.
- The producer is one dedicated module worker for the life of the app. Applying settings sends a
  `start` command with a new run id to the same worker.
- The engine supersedes the current run before anything else: it cancels the pending batch and
  frees the simulator, then creates the next one. If creating it fails, no run is left
  generating.
- Any exception from the generator ends the run, and the worker's host then refuses new runs,
  because a Wasm trap can leave the instance corrupt (`producer/producer-host.ts`). The store
  recovers by terminating the worker and starting a new one: on Apply once the producer has
  failed, and always through _Restart producer_.
- Disposing the store terminates the worker.

## Consequences

- `app.spec.ts` boots the real application providers and proves that opening the settings page
  first creates one producer with one `start`, and that a pause survives navigating between the
  pages.
- A new run reuses the instantiated Wasm module, so Apply costs one simulator, not a download and
  compilation.
- A replaced simulator is freed before its successor exists, so two never overlap. The contract
  test still proves that two simulators can run side by side without interference.
- Recovering from a failure costs a worker restart. After a deploy, the replaced worker file may
  no longer exist, so the failure message suggests reloading the page.

## Alternatives considered

- **A producer owned by the dashboard component.** Navigation would destroy and recreate it,
  losing the run.
- **A worker per run.** Each Apply would download, compile and instantiate the module again, and
  overlapping workers would complicate cleanup.
- **Creating the new simulator before freeing the old one.** It only helps if creation fails, and
  by then the store has already moved on to the new run, so the old run would keep generating
  unseen.
