/**
 * @zerolimit/solid-auth — the identity provider's sign-out address.
 *
 * OpenID Connect providers that support RP-initiated logout publish an
 * `end_session_endpoint` in their discovery document
 * (`<issuer>/.well-known/openid-configuration`). There is no fixed path, so
 * the address is read from there; a provider that publishes none has no
 * sign-out page to send the user to.
 */

import { parseHttpUrl, stripTrailingSlashes } from './safe-url.js';

const DISCOVERY_TIMEOUT_MS = 5_000;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map(); // issuer -> { url, expires }

/**
 * @param {string} issuer
 * @param {{ fetch?: typeof globalThis.fetch, now?: () => number }} [options]
 * @returns {Promise<string|null>} The end-session URL, or null when the
 *   provider publishes none or its discovery document can't be read.
 */
export async function findEndSessionUrl(issuer, options = {}) {
  if (typeof issuer !== 'string' || !parseHttpUrl(issuer)) return null;
  const base = stripTrailingSlashes(issuer);
  const now = (options.now ?? Date.now)();
  const hit = cache.get(base);
  if (hit && hit.expires > now) return hit.url;

  let url = null;
  try {
    const doFetch = options.fetch ?? globalThis.fetch;
    const res = await doFetch(`${base}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (res.ok) {
      const config = await res.json();
      const endpoint = config?.end_session_endpoint;
      // Only an http(s) address is ever handed to the browser
      if (typeof endpoint === 'string' && parseHttpUrl(endpoint)) url = endpoint;
    }
  } catch {
    // Unreachable or not JSON: no sign-out page. Don't cache, so a provider
    // that was briefly down is tried again next time.
    return null;
  }
  if (cache.size > 100) cache.clear();
  cache.set(base, { url, expires: now + CACHE_MS });
  return url;
}

/** Forget cached addresses (tests). */
export function clearEndSessionCache() {
  cache.clear();
}
