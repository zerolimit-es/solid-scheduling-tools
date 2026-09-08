/**
 * @zerolimit/solid-pod-sync/core — Type Definitions
 */

/**
 * @typedef {Object} PodPaths
 * @property {string} schedulerPath  — Container name under Pod root (default: 'proton-scheduler')
 * @property {string} availabilityFile — Filename for availability TTL (default: 'availability.ttl')
 * @property {string} bookingsContainer — Sub-container for bookings (default: 'bookings')
 * @property {string} publicProfile — Filename for public profile TTL (default: 'public-profile.ttl')
 */

/**
 * @typedef {Object} SyncStore
 * @property {() => Array} getUnsynced — Return bookings not yet synced to Pod
 * @property {(id: string, podUrl: string) => void} markSynced — Mark a booking as synced
 */

/**
 * @typedef {Object} SyncRouterOptions
 * @property {(req: import('express').Request) => string|null} getPodUrl — Extract Pod URL from request
 * @property {(req: import('express').Request) => Function|null} getAuthenticatedFetch — Get Solid auth fetch
 * @property {SyncStore} [syncStore] — Injectable store for unsynced bookings
 * @property {(req: import('express').Request) => string} [getTimezone] — Get organizer timezone
 * @property {Partial<PodPaths>} [podPaths] — Path overrides
 * @property {Console} [logger] — Logger (default: console)
 * @property {false|Object|Function} [rateLimit] — Rate limiting for the sync endpoints:
 *   `false` disables, an object tunes express-rate-limit options, a function supplies
 *   custom middleware (default: 60 req / min per IP)
 */

export {};
