/**
 * /logout reads the identity provider's sign-out address only for a sign-in
 * that completed, never for an address a visitor merely typed in.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuthRouter } from '../src/express/router.js';
import { clearEndSessionCache } from '../src/core/end-session.js';

let server;
let baseUrl;
let sessionState;
let fetched;

before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.session = { ...sessionState };
    req.solidSession = { info: { sessionId: 'sid-1', isLoggedIn: true } };
    next();
  });
  app.use('/api/auth', createAuthRouter({
    sessionManager: { fetchMap: new Map(), async logout() {} },
    baseUrl: 'http://backend.test',
    frontendUrl: 'http://frontend.test',
    rateLimit: false,
    logger: { log() {}, warn() {}, error() {} },
    fetch: async (url) => {
      fetched.push(String(url));
      return new Response(JSON.stringify({ end_session_endpoint: 'https://idp.example/session/end' }),
        { headers: { 'Content-Type': 'application/json' } });
    },
  }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

beforeEach(() => { fetched = []; clearEndSessionCache(); });

const logout = async () => (await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })).json();

describe('POST /logout', () => {
  it("returns the provider's published sign-out address after a completed sign-in", async () => {
    sessionState = { webId: 'https://alice.example/profile/card#me', oidcIssuer: 'https://idp.example/' };
    const body = await logout();
    assert.equal(body.endSessionUrl, 'https://idp.example/session/end');
    assert.deepEqual(fetched, ['https://idp.example/.well-known/openid-configuration']);
  });

  it('contacts nothing for a sign-in that was only started', async () => {
    sessionState = { oidcIssuer: 'http://169.254.169.254/' };
    const body = await logout();
    assert.equal(body.success, true);
    assert.equal(body.endSessionUrl, undefined);
    assert.deepEqual(fetched, []);
  });
});
