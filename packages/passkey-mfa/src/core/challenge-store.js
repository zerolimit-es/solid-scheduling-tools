/**
 * @zerolimit/passkey-mfa — Challenge Storage
 *
 * One-time challenge storage with TTL for WebAuthn registration and
 * authentication flows. Redis-backed with in-memory fallback.
 */

const DEFAULT_TTL = 300; // 5 minutes

/**
 * Create an in-memory challenge store.
 * @param {number} [ttl=300] — TTL in seconds
 * @returns {import('./types.js').ChallengeStore}
 */
export function createMemoryChallengeStore(ttl = DEFAULT_TTL) {
  const store = new Map();

  return {
    async store(userId, challenge) {
      store.set(userId, { challenge, expires: Date.now() + ttl * 1000 });
    },
    async get(userId) {
      const entry = store.get(userId);
      store.delete(userId); // One-time use
      if (entry && entry.expires > Date.now()) return entry.challenge;
      return null;
    },
  };
}

/**
 * Create a Redis-backed challenge store with in-memory fallback.
 * @param {Object} redisClient — ioredis client instance
 * @param {Object} [options]
 * @param {string} [options.prefix='passkey:challenge:']
 * @param {number} [options.ttl=300]
 * @returns {import('./types.js').ChallengeStore}
 */
export function createRedisChallengeStore(redisClient, options = {}) {
  const prefix = options.prefix ?? 'passkey:challenge:';
  const ttl = options.ttl ?? DEFAULT_TTL;
  const fallback = createMemoryChallengeStore(ttl);

  return {
    async store(userId, challenge) {
      const key = prefix + userId;
      try {
        if (redisClient) {
          await redisClient.set(key, challenge, 'EX', ttl);
          return;
        }
      } catch {}
      await fallback.store(userId, challenge);
    },
    async get(userId) {
      const key = prefix + userId;
      try {
        if (redisClient) {
          const val = await redisClient.get(key);
          if (val) await redisClient.del(key);
          return val;
        }
      } catch {}
      return fallback.get(userId);
    },
  };
}
