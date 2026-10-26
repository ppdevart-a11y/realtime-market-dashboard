import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import worker from './worker.mjs';

const shell = new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });

function environment() {
  const requested = [];
  return {
    requested,
    env: {
      ASSETS: {
        fetch: (url) => {
          requested.push(url.toString());
          return shell;
        },
      },
    },
  };
}

const fetchPath = (path, env) => worker.fetch(new Request(`https://demo.example${path}`), env);

describe('the asset-miss Worker', () => {
  for (const path of [
    '/settings',
    '/settings/',
    '/a/deep/route',
    '/v1.2/settings',
    '/settings?x=1.js',
  ]) {
    it(`serves the app shell for the app route ${path}`, () => {
      const { env, requested } = environment();

      assert.equal(fetchPath(path, env), shell);
      assert.deepEqual(requested, ['https://demo.example/']);
    });
  }

  for (const path of [
    '/chunk-MISSING.js',
    '/media/missing.wasm',
    '/styles-OLD.css',
    '/favicon.ico',
  ]) {
    it(`answers a missing file (${path}) with an uncacheable 404, never the shell`, () => {
      const { env, requested } = environment();

      const response = fetchPath(path, env);

      assert.equal(response.status, 404);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(requested, []);
    });
  }
});
