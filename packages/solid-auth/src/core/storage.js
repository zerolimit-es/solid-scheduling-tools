/**
 * @zerolimit/solid-auth — Storage Adapters
 *
 * Provides pluggable storage backends for Solid OIDC session data.
 * All adapters implement the SolidAuthStorage interface:
 *   { get(key), set(key, value), delete(key) }
 *
 * The Inrupt SDK stores serialised session state (client registration,
 * tokens, DPoP keys) as string values keyed by session ID.
 */

// ── In-Memory Storage ───────────────────────────────────────────────────────

/**
 * Simple in-memory storage backed by a Map.
 * Data is lost on process restart.
 *
 * @returns {import('./types.js').SolidAuthStorage}
 */
export function createMemoryStorage() {
  const store = new Map();
  return {
    get: async (key) => store.get(key) || undefined,
    set: async (key, value) => { store.set(key, value); },
    delete: async (key) => { store.delete(key); },
  };
}

// ── Redis Storage ───────────────────────────────────────────────────────────

/**
 * Redis-backed storage with configurable key prefix and TTL.
 * Requires an ioredis client instance.
 *
 * @param {import('ioredis').Redis} redisClient — Connected ioredis client
 * @param {Object} [opts]
 * @param {string} [opts.prefix='solid:session:'] — Redis key prefix
 * @param {number} [opts.ttl=86400]               — TTL in seconds (default: 24 hours)
 * @param {Console} [opts.logger=console]
 * @returns {import('./types.js').SolidAuthStorage}
 */
export function createRedisStorage(redisClient, opts = {}) {
  const prefix = opts.prefix ?? 'solid:session:';
  const ttl = opts.ttl ?? 86400;
  const logger = opts.logger ?? console;

  return {
    get: async (key) => {
      try {
        const value = await redisClient.get(prefix + key);
        return value !== null ? value : undefined;
      } catch (err) {
        logger.warn('[SolidAuth:Redis] get error:', err.message);
        return undefined;
      }
    },
    set: async (key, value) => {
      try {
        await redisClient.set(prefix + key, value, 'EX', ttl);
      } catch (err) {
        logger.warn('[SolidAuth:Redis] set error:', err.message);
      }
    },
    delete: async (key) => {
      try {
        await redisClient.del(prefix + key);
      } catch (err) {
        logger.warn('[SolidAuth:Redis] delete error:', err.message);
      }
    },
  };
}

// ── Hybrid Storage (write-through) ──────────────────────────────────────────

/**
 * Write-through hybrid storage: writes to both layers, reads from primary
 * first (fast cache) then falls back to secondary (durable store).
 *
 * Typical usage: createHybridStorage(createRedisStorage(redis), createMemoryStorage())
 * — Redis is the durable primary, in-memory is the fast fallback.
 *
 * Or reversed: createHybridStorage(createMemoryStorage(), createRedisStorage(redis))
 * — In-memory is the fast primary, Redis is the durable fallback.
 *
 * @param {import('./types.js').SolidAuthStorage} primary
 * @param {import('./types.js').SolidAuthStorage} fallback
 * @returns {import('./types.js').SolidAuthStorage}
 */
export function createHybridStorage(primary, fallback) {
  return {
    get: async (key) => {
      const value = await primary.get(key);
      if (value !== undefined) {
        // Populate fallback for fast reads next time
        await fallback.set(key, value).catch(() => {});
        return value;
      }
      return fallback.get(key);
    },
    set: async (key, value) => {
      await Promise.all([
        primary.set(key, value),
        fallback.set(key, value),
      ]);
    },
    delete: async (key) => {
      await Promise.all([
        primary.delete(key),
        fallback.delete(key),
      ]);
    },
  };
}
