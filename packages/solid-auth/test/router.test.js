/**
 * The sign-in router's other endpoints: starting a sign-in, the status the
 * app polls, the provider list, and setting a Pod address by hand.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuthRouter } from '../src/express/router.js';

let server;
let baseUrl;
const started = [];
const podSaves = [];

const realFetch = globalThis.fetch;

before(async () => {
  // The status endpoint looks Pods up with the global fetch: keep tests offline
  globalThis.fetch = async (input, init) => (String(input).startsWith('http://127.0.0.1')
    ? realFetch(input, init)
    : Promise.reject(new Error('no network in tests')));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = req.get('x-webid')
      ? { webId: req.get('x-webid'), podUrl: req.get('x-pod') || undefined, mfaPending: req.get('x-mfa') === 'pending' }
      : {};
    req.solidSession = { info: { isLoggedIn: false } };
    next();
  });
  app.use('/api/auth', createAuthRouter({
    sessionManager: {
      fetchMap: new Map(),
      createFreshSession: () => ({ info: { sessionId: 'fresh' } }),
      async startLogin(_session, opts) { started.push(opts.oidcIssuer); opts.handleRedirect(`${opts.oidcIssuer}/authorize`); },
    },
    baseUrl: 'http://backend.test',
    frontendUrl: 'http://frontend.test',
    defaultIdp: 'https://login.inrupt.com',
    providers: [{ name: 'Example', url: 'https://idp.example' }],
    rateLimit: false,
    fetch: async () => { throw new Error('no network in tests'); },
    onStatus: async () => ({ hasPasskeys: true }),
    onPodUrlSave: async (_req, info) => { podSaves.push(info.podUrl); },
    logger: { log() {}, warn() {}, error() {} },
  }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => { globalThis.fetch = realFetch; server?.close(); });

const get = (path, headers = {}) => fetch(`${baseUrl}/api/auth${path}`, { headers, redirect: 'manual' });

describe('GET /login', () => {
  it('starts a sign-in with the chosen provider', async () => {
    const res = await get(`/login?oidcIssuer=${encodeURIComponent('https://idp.example')}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://idp.example/authorize');
    assert.equal(started.at(-1), 'https://idp.example');
  });

  it('uses the default provider when none is given', async () => {
    await get('/login');
    assert.equal(started.at(-1), 'https://login.inrupt.com');
  });

  it("refuses a provider address that isn't http(s), without contacting it", async () => {
    const before = started.length;
    const res = await get(`/login?oidcIssuer=${encodeURIComponent('javascript:alert(1)')}`);
    const url = new URL(res.headers.get('location'));
    assert.equal(url.origin, 'http://frontend.test');
    assert.equal(url.searchParams.get('login'), 'error');
    assert.equal(started.length, before);
  });

  it('ignores a return address on another site', async () => {
    const res = await get(`/login?returnTo=${encodeURIComponent('https://evil.example/')}&oidcIssuer=javascript:x`);
    assert.equal(new URL(res.headers.get('location')).origin, 'http://frontend.test');
  });
});

describe('GET /providers', () => {
  it('lists the configured default first, then the offered providers', async () => {
    const body = await (await get('/providers')).json();
    assert.equal(body.default, 'https://login.inrupt.com');
    assert.deepEqual(body.providers.map((p) => p.url), ['https://login.inrupt.com', 'https://idp.example']);
  });
});

describe('GET /status', () => {
  it('says when no one is signed in', async () => {
    const body = await (await get('/status')).json();
    assert.equal(body.isLoggedIn, false);
  });

  it("reports the signed-in WebID, the session's Pod, the passkey check and the app's extra fields", async () => {
    const body = await (await get('/status', {
      'x-webid': 'https://alice.example/profile/card#me', 'x-pod': 'https://alice.example/', 'x-mfa': 'pending',
    })).json();
    assert.equal(body.isLoggedIn, true);
    assert.equal(body.webId, 'https://alice.example/profile/card#me');
    assert.deepEqual(body.pods, ['https://alice.example/']);
    assert.equal(body.mfaPending, true);
    assert.equal(body.hasPasskeys, true);
  });
});

describe('PUT /pod-url', () => {
  const put = (podUrl, webId = 'https://alice.example/profile/card#me') => fetch(`${baseUrl}/api/auth/pod-url`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(webId ? { 'x-webid': webId } : {}) },
    body: JSON.stringify({ podUrl }),
  });

  it('saves an https Pod address, with a trailing slash', async () => {
    const res = await put('https://pod.example/alice');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).podUrl, 'https://pod.example/alice/');
    assert.equal(podSaves.at(-1), 'https://pod.example/alice/');
  });

  it('refuses an address that is not https, and anyone not signed in', async () => {
    assert.equal((await put('http://pod.example/')).status, 400);
    assert.equal((await put('not a url')).status, 400);
    assert.equal((await put('https://pod.example/', null)).status, 401);
  });
});
