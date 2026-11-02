/**
 * @zerolimit/solid-auth/core
 *
 * Framework-agnostic Solid OIDC authentication primitives.
 */

export { SolidSessionManager } from './session-manager.js';
export { discoverPodUrls } from './pod-discovery.js';
export {
  verifyWebIdIssuer,
  getTrustedIssuers,
  normalizeIssuer,
  SOLID_OIDC_ISSUER,
} from './webid-issuer.js';
export { DEFAULT_PROVIDERS, DEFAULT_IDP, mergeProviders } from './providers.js';
export { createMemoryStorage, createRedisStorage, createHybridStorage } from './storage.js';
export {
  parseHttpUrl,
  resolveAllowedRedirect,
  appendQueryParams,
  sanitizeForLog,
  redactUrlForLog,
} from './safe-url.js';
