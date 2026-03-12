/**
 * @zerolimit/solid-auth/express — Middleware
 *
 * Express middleware for Solid OIDC session management and auth guards.
 */

/**
 * Express middleware that attaches `req.solidSession` and `req.user`
 * on every request by restoring the Solid session from storage.
 *
 * @param {import('../core/session-manager.js').SolidSessionManager} sessionManager
 * @returns {import('express').RequestHandler}
 */
export function solidSessionMiddleware(sessionManager) {
  return async (req, _res, next) => {
    try {
      const sessionId = req.session?.solidSessionId;
      const session = await sessionManager.getSession(sessionId);

      if (session.info.sessionId && !req.session.solidSessionId) {
        req.session.solidSessionId = session.info.sessionId;
      }

      req.solidSession = session;

      if (session.info.isLoggedIn) {
        req.user = {
          webId: session.info.webId,
          sessionId: session.info.sessionId,
        };
        // Re-populate fetchMap if session was restored from storage
        sessionManager.populateFetchMap(session);
      }

      next();
    } catch (error) {
      console.error('[SolidAuth] Session middleware error:', error);
      next(error);
    }
  };
}

/**
 * Express middleware that blocks unauthenticated requests.
 * Checks both the live Solid session and the cookie-based session fallback.
 *
 * @param {import('../core/types.js').RequireAuthOptions} [options]
 * @returns {import('express').RequestHandler}
 */
export function requireAuth(options = {}) {
  return (req, res, next) => {
    const solidLoggedIn = req.solidSession?.info?.isLoggedIn;
    const cookieLoggedIn = !!req.session?.webId;

    if (!solidLoggedIn && !cookieLoggedIn) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Please log in to access this resource',
      });
    }

    // Optional MFA gate (e.g. passkey verification)
    if (options.mfaCheck && options.mfaCheck(req)) {
      const path = req.originalUrl || req.path;
      const allowedPaths = options.mfaAllowedPaths || [];
      const isAllowed = allowedPaths.some(p => path.startsWith(p));
      if (!isAllowed) {
        return res.status(403).json({
          error: 'MFA required',
          message: 'Please complete multi-factor authentication',
        });
      }
    }

    // Populate req.user if not already set by middleware
    if (!req.user) {
      const podUrl = req.session?.podUrl || req.tenant?.solid_pod_url || null;
      req.user = {
        webId: req.solidSession?.info?.webId || req.session?.webId,
        pods: podUrl ? [podUrl] : [],
      };
    }

    next();
  };
}
