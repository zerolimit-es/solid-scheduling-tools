/**
 * The passkey router's other endpoints: who may register, list and remove
 * passkeys, and what each answers.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPasskeyRouter } from '../src/express/router.js';

let server;
let baseUrl;
let passkeys;
const challenges = new Map();

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // The test says, per request, who is signed in and whether MFA is pending
    req.session = req.get('x-user')
      ? { webId: `https://${req.get('x-user')}.example/profile/card#me`, mfaPending: req.get('x-mfa') === 'pending' }
      : {};
    req.userId = req.get('x-user');
    next();
  });
  app.use('/passkey', createPasskeyRouter({
    challengeStore: {
      async store(user, challenge) { challenges.set(user, challenge); },
      async get(user) { const c = challenges.get(user); challenges.delete(user); return c; },
    },
    credentialStore: {
      async getByUser(user) { return passkeys.filter((p) => p.userId === user); },
      async getByCredentialId(id) { return passkeys.find((p) => p.credentialId === id) ?? null; },
      async save(record) { passkeys.push(record); },
      async remove(id, user) {
        const before = passkeys.length;
        passkeys = passkeys.filter((p) => !(p.id === id && p.userId === user));
        return passkeys.length < before;
      },
      async updateCounter() {},
    },
    rpName: 'Test', rpId: 'localhost', origin: 'http://localhost',
    getUserId: (req) => req.userId,
    getWebId: (req) => req.session?.webId,
    rateLimit: false,
    logger: { log() {}, warn() {}, error() {} },
  }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

beforeEach(() => {
  challenges.clear();
  passkeys = [
    { id: 'pk-a', userId: 'alice', credentialId: 'Y3JlZC1h', transports: '["internal"]', deviceName: 'Laptop', createdAt: '2030-01-01' },
    { id: 'pk-m', userId: 'mallory', credentialId: 'Y3JlZC1t', transports: '[]', deviceName: 'Phone', createdAt: '2030-01-02' },
  ];
});

async function call(method, path, { user, mfa, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-user'] = user;
  if (mfa) headers['x-mfa'] = mfa;
  const res = await fetch(`${baseUrl}/passkey${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('passkey router', () => {
  it('refuses everything to someone not signed in', async () => {
    for (const [method, path] of [['GET', '/register-options'], ['GET', '/auth-options'], ['GET', '/list'], ['DELETE', '/pk-a']]) {
      assert.equal((await call(method, path)).status, 401, `${method} ${path}`);
    }
  });

  it('gives registration options that exclude passkeys already registered, and stores the challenge', async () => {
    const { status, body } = await call('GET', '/register-options', { user: 'alice' });
    assert.equal(status, 200);
    assert.equal(body.rp.id, 'localhost');
    assert.deepEqual(body.excludeCredentials.map((c) => c.id), ['Y3JlZC1h']);
    assert.equal(challenges.get('alice'), body.challenge);
  });

  it("doesn't let a sign-in still waiting for its passkey check register, list or remove passkeys", async () => {
    assert.equal((await call('GET', '/register-options', { user: 'alice', mfa: 'pending' })).status, 403);
    assert.equal((await call('POST', '/register-verify', { user: 'alice', mfa: 'pending', body: { body: {} } })).status, 403);
    assert.equal((await call('GET', '/list', { user: 'alice', mfa: 'pending' })).status, 403);
    assert.equal((await call('DELETE', '/pk-a', { user: 'alice', mfa: 'pending' })).status, 403);
  });

  it('refuses a registration without a fresh challenge or a response', async () => {
    assert.equal((await call('POST', '/register-verify', { user: 'alice', body: { body: {} } })).body.error,
      'Challenge expired or not found — try again');
    await call('GET', '/register-options', { user: 'alice' });
    assert.equal((await call('POST', '/register-verify', { user: 'alice', body: {} })).body.error, 'Missing registration response');
  });

  it("offers sign-in options for the account's own passkeys only", async () => {
    const { body } = await call('GET', '/auth-options', { user: 'alice', mfa: 'pending' });
    assert.deepEqual(body.allowCredentials.map((c) => c.id), ['Y3JlZC1h']);
    assert.equal((await call('GET', '/auth-options', { user: 'nobody' })).status, 404);
  });

  it("lists the account's own passkeys", async () => {
    const { body } = await call('GET', '/list', { user: 'alice' });
    assert.deepEqual(body.passkeys.map((p) => [p.id, p.deviceName]), [['pk-a', 'Laptop']]);
  });

  it("removes the account's own passkey, never another account's", async () => {
    assert.equal((await call('DELETE', '/pk-m', { user: 'alice' })).status, 404);
    assert.equal(passkeys.length, 2);
    assert.equal((await call('DELETE', '/pk-a', { user: 'alice' })).status, 200);
    assert.deepEqual(passkeys.map((p) => p.id), ['pk-m']);
  });
});
