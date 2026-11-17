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
