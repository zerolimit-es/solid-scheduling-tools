/**
 * /auth-verify must only accept a credential registered to the user being
 * verified, even though credential stores look credentials up by ID alone.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPasskeyRouter } from '../src/express/router.js';

const records = {
  'cred-alice': { id: 'pk-a', userId: 'alice', credentialId: 'cred-alice', publicKey: Buffer.from('a'), counter: 0 },
  'cred-mallory': { id: 'pk-m', userId: 'mallory', credentialId: 'cred-mallory', publicKey: Buffer.from('m'), counter: 0 },
  'cred-orphan': { id: 'pk-o', credentialId: 'cred-orphan', publicKey: Buffer.from('o'), counter: 0 },
};

let server;
let baseUrl;
const logged = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { webId: 'https://alice.example/#me', mfaPending: true };
    req.userId = req.get('x-user');
    next();
  });
  app.use('/passkey', createPasskeyRouter({
    challengeStore: { async store() {}, async get() { return 'challenge'; } },
    credentialStore: {
      async getByUser(u) { return Object.values(records).filter((r) => r.userId === u); },
      async getByCredentialId(id) { return records[id] ?? null; },
      async save() {}, async remove() { return false; }, async updateCounter() {},
    },
    rpName: 'Test', rpId: 'localhost', origin: 'http://localhost',
    getUserId: (req) => req.userId,
    getWebId: () => null,
    rateLimit: false,
    logger: { log() {}, warn: (...a) => logged.push(a.join(' ')), error() {} },
  }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function verify(user, credentialId) {
  const res = await fetch(`${baseUrl}/passkey/auth-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user': user },
    body: JSON.stringify({ body: { id: credentialId, rawId: credentialId, type: 'public-key', response: {} } }),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /auth-verify credential ownership', () => {
  it("rejects another user's passkey before verifying it", async () => {
    const r = await verify('alice', 'cred-mallory');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'Passkey not found');
    assert.ok(logged.some((l) => l.includes('another user')));
  });

  it('rejects a record with no owner', async () => {
    assert.equal((await verify('alice', 'cred-orphan')).body.error, 'Passkey not found');
  });

  it('rejects an unknown credential', async () => {
    assert.equal((await verify('alice', 'nope')).body.error, 'Passkey not found');
  });

  it("passes the user's own passkey on to WebAuthn verification", async () => {
    // The fake assertion fails cryptographic verification, but it must get
    // past the ownership check to do so.
    const r = await verify('alice', 'cred-alice');
    assert.notEqual(r.body.error, 'Passkey not found');
    assert.notEqual(r.body.verified, true);
  });
});
