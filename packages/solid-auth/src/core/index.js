/**
 * @zerolimit/solid-auth/core
 *
 * Framework-agnostic Solid OIDC authentication primitives.
 */

export { SolidSessionManager } from './session-manager.js';
export { discoverPodUrls } from './pod-discovery.js';
export { DEFAULT_PROVIDERS, DEFAULT_IDP, mergeProviders } from './providers.js';
export { createMemoryStorage, createRedisStorage, createHybridStorage } from './storage.js';
