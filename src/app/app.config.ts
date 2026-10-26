import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { MarketDataStore } from './market-data/market-data.store';
import { PRODUCER_TRANSPORT_FACTORY } from './market-data/producer-transport';
import { createWorkerProducerTransport } from './market-data/worker-producer-transport';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: PRODUCER_TRANSPORT_FACTORY, useValue: createWorkerProducerTransport },
    // The app opens with a running producer on the defaults, whichever page is opened first.
    // start() reports failures as state and never throws, so it cannot block bootstrap.
    provideAppInitializer(() => {
      inject(MarketDataStore).start();
    }),
  ],
};
