import type { InstrumentSnapshot } from './market-aggregator';
import { isProducerSettings, type ProducerSettings } from './producer-settings';

/**
 * Messages between the UI thread and the producer worker.
 *
 * The UI issues a new, strictly increasing `runId` for every run and the worker tags every event
 * with the run it belongs to. Messages already in flight when a run is replaced therefore carry
 * the old id, and the UI drops them: a previous run can never overwrite the current one.
 */
export type ProducerCommand =
  | { readonly type: 'start'; readonly runId: number; readonly settings: ProducerSettings }
  | { readonly type: 'pause'; readonly runId: number }
  | { readonly type: 'resume'; readonly runId: number };

export type ProducerEvent =
  /** The run's generator exists; `seed` (a decimal u64) makes the run reproducible. */
  | { readonly type: 'started'; readonly runId: number; readonly seed: string }
  /** Cumulative state after a batch. Each snapshot supersedes the previous one of its run. */
  | {
      readonly type: 'snapshot';
      readonly runId: number;
      readonly instruments: readonly InstrumentSnapshot[];
      readonly totalUpdates: number;
    }
  /** `runId` is `null` when the failure is not tied to a run, e.g. the worker failed to load. */
  | { readonly type: 'failed'; readonly runId: number | null; readonly message: string };

/** Type guard for command data received through `postMessage`. */
export function isProducerCommand(value: unknown): value is ProducerCommand {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { type, runId, settings } = value as Record<string, unknown>;
  if (typeof runId !== 'number' || !Number.isSafeInteger(runId) || runId < 1) {
    return false;
  }
  return type === 'start' ? isProducerSettings(settings) : type === 'pause' || type === 'resume';
}
