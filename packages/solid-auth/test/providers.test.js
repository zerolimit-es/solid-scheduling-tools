import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuthRouter } from '../src/express/router.js';
import { DEFAULT_PROVIDERS } from '../src/core/providers.js';

/** GET /providers from a router built with these options. */
async function providers(options) {
  const app = express();
  app.use(createAuthRouter({
    sessionManager: {},
    baseUrl: 'http://localhost:3001',
    frontendUrl: 'http://localhost:3000',
    rateLimit: false,
    ...options,
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    return await (await fetch(`http://127.0.0.1:${server.address().port}/providers`)).json();
  } finally {
    server.close();
  }
}

describe('GET /providers', () => {
  it('lists a self-hosted default identity provider first, so it can be chosen', async () => {
    const body = await providers({ defaultIdp: 'https://id.example.org' });
    assert.equal(body.default, 'https://id.example.org');
    assert.equal(body.providers[0].url, 'https://id.example.org');
    assert.equal(body.providers[0].name, 'id.example.org');
    assert.equal(body.providers.length, DEFAULT_PROVIDERS.length + 1);
  });

  it('does not repeat a default that is already listed, trailing slash or not', async () => {
    const body = await providers({ defaultIdp: 'https://solidcommunity.net/' });
    assert.equal(body.providers.length, DEFAULT_PROVIDERS.length);
    assert.equal(body.default, 'https://solidcommunity.net/');
  });

  it('keeps a port in the name of a local provider', async () => {
    const body = await providers({ defaultIdp: 'http://localhost:3000' });
    assert.equal(body.providers[0].name, 'localhost:3000');
  });
});

describe('stripTrailingSlashes', async () => {
  const { stripTrailingSlashes } = await import('../src/core/safe-url.js');

  it('removes any number of trailing slashes and nothing else', () => {
    assert.equal(stripTrailingSlashes('https://id.example.org///'), 'https://id.example.org');
    assert.equal(stripTrailingSlashes('https://id.example.org/path'), 'https://id.example.org/path');
    assert.equal(stripTrailingSlashes('///'), '');
    assert.equal(stripTrailingSlashes(null), '');
  });

  it('stays fast on a long run of slashes', () => {
    const input = `${'/'.repeat(100000)}x`;
    const started = process.hrtime.bigint();
    assert.equal(stripTrailingSlashes(input), input);
    assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 100, 'well under 100 ms');
  });
});
