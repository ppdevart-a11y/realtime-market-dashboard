/**
 * Time source and one-shot timer for the producer engine. A port rather than direct
 * `setTimeout` calls, so tests drive time explicitly instead of waiting in real time.
 */
export interface Scheduler {
  /** Monotonic time in milliseconds. */
  now(): number;
  /** Runs `callback` once after `delayMs`; the returned function cancels it if still pending. */
  schedule(callback: () => void, delayMs: number): () => void;
}

export const timerScheduler: Scheduler = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(handle);
    };
  },
};
