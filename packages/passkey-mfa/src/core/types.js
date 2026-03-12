/**
 * @zerolimit/passkey-mfa — Type definitions (JSDoc)
 */

/**
 * @typedef {Object} ChallengeStore
 * @property {(userId: string, challenge: string) => Promise<void>} store
 * @property {(userId: string) => Promise<string|null>} get
 */

/**
 * @typedef {Object} CredentialStore
 * @property {(userId: string) => Promise<PasskeyRecord[]>} getByUser
 * @property {(credentialId: string) => Promise<PasskeyRecord|null>} getByCredentialId
 * @property {(record: PasskeyRecord) => Promise<void>} save
 * @property {(id: string, userId: string) => Promise<boolean>} remove
 * @property {(credentialId: string, counter: number) => Promise<void>} updateCounter
 */

/**
 * @typedef {Object} PasskeyRecord
 * @property {string} id
 * @property {string} userId
 * @property {string} credentialId
 * @property {Uint8Array|Buffer} publicKey
 * @property {number} counter
 * @property {string} [transports] — JSON array of transports
 * @property {string} [deviceName]
 * @property {string} [createdAt]
 * @property {string} [lastUsedAt]
 */

/**
 * @typedef {Object} PasskeyRouterOptions
 * @property {ChallengeStore} challengeStore
 * @property {CredentialStore} credentialStore
 * @property {string} rpName — Relying party display name
 * @property {string} rpId — Relying party ID (domain)
 * @property {string} origin — Expected origin for verification
 * @property {(req: any) => string|null} getUserId — Extract user ID from request
 * @property {(req: any) => string|null} getWebId — Extract WebID from request
 */

export {};
