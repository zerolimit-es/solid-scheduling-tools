/**
 * /callback must enforce the Solid-OIDC issuer binding: a token for a WebID
 * from an issuer that WebID does not list must not produce a session.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieSession from 'cookie-session';
import { createAuthRouter } from '../src/express/router.js';

const VICTIM = 'https://victim.example/profile/card#me';
const REAL_IDP = 'https://real-idp.example/';
const realFetch = globalThis.fetch;

let server;
let baseUrl;
let sessionManager;
let hookCalls;
let hookResult;

function makeSessionManager() {
  return {
    fetchMap: new Map([[VICTIM, 'victim-live-fetch']]),
    discarded: [],
    loggedOut: [],
    async handleCallback(session) {
      session.info.isLoggedIn = true;
      session.info.webId = VICTIM;
      return { isLoggedIn: true, webId: VICTIM, sessionId: session.info.sessionId };
    },
    async discardSession(session) { this.discarded.push(session.info.sessionId); },
    async logout(session) { this.loggedOut.push(session.info.sessionId); },
  };
}

before(async () => {
  // Public WebID profile: the victim trusts only REAL_IDP.
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://victim.example/')) {
      return new Response(
        `<${VICTIM}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${REAL_IDP}> .`,
        { headers: { 'Content-Type': 'text/turtle' } }
      );
    }
    return realFetch(url, init);
  };

  const app = express();
  app.use(cookieSession({ name: 's', secret: 'test-secret' }));
  app.use((req, _res, next) => {
    // State left behind by /login with the chosen issuer.
    if (req.query.issuer) req.session.oidcIssuer = req.query.issuer;
    req.session.solidSessionId = 'sid-1';
    req.solidSession = {
      info: { sessionId: 'sid-1', isLoggedIn: false },
      fetch: async () => { throw new Error('no pod discovery in tests'); },
    };
    next();
  });
  app.use('/api/auth', (req, res, next) => createAuthRouter({
    sessionManager,
    baseUrl: 'http://backend.test',
    frontendUrl: 'http://frontend.test',
    rateLimit: false,
    logger: { log() {}, warn() {}, error() {} },
    onCallback: async (_req, ctx) => { hookCalls.push(ctx.webId); return hookResult; },
  })(req, res, next));

  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  globalThis.fetch = realFetch;
  server?.close();
});

beforeEach(() => {
  sessionManager = makeSessionManager();
  hookCalls = [];
  hookResult = undefined;
});

async function callback(issuer) {
  const qs = issuer ? `&issuer=${encodeURIComponent(issuer)}` : '';
  const res = await realFetch(`${baseUrl}/api/auth/callback?code=x&state=y${qs}`, { redirect: 'manual' });
  const match = (res.headers.get('set-cookie') || '').match(/(?:^|,\s*)s=([^;]+)/);
  const session = match ? JSON.parse(Buffer.from(match[1], 'base64').toString()) : {};
  const location = new URL(res.headers.get('location'));
  return { location, session };
}

describe('GET /callback issuer binding', () => {
  it('rejects a token from an issuer the WebID does not list', async () => {
    const { location, session } = await callback('https://evil-idp.example/');
    assert.equal(location.origin, 'http://frontend.test');
    assert.equal(location.searchParams.get('login'), 'failed');
    assert.equal(session.webId, undefined);
    assert.equal(session.solidSessionId, undefined);
    assert.deepEqual(sessionManager.discarded, ['sid-1']);
    assert.deepEqual(hookCalls, [], 'app hook must not run for a rejected login');
    // The real user's live fetch is untouched
    assert.equal(sessionManager.fetchMap.get(VICTIM), 'victim-live-fetch');
  });

  it('rejects when no issuer was recorded at login', async () => {
    const { location, session } = await callback(undefined);
    assert.equal(location.searchParams.get('login'), 'failed');
    assert.equal(session.webId, undefined);
  });

  it('accepts the issuer listed in the WebID profile', async () => {
    const { location, session } = await callback('https://real-idp.example');
    assert.equal(location.searchParams.get('login'), 'success');
    assert.equal(session.webId, VICTIM);
    assert.deepEqual(hookCalls, [VICTIM]);
    assert.deepEqual(sessionManager.discarded, []);
  });

  it('lets onCallback veto a login', async () => {
    hookResult = { reject: true, reason: 'account disabled' };
    const { location, session } = await callback(REAL_IDP);
    assert.equal(location.searchParams.get('login'), 'failed');
    assert.equal(session.webId, undefined);
    assert.deepEqual(sessionManager.discarded, ['sid-1']);
  });
});
