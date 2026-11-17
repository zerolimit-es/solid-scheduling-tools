import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { saveBooking, loadBookings, saveAvailability, loadAvailability, getSchedulerPaths } from '../src/core/solid.js';

const POD = 'https://pod.example/alice/';
const PATHS = getSchedulerPaths(POD);
const AVAILABILITY = PATHS.availability;

/**
 * An in-memory Pod: stores Turtle by URL and lists containers. Updates to an
 * existing file arrive as PATCH (SPARQL Update); it records them and, for
 * these tests, applies an availability update by keeping the inserted name.
 */
function fakePod() {
  const files = new Map();
  const pod = { files, requests: [], failWrites: null, inFlight: 0, maxInFlight: 0 };
  const respond = (url, body, init) => {
    const res = new Response(body, init);
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };

  pod.fetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input.url).split('#')[0];
    const method = (init.method || 'GET').toUpperCase();
    pod.requests.push({ method, url });

    if (method === 'GET' || method === 'HEAD') {
      pod.inFlight++;
      pod.maxInFlight = Math.max(pod.maxInFlight, pod.inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      pod.inFlight--;
      if (url.endsWith('/')) {
        const children = [...files.keys()].filter((k) => k.startsWith(url) && !k.slice(url.length).includes('/'));
        const contains = children.map((c) => `<${url}> <http://www.w3.org/ns/ldp#contains> <${c}> .`).join('\n');
        return respond(url, `<${url}> a <http://www.w3.org/ns/ldp#Container> .\n${contains}`,
          { status: 200, headers: { 'Content-Type': 'text/turtle' } });
      }
      return files.has(url)
        ? respond(url, files.get(url), { status: 200, headers: { 'Content-Type': 'text/turtle' } })
        : respond(url, 'Not found', { status: 404 });
    }

    if (url.endsWith('/')) return respond(url, null, { status: 201 });
    if (pod.failWrites) return respond(url, 'Nope', { status: pod.failWrites });

    if (method === 'PUT') files.set(url, String(init.body));
    if (method === 'DELETE') files.delete(url);
    if (method === 'PATCH') pod.lastPatch = String(init.body);
    return respond(url, null, { status: 205 });
  };
  return pod;
}

const booking = (n) => ({
  id: `booking-${String(n).padStart(2, '0')}`,
  title: `Meeting ${n}`,
  start: new Date(Date.UTC(2030, 0, 1 + n, 9)),
  end: new Date(Date.UTC(2030, 0, 1 + n, 10)),
  organizer: { name: 'Alice', email: 'alice@example.com' },
  attendee: { name: 'Bo', email: 'bo@example.com' },
});

describe('loadBookings', () => {
  it('reads many bookings a few at a time, and returns them all in start order', async () => {
    const pod = fakePod();
    for (let n = 20; n >= 1; n--) await saveBooking(POD, booking(n), pod.fetch);
    pod.maxInFlight = 0;

    const bookings = await loadBookings(POD, pod.fetch);
    assert.equal(bookings.length, 20);
    assert.deepEqual(bookings.map((b) => b.id), Array.from({ length: 20 }, (_, i) => booking(i + 1).id));
    assert.ok(pod.maxInFlight > 1, 'reads overlap');
    assert.ok(pod.maxInFlight <= 8, `at most 8 at once (saw ${pod.maxInFlight})`);
  });

  it('skips a booking that cannot be read without losing the others', async () => {
    const pod = fakePod();
    for (let n = 1; n <= 3; n++) await saveBooking(POD, booking(n), pod.fetch);
    pod.files.set(`${PATHS.bookings}booking-02.ttl`, 'this is not turtle <<<');

    const bookings = await loadBookings(POD, pod.fetch);
    assert.deepEqual(bookings.map((b) => b.id), ['booking-01', 'booking-03']);
  });

  it('returns nothing for a Pod with no bookings', async () => {
    assert.deepEqual(await loadBookings(POD, fakePod().fetch), []);
  });
});

describe('saveAvailability', () => {
  const settings = (name) => ({
    eventDuration: 30, timezone: 'Europe/Paris', name, email: 'alice@example.com',
    days: { monday: { enabled: true, start: '09:00', end: '17:00' } },
  });

  it('creates the file the first time', async () => {
    const pod = fakePod();
    await saveAvailability(POD, settings('Alice'), pod.fetch);
    assert.ok(pod.files.has(AVAILABILITY));
    assert.equal((await loadAvailability(POD, pod.fetch)).name, 'Alice');
  });

  it('updates an existing file in place, without deleting it first', async () => {
    const pod = fakePod();
    await saveAvailability(POD, settings('Alice'), pod.fetch);
    pod.requests.length = 0;

    await saveAvailability(POD, settings('Alice B'), pod.fetch);
    const writes = pod.requests.filter((r) => r.url === AVAILABILITY && !['GET', 'HEAD'].includes(r.method));
    assert.deepEqual(writes.map((w) => w.method), ['PATCH']);
    assert.match(pod.lastPatch, /Alice B/);
    assert.ok(pod.files.has(AVAILABILITY));
  });

  it('keeps the previous settings in the Pod when the save fails', async () => {
    const pod = fakePod();
    await saveAvailability(POD, settings('Alice'), pod.fetch);
    pod.failWrites = 500;

    await assert.rejects(saveAvailability(POD, settings('Alice B'), pod.fetch));
    pod.failWrites = null;
    assert.equal((await loadAvailability(POD, pod.fetch)).name, 'Alice');
  });

  it('replaces the file on a Pod that cannot update in place', async () => {
    const pod = fakePod();
    await saveAvailability(POD, settings('Alice'), pod.fetch);
    const plainFetch = pod.fetch;
    // This Pod answers 405 to PATCH but accepts PUT and DELETE
    const noPatch = async (input, init = {}) => {
      if ((init.method || 'GET').toUpperCase() === 'PATCH') {
        const res = new Response('Method not allowed', { status: 405 });
        Object.defineProperty(res, 'url', { value: String(input) });
        return res;
      }
      return plainFetch(input, init);
    };

    await saveAvailability(POD, settings('Alice B'), noPatch);
    assert.equal((await loadAvailability(POD, pod.fetch)).name, 'Alice B');
  });
});
