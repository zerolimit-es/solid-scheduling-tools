/**
 * @zerolimit/solid-auth — Provider Registry
 *
 * Known Solid OIDC identity providers with working dynamic client
 * registration (/.oidc/reg). This list is maintained based on real-world
 * testing — providers that serve HTML instead of OIDC endpoints, that are
 * decommissioned, or that are down are excluded.
 */

/** @type {import('./types.js').SolidProvider[]} */
export const DEFAULT_PROVIDERS = [
  {
    name: 'Inrupt PodSpaces',
    url: 'https://login.inrupt.com',
    description: 'Managed Solid Pods by Inrupt (US/EU/APAC)',
  },
  {
    name: 'solidcommunity.net',
    url: 'https://solidcommunity.net',
    description: 'Community Solid server (UK)',
  },
  {
    name: 'solidweb.org',
    url: 'https://solidweb.org',
    description: 'Open Solid server (EU)',
  },
  {
    name: 'solidweb.me',
    url: 'https://solidweb.me',
    description: 'Solid hosting by Meisdata (EU)',
  },
  {
    name: 'teamid.live',
    url: 'https://teamid.live',
    description: 'Solid hosting by Meisdata (EU)',
  },
  {
    name: 'solidcommunity.au',
    url: 'https://pods.solidcommunity.au',
    description: 'Solid Community Australia',
  },
  {
    name: 'redpencil.io',
    url: 'https://solid.redpencil.io',
    description: 'Solid hosting by redpencil.io (EU)',
  },
  {
    name: 'Self-hosted',
    url: null,
    description: 'Enter your own IDP URL',
  },
];

/**
 * Default OIDC issuer used when none is specified.
 */
export const DEFAULT_IDP = 'https://login.inrupt.com';

/**
 * Merge custom providers with defaults.
 * Custom providers override defaults by URL match; extras are appended.
 *
 * @param {import('./types.js').SolidProvider[]} custom — App-specific providers
 * @param {import('./types.js').SolidProvider[]} [defaults=DEFAULT_PROVIDERS]
 * @returns {import('./types.js').SolidProvider[]}
 */
export function mergeProviders(custom = [], defaults = DEFAULT_PROVIDERS) {
  if (!custom.length) return [...defaults];

  const customUrls = new Set(custom.map(p => p.url));
  const merged = [...custom];

  for (const def of defaults) {
    if (!customUrls.has(def.url)) {
      merged.push(def);
    }
  }

  return merged;
}
