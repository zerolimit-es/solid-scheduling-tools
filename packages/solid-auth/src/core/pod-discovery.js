/**
 * @zerolimit/solid-auth — Pod URL Discovery
 *
 * Discovers Solid Pod URLs from a WebID using a 5-strategy fallback chain.
 * Each strategy is wrapped in its own try/catch so a failure in one does
 * not prevent the others from running.
 *
 * Strategies (in order):
 *   1. getPodUrlAll()       — Standard pim:storage triple
 *   2. getSolidDataset()    — Read WebID profile directly for pim:storage
 *   3. JSON-LD / Turtle     — Fetch WebID as JSON-LD or parse Turtle
 *   4. storageDescription   — ESS 2.0+ Link header for storage description
 *   5. Inrupt account API   — Inrupt PodSpaces /.account/pod/ endpoint
 */

import { getPodUrlAll, getSolidDataset, getThing, getUrlAll } from '@inrupt/solid-client';

const PIM_STORAGE = 'http://www.w3.org/ns/pim/space#storage';

/**
 * Discover Pod URLs for a given WebID.
 *
 * @param {string} webId              — The user's WebID URL
 * @param {Function} authenticatedFetch — Authenticated fetch function from Solid session
 * @param {Object} [options]
 * @param {Console} [options.logger=console] — Logger for debug output
 * @param {boolean[]} [options.strategies]   — Enable/disable each strategy [1..5] (all true by default)
 * @returns {Promise<string[]>} — Array of discovered Pod URLs
 */
export async function discoverPodUrls(webId, authenticatedFetch, options = {}) {
  const logger = options.logger ?? console;
  const strategies = options.strategies ?? [true, true, true, true, true];
  const pods = [];

  // ── Strategy 1: Standard getPodUrlAll ─────────────────────────────────
  if (strategies[0] !== false && pods.length === 0) {
    try {
      const found = await getPodUrlAll(webId, { fetch: authenticatedFetch });
      if (found.length > 0) {
        pods.push(...found);
        logger.log('[SolidAuth] Strategy 1 (getPodUrlAll) found:', found[0]);
      }
    } catch (e) {
      logger.log('[SolidAuth] Strategy 1 (getPodUrlAll) failed:', e.message);
    }
  }

  // ── Strategy 2: Read WebID profile directly for pim:storage ───────────
  if (strategies[1] !== false && pods.length === 0) {
    logger.log('[SolidAuth] Trying strategy 2 (getSolidDataset)...');
    try {
      const dataset = await getSolidDataset(webId, { fetch: authenticatedFetch });
      const profile = getThing(dataset, webId);
      if (profile) {
        const allUrls = getUrlAll(profile, PIM_STORAGE);
        if (allUrls.length > 0) {
          pods.push(...allUrls);
          logger.log('[SolidAuth] Strategy 2 found pim:storage:', allUrls);
        } else {
          logger.log('[SolidAuth] Strategy 2: profile loaded but no pim:storage triple');
        }
      }
    } catch (profileErr) {
      logger.log('[SolidAuth] Strategy 2 failed:', profileErr.message);
    }
  }

  // ── Strategy 3: Fetch WebID as JSON-LD / Turtle ───────────────────────
  if (strategies[2] !== false && pods.length === 0) {
    logger.log('[SolidAuth] Trying strategy 3 (JSON-LD fetch)...');
    try {
      const profileRes = await authenticatedFetch(webId, {
        headers: { Accept: 'application/ld+json' },
      });
      if (profileRes.ok) {
        const text = await profileRes.text();
        try {
          const jsonLd = JSON.parse(text);
          const entries = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
          for (const entry of entries) {
            const storage =
              entry['http://www.w3.org/ns/pim/space#storage'] ||
              entry['pim:storage'] ||
              entry['storage'];
            if (storage) {
              const url =
                typeof storage === 'string'
                  ? storage
                  : Array.isArray(storage)
                    ? storage[0]?.['@id'] || storage[0]
                    : storage['@id'] || storage;
              if (typeof url === 'string' && url.startsWith('http')) {
                pods.push(url);
                logger.log('[SolidAuth] Strategy 3 found storage:', url);
              }
            }
          }
        } catch (_parseErr) {
          // Response wasn't JSON — try Turtle/N3 format
          const storageMatch = text.match(/space#storage>\s*<([^>]+)>/);
          if (storageMatch) {
            pods.push(storageMatch[1]);
            logger.log('[SolidAuth] Strategy 3 found storage in Turtle:', storageMatch[1]);
          }
        }
      }
    } catch (fetchErr) {
      logger.log('[SolidAuth] Strategy 3 failed:', fetchErr.message);
    }
  }

  // ── Strategy 4: storageDescription Link header (ESS 2.0+) ────────────
  if (strategies[3] !== false && pods.length === 0) {
    logger.log('[SolidAuth] Trying strategy 4 (storageDescription Link header)...');
    try {
      const headRes = await authenticatedFetch(webId, { method: 'HEAD' });
      const linkHeader = headRes.headers.get('link') || '';
      const storageDescMatch = linkHeader.match(
        /<([^>]+)>;\s*rel="http:\/\/www\.w3\.org\/ns\/solid\/terms#storageDescription"/
      );
      if (storageDescMatch) {
        const descUrl = storageDescMatch[1];
        logger.log('[SolidAuth] Strategy 4 found storageDescription URL:', descUrl);
        const descRes = await authenticatedFetch(descUrl, {
          headers: { Accept: 'application/ld+json' },
        });
        if (descRes.ok) {
          const descText = await descRes.text();
          try {
            const descJson = JSON.parse(descText);
            const entries = Array.isArray(descJson) ? descJson : [descJson];
            for (const entry of entries) {
              const storage =
                entry['http://www.w3.org/ns/solid/terms#storageSpace'] ||
                entry['http://www.w3.org/ns/pim/space#storage'];
              if (storage) {
                const url =
                  typeof storage === 'string'
                    ? storage
                    : Array.isArray(storage)
                      ? storage[0]?.['@id'] || storage[0]
                      : storage['@id'] || storage;
                if (typeof url === 'string' && url.startsWith('http')) {
                  pods.push(url);
                  logger.log('[SolidAuth] Strategy 4 found storage:', url);
                  break;
                }
              }
            }
          } catch (parseErr) {
            logger.log('[SolidAuth] Strategy 4: could not parse storageDescription:', parseErr.message);
          }
        }
      } else {
        logger.log('[SolidAuth] Strategy 4: no storageDescription Link header found');
      }
    } catch (linkErr) {
      logger.log('[SolidAuth] Strategy 4 failed:', linkErr.message);
    }
  }

  // ── Strategy 5: Inrupt PodSpaces account API ──────────────────────────
  if (strategies[4] !== false && pods.length === 0 && webId.includes('inrupt.com')) {
    logger.log('[SolidAuth] Trying strategy 5 (Inrupt /account/ endpoint)...');
    try {
      const accountRes = await authenticatedFetch('https://login.inrupt.com/.account/', {
        headers: { Accept: 'application/json' },
      });
      if (accountRes.ok) {
        const accountData = await accountRes.json();
        const podResource = accountData?.controls?.account?.pod;
        if (podResource) {
          const podListRes = await authenticatedFetch(podResource, {
            headers: { Accept: 'application/json' },
          });
          if (podListRes.ok) {
            const podList = await podListRes.json();
            const podUrls = Object.keys(podList?.pods || {});
            if (podUrls.length > 0) {
              pods.push(...podUrls);
              logger.log('[SolidAuth] Strategy 5 found pods:', podUrls);
            }
          }
        }
      } else {
        logger.log('[SolidAuth] Strategy 5: account endpoint returned', accountRes.status);
      }
    } catch (accountErr) {
      logger.log('[SolidAuth] Strategy 5 failed:', accountErr.message);
    }
  }

  if (pods.length === 0) {
    logger.log('[SolidAuth] Pod URL resolved: NONE — all strategies failed');
  } else {
    logger.log('[SolidAuth] Pod URL resolved:', pods[0]);
  }

  return pods;
}
