import wasmUrl from 'market-sim/market_sim_bg.wasm';
import { createProducerHost } from './producer-host';
import { timerScheduler } from './scheduler';
import { loadWasmMarketSourceFactory } from './wasm-market-source';

// Worker entry point: wiring only. The behaviour lives in producer-host.ts.

const host = createProducerHost({
  post: (event) => {
    postMessage(event);
  },
  // Starts downloading the generator at once, in parallel with the UI's first command.
  sources: loadWasmMarketSourceFactory(new URL(wasmUrl, location.href)),
  scheduler: timerScheduler,
  randomSeed: () => crypto.getRandomValues(new BigUint64Array(1))[0],
  logError: (error) => {
    console.error(error);
  },
});

addEventListener('message', (event: MessageEvent<unknown>) => {
  host.receive(event.data);
});

// Handled here, so the browser does not also report them to the page as a generic worker error.
addEventListener('error', (event) => {
  event.preventDefault();
  host.fail(event.error ?? event.message);
});
addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  host.fail(event.reason);
});
