/**
 * @zerolimit/solid-auth — Session Manager
 *
 * Wraps @inrupt/solid-client-authn-node to provide a clean API for
 * Solid OIDC session lifecycle: create, restore, login, callback,
 * logout, and authenticated fetch retrieval.
 *
 * Framework-agnostic — no Express or HTTP dependency.
 */

import {
  Session,
  getSessionFromStorage,
  getSessionIdFromStorageAll,
} from '@inrupt/solid-client-authn-node';

export class SolidSessionManager {
  /**
   * @param {Object} config
   * @param {import('./types.js').SolidAuthStorage} config.storage — Session storage backend
   * @param {Map<string, Function>} [config.fetchMap] — In-memory map of webId → authenticated fetch
   * @param {string} [config.clientName='Solid App'] — Default OIDC client name
   * @param {Console} [config.logger=console]
   */
  constructor(config) {
    this.storage = config.storage;
    this.fetchMap = config.fetchMap ?? new Map();
    this.clientName = config.clientName ?? 'Solid App';
    this.logger = config.logger ?? console;
  }

  /**
   * Retrieve an existing session from storage, or create a new one.
   *
   * @param {string} [sessionId]
   * @returns {Promise<Session>}
   */
  async getSession(sessionId) {
    if (sessionId) {
      const session = await getSessionFromStorage(sessionId, this.storage);
      if (session) return session;
    }
    return new Session({ storage: this.storage });
  }

  /**
   * Create a brand-new session, discarding any previous OIDC state.
   * Must be called before each login attempt so the Inrupt library does
   * a fresh dynamic client registration with the chosen provider.
   *
   * @returns {Session}
   */
  createFreshSession() {
    return new Session({ storage: this.storage });
  }

  /**
   * Initiate the OIDC login flow.
   *
   * @param {Session} session
   * @param {import('./types.js').LoginOptions} options
   */
  async startLogin(session, options) {
    await session.login({
      oidcIssuer: options.oidcIssuer,
      redirectUrl: options.redirectUrl,
      clientName: options.clientName || this.clientName,
      handleRedirect: options.handleRedirect,
    });
  }

  /**
   * Handle the OIDC callback after the identity provider redirects back.
   *
   * @param {Session} session
   * @param {string} url — Full callback URL including query parameters
   * @returns {Promise<{isLoggedIn: boolean, webId?: string, sessionId?: string}>}
   */
  async handleCallback(session, url) {
    await session.handleIncomingRedirect(url);
    return session.info;
  }

  /**
   * Logout and clean up session storage.
   *
   * @param {Session} session
   */
  async logout(session) {
    const webId = session.info.webId;
    if (session.info.isLoggedIn) {
      await session.logout();
    }
    if (session.info.sessionId) {
      await this.storage.delete(session.info.sessionId);
    }
    // Clean up fetchMap
    if (webId) {
      this.fetchMap.delete(webId);
    }
  }

  /**
   * Get an authenticated fetch function for Pod operations.
   * Tries multiple sources in priority order:
   *   1. Live session (session.fetch)
   *   2. In-memory fetchMap (stored during login callback)
   *   3. Restoration from storage (Redis/DB)
   *
   * @param {Session} [session]
   * @param {string} [webId]
   * @returns {Promise<Function>} — Authenticated fetch function
   * @throws {Error} if no authenticated session is found
   */
  async getAuthenticatedFetch(session, webId) {
    // 1. Live session
    if (session?.info?.isLoggedIn) {
      return session.fetch;
    }

    // 2. In-memory fetchMap
    const wid = webId || session?.info?.webId;
    if (wid && this.fetchMap.has(wid)) {
      return this.fetchMap.get(wid);
    }

    // 3. Attempt restoration from storage
    if (wid) {
      try {
        const allIds = await getSessionIdFromStorageAll(this.storage);
        for (const sid of allIds) {
          const restored = await getSessionFromStorage(sid, this.storage);
          if (restored?.info?.isLoggedIn && restored.info.webId === wid) {
            this.fetchMap.set(wid, restored.fetch);
            this.logger.log('[SolidAuth] Restored session for', wid);
            return restored.fetch;
          }
        }
      } catch (err) {
        this.logger.warn('[SolidAuth] Session restoration failed:', err.message);
      }
    }

    throw new Error('Session not authenticated');
  }

  /**
   * List all active sessions in storage.
   *
   * @returns {Promise<Array<{id: string, webId: string, isLoggedIn: boolean}>>}
   */
  async getAllSessions() {
    const sessionIds = await getSessionIdFromStorageAll(this.storage);
    const sessions = [];
    for (const id of sessionIds) {
      const session = await getSessionFromStorage(id, this.storage);
      if (session) {
        sessions.push({
          id: session.info.sessionId,
          webId: session.info.webId,
          isLoggedIn: session.info.isLoggedIn,
        });
      }
    }
    return sessions;
  }

  /**
   * Populate the fetchMap from a session (e.g. after restoring from storage).
   * Called internally by the Express middleware when a session is restored.
   *
   * @param {Session} session
   */
  populateFetchMap(session) {
    if (session.info.isLoggedIn && session.info.webId && !this.fetchMap.has(session.info.webId)) {
      this.fetchMap.set(session.info.webId, session.fetch);
      this.logger.log('[SolidAuth] Restored fetch for', session.info.webId);
    }
  }
}
