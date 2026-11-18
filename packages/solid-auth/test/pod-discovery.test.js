/**
 * Pod discovery decides which Pods the server talks to for a user, so each
 * way of finding them is checked, including what it must not accept.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverPodUrls } from '../src/core/pod-discovery.js';

const WEBID = 'https://alice.example/profile/card#me';
const POD = 'https://alice.example/';
const quiet = { log() {}, warn() {}, error() {} };

/** A fake authenticated fetch answering from a table of URL → responder. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = String(input).split('#')[0];
    calls.push({ url, method: init.method || 'GET', accept: init.headers?.Accept });
    const route = routes[url];
    if (!route) return new Response('Not found', { status: 404 });
    const res = route(init);
    if (!res.url) Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  fetch.calls = calls;
  return fetch;
}
const turtle = (body) => () => new Response(body, { headers: { 'Content-Type': 'text/turtle' } });
const jsonld = (body) => () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/ld+json' } });
// Run one strategy alone (1-based)
const only = (n) => [1, 2, 3, 4, 5].map((i) => i === n);

describe('discoverPodUrls', () => {
  it("finds the Pod the profile lists as pim:storage", async () => {
    const fetch = fakeFetch({ 'https://alice.example/profile/card':
      turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${POD}> .`) });
    assert.deepEqual(await discoverPodUrls(WEBID, fetch, { logger: quiet }), [POD]);
  });

  it('reads pim:storage itself when the library lookup finds nothing (strategy 2)', async () => {
    const fetch = fakeFetch({ 'https://alice.example/profile/card':
      turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${POD}> .`) });
    assert.deepEqual(await discoverPodUrls(WEBID, fetch, { logger: quiet, strategies: only(2) }), [POD]);
  });

  it('reads a JSON-LD profile (strategy 3), ignoring a storage value that is not a web address', async () => {
    const fetch = fakeFetch({ 'https://alice.example/profile/card': jsonld([
      { '@id': WEBID, 'http://www.w3.org/ns/pim/space#storage': [{ '@id': POD }] },
      { '@id': 'x', storage: 'javascript:alert(1)' },
    ]) });
    assert.deepEqual(await discoverPodUrls(WEBID, fetch, { logger: quiet, strategies: only(3) }), [POD]);
  });

  it('falls back to reading Turtle text when the JSON-LD request returns Turtle', async () => {
    const fetch = fakeFetch({ 'https://alice.example/profile/card':
      turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${POD}> .`) });
    assert.deepEqual(await discoverPodUrls(WEBID, fetch, { logger: quiet, strategies: only(3) }), [POD]);
  });

  it('follows the storageDescription link (strategy 4)', async () => {
    const desc = 'https://alice.example/.well-known/solid';
    const fetch = fakeFetch({
      'https://alice.example/profile/card': (init) => (init.method === 'HEAD'
        ? new Response(null, { headers: { link: `<${desc}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"` } })
        : new Response('', { status: 404 })),
      [desc]: jsonld({ 'http://www.w3.org/ns/solid/terms#storageSpace': { '@id': POD } }),
    });
    assert.deepEqual(await discoverPodUrls(WEBID, fetch, { logger: quiet, strategies: only(4) }), [POD]);
  });

  it("asks Inrupt's account service only for an Inrupt WebID (strategy 5)", async () => {
    const podList = 'https://login.inrupt.com/.account/pods';
    const routes = {
      'https://login.inrupt.com/.account/': () => Response.json({ controls: { account: { pod: podList } } }),
      [podList]: () => Response.json({ pods: { 'https://storage.inrupt.com/abc/': {} } }),
    };
    const inrupt = fakeFetch(routes);
    assert.deepEqual(await discoverPodUrls('https://id.inrupt.com/alice', inrupt, { logger: quiet, strategies: only(5) }),
      ['https://storage.inrupt.com/abc/']);

    const other = fakeFetch(routes);
    assert.deepEqual(await discoverPodUrls(WEBID, other, { logger: quiet, strategies: only(5) }), []);
    assert.equal(other.calls.length, 0, "a WebID elsewhere never sends its token to Inrupt");
  });

  it('stops at the first strategy that finds a Pod', async () => {
    const fetch = fakeFetch({ 'https://alice.example/profile/card':
      turtle(`<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${POD}> .`) });
    await discoverPodUrls(WEBID, fetch, { logger: quiet });
    assert.ok(fetch.calls.every((c) => c.method !== 'HEAD'), 'later strategies did not run');
  });

  it('returns no Pods, without throwing, when nothing can be found or fetched', async () => {
    const failing = async () => { throw new Error('network down'); };
    assert.deepEqual(await discoverPodUrls(WEBID, failing, { logger: quiet }), []);
    const empty = fakeFetch({ 'https://alice.example/profile/card': turtle(`<${WEBID}> <http://xmlns.com/foaf/0.1/name> "Alice" .`) });
    assert.deepEqual(await discoverPodUrls(WEBID, empty, { logger: quiet }), []);
  });
});
