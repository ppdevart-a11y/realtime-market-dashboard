# 4. Run ids, a per-run projection and frame conflation

Status: accepted

## Context

Applying settings starts a new run while messages from the previous one may still be in flight:
in the worker's queue, in the message channel, or already received and waiting to be rendered.
Results from a previous run must never overwrite the new run's state.

## Decision

- The store issues a strictly increasing run id for every run. Every command carries it, and the
  worker tags every event with the run it belongs to. Failures not tied to a run (the worker script
  could not run, a message could not be read) carry `null` and apply to whichever run is current.
- The store reads events through a per-run projection: each new run emits on a subject, and a
  `switchMap` subscribes to that run's events only, dropping the previous subscription.
- Inside the projection, lifecycle events (`started`, `failed`) are applied immediately, while
  snapshots pass through `auditTime(0, animationFrameScheduler)`: at most one snapshot per
  animation frame, always the latest. A run that is not confirmed within 15 seconds fails.

## Consequences

- A snapshot of the previous run that is waiting for a frame when the user applies new settings is
  discarded together with its subscription. A marble test covers exactly this case, and the tests
  fail if the projection becomes a `mergeMap` or the run filter is removed.
- Snapshots are cumulative, so dropping all but the latest loses no trade.
- The frame conflation buys less than it may seem: with at most 20 batches per
  second and displays at 60 Hz or more, almost every snapshot gets its own frame anyway. It bounds
  render work to one pass per frame when snapshots bunch up behind a long task, and a hidden tab,
  which runs no animation frames, renders nothing until it is shown again.
- Pause and resume update the UI immediately rather than waiting for the worker. Commands are
  delivered in order, and the only way to lose one is the worker failing, which is reported.

## Alternatives considered

- **Filtering events by run id without the projection.** It rejects stale events on arrival, but
  not a stale snapshot that was accepted and is still waiting for its frame.
- **Acknowledging every command.** More protocol and more states for no gain, given ordered
  delivery.
- **Rendering every snapshot, or throttling by time.** Rendering every snapshot works at 20 Hz but
  gives no protection after a long task. A time-based throttle picks an arbitrary rate that is not
  aligned to frames.
