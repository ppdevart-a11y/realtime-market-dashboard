import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ProducerCommand, ProducerEvent } from '../domain/producer-protocol';

/** A channel to one producer instance; in the app, one dedicated Web Worker. */
export interface ProducerTransport {
  /** Events from the producer, including transport-level failures (`runId: null`). Hot. */
  readonly events$: Observable<ProducerEvent>;
  send(command: ProducerCommand): void;
  /** Stops the producer and releases its resources. The transport is unusable afterwards. */
  dispose(): void;
}

/**
 * Creates a producer. Injected rather than imported so the composition root decides what a
 * producer is (a Web Worker in the app, an in-memory fake in tests).
 *
 * @throws if the environment cannot host a producer; callers surface this as an error state.
 */
export type ProducerTransportFactory = () => ProducerTransport;

export const PRODUCER_TRANSPORT_FACTORY = new InjectionToken<ProducerTransportFactory>(
  'PRODUCER_TRANSPORT_FACTORY',
);
