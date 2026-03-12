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
import { discoverPodUrls } from '../core/pod-discovery.js';
import { DEFAULT_PROVIDERS, DEFAULT_IDP, mergeProviders } from '../core/providers.js';

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

  // ── GET /login ──────────────────────────────────────────────────────────
  router.get('/login', async (req, res) => {
    try {
      const { oidcIssuer, returnTo } = req.query;
      if (returnTo) {
        req.session.returnTo = returnTo;
      }

      // Hook: before login
      if (onLogin) {
        await onLogin(req, { oidcIssuer: oidcIssuer || defaultIdp });
      }

      // Always create a fresh session to avoid stale OIDC client registration
      const freshSession = sessionManager.createFreshSession();
      req.solidSession = freshSession;
      req.session.solidSessionId = freshSession.info.sessionId;

      const redirectUrl = `${baseUrl}/api/auth/callback`;
      await sessionManager.startLogin(freshSession, {
        oidcIssuer: oidcIssuer || defaultIdp,
        redirectUrl,
        clientName,
        handleRedirect: (url) => res.redirect(url),
      });
    } catch (error) {
      logger.error('[SolidAuth] Login error:', error);
      const returnTo = req.session.returnTo || frontendUrl;
      res.redirect(
        `${returnTo}?login=error&message=${encodeURIComponent(
          'This provider could not be reached. Try a different one.'
        )}`
      );
    }
  });

  // ── GET /callback ───────────────────────────────────────────────────────
  router.get('/callback', async (req, res) => {
    try {
      const fullUrl = `${baseUrl}${req.originalUrl}`;
      logger.log('[SolidAuth] CALLBACK fullUrl:', fullUrl);

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

        const returnTo = hookResult?.redirectUrl || req.session.returnTo || frontendUrl;
        delete req.session.returnTo;

        if (req.session.mfaPending) {
          return res.redirect(`${returnTo}?login=mfa-required`);
        }

        res.redirect(`${returnTo}?login=success`);
      } else {
        res.redirect(`${frontendUrl}?login=failed`);
      }
    } catch (error) {
      logger.error('[SolidAuth] Callback error:', error);
      res.redirect(
        `${frontendUrl}?login=error&message=${encodeURIComponent(error.message)}`
      );
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
  router.put('/pod-url', async (req, res) => {
    try {
      const webId = req.solidSession?.info?.webId || req.session?.webId;
      if (!webId) return res.status(401).json({ error: 'Not authenticated' });

      const { podUrl } = req.body || {};
      if (!podUrl || typeof podUrl !== 'string' || !podUrl.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid Pod URL — must start with https://' });
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

      logger.log('[SolidAuth] Pod URL manually set:', normalized, 'for', webId);
      res.json({ success: true, podUrl: normalized });
    } catch (error) {
      logger.error('[SolidAuth] Pod URL save error:', error);
      res.status(500).json({ error: 'Failed to save Pod URL' });
    }
  });

  // ── POST /logout ────────────────────────────────────────────────────────
  router.post('/logout', async (req, res) => {
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
