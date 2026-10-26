import type { Scheduler } from '../scheduler';

/** Deterministic clock: tasks run only when the test advances time. */
export class ManualScheduler implements Scheduler {
  #now = 0;
  #tasks: { due: number; order: number; run: () => void }[] = [];
  #order = 0;

  now(): number {
    return this.#now;
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const task = { due: this.#now + delayMs, order: this.#order++, run: callback };
    this.#tasks.push(task);
    return () => {
      this.#tasks = this.#tasks.filter((pending) => pending !== task);
    };
  }

  /** Advances the clock, running every task that falls due along the way, in order. */
  advanceBy(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      const next = this.#tasks
        .filter((task) => task.due <= target)
        .sort((a, b) => a.due - b.due || a.order - b.order)
        .at(0);
      if (next === undefined) {
        break;
      }
      this.#tasks = this.#tasks.filter((task) => task !== next);
      this.#now = Math.max(this.#now, next.due);
      next.run();
    }
    this.#now = target;
  }

  /** Moves the clock without running anything, like a thread blocked by a long task. */
  stall(ms: number): void {
    this.#now += ms;
  }
}
