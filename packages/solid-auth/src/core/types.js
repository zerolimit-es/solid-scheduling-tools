/**
 * @zerolimit/solid-auth — Type definitions (JSDoc)
 *
 * These are documentation-only types for editor autocompletion and
 * inline documentation. No runtime code.
 */

/**
 * @typedef {Object} SolidAuthStorage
 * @property {(key: string) => Promise<string|undefined>} get
 * @property {(key: string, value: string) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * @typedef {Object} SolidProvider
 * @property {string} name         — Display name (e.g. "Inrupt PodSpaces")
 * @property {string|null} url     — OIDC issuer URL, or null for self-hosted (user enters URL)
 * @property {string} [description] — Short description
 */

/**
 * @typedef {Object} SolidAuthConfig
 * @property {SolidAuthStorage} storage    — Session storage backend
 * @property {Map<string, Function>} [fetchMap] — In-memory map of webId → authenticated fetch
 * @property {string} [clientName]         — OIDC client name (default: "Solid App")
 * @property {Console} [logger]            — Logger instance (default: console)
 */

/**
 * @typedef {Object} AuthStatus
 * @property {boolean} isLoggedIn
 * @property {string} [webId]
 * @property {string} [sessionId]
 * @property {string[]} [pods]
 * @property {boolean} [mfaPending]
 * @property {boolean} [hasPasskeys]
 */

/**
 * @typedef {Object} LoginOptions
 * @property {string} oidcIssuer     — OIDC provider URL
 * @property {string} redirectUrl    — Callback URL after OIDC flow
 * @property {string} [clientName]   — OIDC client display name
 * @property {(url: string) => void} handleRedirect — Function to redirect the user
 */

/**
 * @typedef {Object} AuthRouterOptions
 * @property {import('./session-manager.js').SolidSessionManager} sessionManager
 * @property {string} baseUrl           — Backend base URL (e.g. "https://api.example.com")
 * @property {string} frontendUrl       — Frontend URL for redirects (e.g. "https://example.com")
 * @property {string} [clientName]      — OIDC client name (default: "Solid App")
 * @property {SolidProvider[]} [providers] — Custom provider list (uses defaults if omitted)
 * @property {string} [defaultIdp]      — Default OIDC issuer URL
 * @property {(req: any, ctx: CallbackContext) => Promise<CallbackResult|void>} [onCallback]
 * @property {(req: any, ctx: {oidcIssuer: string}) => Promise<void>} [onLogin]
 * @property {(req: any) => Promise<void>} [onLogout]
 */

/**
 * @typedef {Object} CallbackContext
 * @property {string} webId
 * @property {string[]} pods
 * @property {Function} authenticatedFetch
 */

/**
 * @typedef {Object} CallbackResult
 * @property {string} [redirectUrl]   — Override the default redirect URL
 * @property {boolean} [mfaPending]   — Flag MFA as pending
 */

/**
 * @typedef {Object} RequireAuthOptions
 * @property {(req: any) => boolean} [mfaCheck] — Optional MFA gate check
 * @property {string[]} [mfaAllowedPaths]       — Paths exempt from MFA gate
 */

/**
 * @typedef {Object} UseAuthConfig
 * @property {string} [apiBase]            — API base URL (default: "" for same-origin)
 * @property {string} [defaultProvider]    — Default OIDC provider URL
 * @property {SolidProvider[]} [fallbackProviders] — Fallback providers if API unreachable
 */

export {};
