import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { findEndSessionUrl, clearEndSessionCache } from '../src/core/end-session.js';

const discovery = (body, status = 200) => async (url) => {
  discovery.calls.push(String(url));
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};

describe('findEndSessionUrl', () => {
  beforeEach(() => { clearEndSessionCache(); discovery.calls = []; });

  it("reads the provider's end_session_endpoint from its discovery document", async () => {
    const fetch = discovery({ issuer: 'https://idp.example/', end_session_endpoint: 'https://idp.example/oidc/session/end' });
    assert.equal(await findEndSessionUrl('https://idp.example/', { fetch }), 'https://idp.example/oidc/session/end');
    assert.deepEqual(discovery.calls, ['https://idp.example/.well-known/openid-configuration']);
  });

  it('returns null when the provider publishes none, and remembers that', async () => {
    const fetch = discovery({ issuer: 'https://idp.example/' });
    assert.equal(await findEndSessionUrl('https://idp.example', { fetch }), null);
    assert.equal(await findEndSessionUrl('https://idp.example', { fetch }), null);
    assert.equal(discovery.calls.length, 1);
  });

  it('ignores an endpoint that is not an http(s) address', async () => {
    const fetch = discovery({ end_session_endpoint: 'javascript:alert(1)' });
    assert.equal(await findEndSessionUrl('https://idp.example/', { fetch }), null);
  });

  it('returns null when discovery fails, and tries again next time', async () => {
    const failing = async (url) => { discovery.calls.push(String(url)); throw new Error('down'); };
    assert.equal(await findEndSessionUrl('https://idp.example/', { fetch: failing }), null);
    assert.equal(await findEndSessionUrl('https://idp.example/', { fetch: failing }), null);
    assert.equal(discovery.calls.length, 2);
  });

  it('returns null for an issuer that is not a URL', async () => {
    assert.equal(await findEndSessionUrl('not a url', { fetch: discovery({}) }), null);
    assert.deepEqual(discovery.calls, []);
  });
});
