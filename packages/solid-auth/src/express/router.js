/**
 * @zerolimit/solid-auth/express — Auth Router
 *
 * Factory function that creates an Express Router with all Solid OIDC
 * endpoints: login, callback, status, logout, providers, and pod-url.
 *
 * App-specific logic is injected via lifecycle hooks (onLogin, onCallback,
 * onLogout) so the router stays generic.
 */

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { discoverPodUrls } from '../core/pod-discovery.js';
import { DEFAULT_PROVIDERS, DEFAULT_IDP } from '../core/providers.js';
import {
  parseHttpUrl,
  resolveAllowedRedirect,
  appendQueryParams,
  sanitizeForLog,
  redactUrlForLog,
} from '../core/safe-url.js';

/** Default limits for the login, callback, logout and pod-url endpoints. */
const DEFAULT_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Please try again later.' },
};

/**
 * Create an Express Router with Solid OIDC authentication endpoints.
 *
 * @param {import('../core/types.js').AuthRouterOptions} options
 * @returns {import('express').Router}
 */
export function createAuthRouter(options) {
  const {
    sessionManager,
    baseUrl,
    frontendUrl,
    clientName,
    providers: customProviders,
    defaultIdp = DEFAULT_IDP,
    onLogin,
    onCallback,
    onLogout,
  } = options;

  const logger = options.logger ?? console;
  const providers = customProviders ?? DEFAULT_PROVIDERS;
  const router = Router();

  // Rate limiting (express-rate-limit). Pass `rateLimit: false` to disable
  // (e.g. when the app mounts its own limiter), an options object to tune the
  // defaults, or a middleware function to supply a custom limiter.
  const limiter =
    options.rateLimit === false
      ? (_req, _res, next) => next()
      : typeof options.rateLimit === 'function'
        ? options.rateLimit
        : rateLimit({ ...DEFAULT_RATE_LIMIT, ...(options.rateLimit ?? {}) });

  // Origins that `returnTo` may point at. The frontend origin is always
  // allowed; apps can add more via options.allowedReturnOrigins.
  const allowedReturnOrigins = [frontendUrl, ...(options.allowedReturnOrigins ?? [])];

  /** Validate a user-supplied returnTo; null if it is off-origin or malformed. */
  const resolveReturnTo = (candidate) => resolveAllowedRedirect(candidate, allowedReturnOrigins);

  // ── GET /login ──────────────────────────────────────────────────────────
  router.get('/login', limiter, async (req, res) => {
    try {
      const { oidcIssuer, returnTo } = req.query;

      // Only accept returnTo targets on an allowed origin (open-redirect guard)
      const safeReturnTo = resolveReturnTo(returnTo);
      if (returnTo && !safeReturnTo) {
        logger.warn('[SolidAuth] Ignoring returnTo outside allowed origins:', sanitizeForLog(returnTo));
      }
      if (safeReturnTo) {
        req.session.returnTo = safeReturnTo;
      }

      // The issuer must be an http(s) URL — reject arrays, other schemes, garbage
      const issuer = oidcIssuer || defaultIdp;
      if (!parseHttpUrl(issuer)) {
        logger.warn('[SolidAuth] Rejected invalid oidcIssuer:', sanitizeForLog(issuer));
        return res.redirect(
          appendQueryParams(safeReturnTo || frontendUrl, {
            login: 'error',
            message: 'Invalid identity provider URL.',
          })
        );
      }
      req.session.oidcIssuer = issuer;

      // Hook: before login
      if (onLogin) {
        await onLogin(req, { oidcIssuer: issuer });
      }

      // Always create a fresh session to avoid stale OIDC client registration
      const freshSession = sessionManager.createFreshSession();
      req.solidSession = freshSession;
      req.session.solidSessionId = freshSession.info.sessionId;

      const redirectUrl = `${baseUrl}/api/auth/callback`;
      await sessionManager.startLogin(freshSession, {
        oidcIssuer: issuer,
        redirectUrl,
        clientName,
        handleRedirect: (url) => res.redirect(url),
      });
    } catch (error) {
      logger.error('[SolidAuth] Login error:', error);
      const returnTo = req.session.returnTo || frontendUrl;
      res.redirect(
        appendQueryParams(returnTo, {
          login: 'error',
          message: 'This provider could not be reached. Try a different one.',
        })
      );
    }
  });

  // ── GET /callback ───────────────────────────────────────────────────────
  router.get('/callback', limiter, async (req, res) => {
    try {
      const fullUrl = `${baseUrl}${req.originalUrl}`;
      // Never log the raw callback URL: it carries the OIDC authorization code
      logger.log('[SolidAuth] CALLBACK url:', redactUrlForLog(fullUrl));

      const sessionInfo = await sessionManager.handleCallback(req.solidSession, fullUrl);
      logger.log('[SolidAuth] CALLBACK sessionInfo:', JSON.stringify(sessionInfo));

      if (sessionInfo.isLoggedIn) {
        req.session.solidSessionId = sessionInfo.sessionId;
        // Clear stale tenantId so downstream middleware resolves correctly
        delete req.session.tenantId;
        req.session.webId = sessionInfo.webId;

        // Store authenticated fetch in the map
        sessionManager.fetchMap.set(sessionInfo.webId, req.solidSession.fetch);

        // Discover Pod URLs
        let pods = [];
        try {
          pods = await discoverPodUrls(sessionInfo.webId, req.solidSession.fetch, { logger });
        } catch (e) {
          logger.warn('[SolidAuth] Pod discovery error:', e.message);
        }

        req.session.podUrl = pods[0] || null;
        logger.log('[SolidAuth] Pod URL resolved:', pods[0] || 'NONE');

        // Hook: after callback (app-specific logic: DB updates, MFA, sync)
        let hookResult = null;
        if (onCallback) {
          try {
            hookResult = await onCallback(req, {
              webId: sessionInfo.webId,
              pods,
              authenticatedFetch: req.solidSession.fetch,
            });
          } catch (hookErr) {
            logger.error('[SolidAuth] onCallback hook error:', hookErr.message);
          }
        }

        // Check if hook wants to override redirect or flag MFA
        if (hookResult?.mfaPending) {
          req.session.mfaPending = true;
        }

        // Re-validate the stored returnTo so a stale/tampered session value
        // can never redirect off the allowed origins
        const returnTo =
          hookResult?.redirectUrl || resolveReturnTo(req.session.returnTo) || frontendUrl;
        delete req.session.returnTo;

        if (req.session.mfaPending) {
          return res.redirect(appendQueryParams(returnTo, { login: 'mfa-required' }));
        }

        res.redirect(appendQueryParams(returnTo, { login: 'success' }));
      } else {
        logger.warn('[SolidAuth] CALLBACK: isLoggedIn=false — session may not have been restored.',
          'solidSessionId:', req.session?.solidSessionId || 'NONE',
          'sessionInfo:', JSON.stringify(sessionInfo));
        res.redirect(
          appendQueryParams(frontendUrl, {
            login: 'failed',
            message: 'Identity provider did not complete authentication. Please try again.',
          })
        );
      }
    } catch (error) {
      logger.error('[SolidAuth] Callback error:', error);
      res.redirect(appendQueryParams(frontendUrl, { login: 'error', message: error.message }));
    }
  });

  // ── GET /status ─────────────────────────────────────────────────────────
  router.get('/status', async (req, res) => {
    try {
      const session = req.solidSession;
      const isLoggedIn = session?.info?.isLoggedIn || !!req.session?.webId;

      if (!isLoggedIn) {
        return res.json({
          isLoggedIn: false,
          loginUrl: `${baseUrl}/api/auth/login`,
        });
      }

      const webId = session?.info?.webId || req.session?.webId;
      let pods = [];

      // Try to resolve Pod URLs from various sources
      try {
        let fetchFn = globalThis.fetch;
        if (session?.info?.isLoggedIn) {
          fetchFn = session.fetch;
        } else if (webId && sessionManager.fetchMap.has(webId)) {
          fetchFn = sessionManager.fetchMap.get(webId);
        }

        const { getPodUrlAll } = await import('@inrupt/solid-client');
        pods = await getPodUrlAll(webId, { fetch: fetchFn });
      } catch (err) {
        logger.warn('[SolidAuth] getUserPods failed:', err.message);
      }

      // Fallback chain for Pod URL
      if (pods.length === 0 && req.session?.podUrl) {
        pods = [req.session.podUrl];
      }
      if (pods.length === 0 && req.tenant?.solid_pod_url) {
        pods = [req.tenant.solid_pod_url];
      }

      const response = {
        isLoggedIn: true,
        webId,
        sessionId: session?.info?.sessionId || req.session?.solidSessionId,
        pods,
        mfaPending: !!req.session?.mfaPending,
      };

      // Let the app add extra fields (e.g. hasPasskeys)
      if (options.onStatus) {
        try {
          const extra = await options.onStatus(req, response);
          if (extra && typeof extra === 'object') {
            Object.assign(response, extra);
          }
        } catch {}
      }

      res.json(response);
    } catch (error) {
      logger.error('[SolidAuth] Status error:', error);
      res.status(500).json({ error: 'Failed to get auth status', message: error.message });
    }
  });

  // ── PUT /pod-url ────────────────────────────────────────────────────────
  router.put('/pod-url', limiter, async (req, res) => {
    try {
      const webId = req.solidSession?.info?.webId || req.session?.webId;
      if (!webId) return res.status(401).json({ error: 'Not authenticated' });

      const { podUrl } = req.body || {};
      const parsedPodUrl = parseHttpUrl(podUrl);
      if (!parsedPodUrl || parsedPodUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'Invalid Pod URL — must be a valid https:// URL' });
      }

      // Normalize: ensure trailing slash
      const normalized = podUrl.endsWith('/') ? podUrl : `${podUrl}/`;
      req.session.podUrl = normalized;

      // Hook: let the app persist Pod URL (e.g. to tenant DB)
      if (options.onPodUrlSave) {
        try {
          await options.onPodUrlSave(req, { webId, podUrl: normalized });
        } catch (saveErr) {
          logger.warn('[SolidAuth] onPodUrlSave hook error:', saveErr.message);
        }
      }

      logger.log('[SolidAuth] Pod URL manually set:', sanitizeForLog(normalized), 'for', sanitizeForLog(webId));
      res.json({ success: true, podUrl: normalized });
    } catch (error) {
      logger.error('[SolidAuth] Pod URL save error:', error);
      res.status(500).json({ error: 'Failed to save Pod URL' });
    }
  });

  // ── POST /logout ────────────────────────────────────────────────────────
  router.post('/logout', limiter, async (req, res) => {
    try {
      // Hook: before logout
      if (onLogout) {
        await onLogout(req);
      }

      await sessionManager.logout(req.solidSession);
      const idpIssuer = req.session?.oidcIssuer || defaultIdp;
      req.session = null;

      res.json({
        success: true,
        message: 'Logged out successfully',
        endSessionUrl: `${idpIssuer}/endsession`,
      });
    } catch (error) {
      logger.error('[SolidAuth] Logout error:', error);
      res.status(500).json({ error: 'Logout failed', message: error.message });
    }
  });

  // ── GET /providers ──────────────────────────────────────────────────────
  router.get('/providers', (_req, res) => {
    res.json({
      default: defaultIdp,
      providers,
    });
  });

  return router;
}
