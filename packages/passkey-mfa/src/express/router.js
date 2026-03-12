/**
 * @zerolimit/passkey-mfa/express — Passkey Router
 *
 * Creates an Express Router with WebAuthn registration, authentication,
 * and credential management endpoints. Database and challenge storage
 * are injected via options for full flexibility.
 */

import { Router } from 'express';
import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

/**
 * Create an Express Router with passkey MFA endpoints.
 *
 * Routes:
 *   GET  /register-options  — Generate registration challenge
 *   POST /register-verify   — Verify and store new credential
 *   GET  /auth-options      — Generate authentication challenge
 *   POST /auth-verify       — Verify credential, clear MFA flag
 *   GET  /list              — List user's passkeys
 *   DELETE /:id             — Remove a passkey
 *
 * @param {import('../core/types.js').PasskeyRouterOptions} options
 * @returns {import('express').Router}
 */
export function createPasskeyRouter(options) {
  const {
    challengeStore,
    credentialStore,
    rpName,
    rpId,
    origin,
    getUserId,
    getWebId,
  } = options;

  const logger = options.logger ?? console;
  const router = Router();

  // ── Middleware: require OIDC login ──
  function requireOidc(req, res, next) {
    const loggedIn = req.solidSession?.info?.isLoggedIn || !!req.session?.webId;
    if (!loggedIn) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // ── Registration ──

  router.get('/register-options', requireOidc, async (req, res) => {
    try {
      if (req.session?.mfaPending) {
        return res.status(403).json({ error: 'Complete MFA verification before registering new passkeys' });
      }

      const userId = getUserId(req);
      if (!userId) return res.status(400).json({ error: 'User not found' });

      const webId = getWebId(req);
      const existingPasskeys = await credentialStore.getByUser(userId);

      const opts = await generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userName: webId || userId,
        userDisplayName: webId ? webId.split('/').pop() : userId,
        userID: Buffer.from(userId),
        attestationType: 'none',
        excludeCredentials: existingPasskeys.map(pk => ({
          id: pk.credentialId,
          transports: pk.transports ? JSON.parse(pk.transports) : undefined,
        })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      });

      await challengeStore.store(userId, opts.challenge);
      res.json(opts);
    } catch (error) {
      logger.error('[PasskeyMFA] Register options error:', error);
      res.status(500).json({ error: 'Failed to generate registration options' });
    }
  });

  router.post('/register-verify', requireOidc, async (req, res) => {
    try {
      if (req.session?.mfaPending) {
        return res.status(403).json({ error: 'Complete MFA verification first' });
      }

      const userId = getUserId(req);
      if (!userId) return res.status(400).json({ error: 'User not found' });

      const expectedChallenge = await challengeStore.get(userId);
      if (!expectedChallenge) {
        return res.status(400).json({ error: 'Challenge expired or not found — try again' });
      }

      const { body, deviceName } = req.body;

      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: 'Verification failed' });
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

      const record = {
        id: crypto.randomUUID(),
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: JSON.stringify(credential.transports || []),
        deviceName: deviceName || `${credentialDeviceType}${credentialBackedUp ? ' (backed up)' : ''}`,
        createdAt: new Date().toISOString(),
      };

      await credentialStore.save(record);
      logger.log(`[PasskeyMFA] Registered passkey for user ${userId}`);

      res.json({
        success: true,
        passkey: { id: record.id, deviceName: record.deviceName, createdAt: record.createdAt },
      });
    } catch (error) {
      logger.error('[PasskeyMFA] Register verify error:', error);
      res.status(500).json({ error: 'Failed to verify registration' });
    }
  });

  // ── Authentication (MFA challenge) ──

  router.get('/auth-options', requireOidc, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(400).json({ error: 'User not found' });

      const passkeys = await credentialStore.getByUser(userId);
      if (passkeys.length === 0) {
        return res.status(404).json({ error: 'No passkeys registered' });
      }

      const opts = await generateAuthenticationOptions({
        rpID: rpId,
        allowCredentials: passkeys.map(pk => ({
          id: pk.credentialId,
          transports: pk.transports ? JSON.parse(pk.transports) : undefined,
        })),
        userVerification: 'preferred',
      });

      await challengeStore.store(userId, opts.challenge);
      res.json(opts);
    } catch (error) {
      logger.error('[PasskeyMFA] Auth options error:', error);
      res.status(500).json({ error: 'Failed to generate authentication options' });
    }
  });

  router.post('/auth-verify', requireOidc, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(400).json({ error: 'User not found' });

      const expectedChallenge = await challengeStore.get(userId);
      if (!expectedChallenge) {
        return res.status(400).json({ error: 'Challenge expired or not found — try again' });
      }

      const { body } = req.body;
      const passkey = await credentialStore.getByCredentialId(body.id);
      if (!passkey) {
        return res.status(400).json({ error: 'Passkey not found' });
      }

      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        credential: {
          id: passkey.credentialId,
          publicKey: passkey.publicKey,
          counter: passkey.counter,
          transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
        },
      });

      if (!verification.verified) {
        return res.status(400).json({ error: 'Verification failed' });
      }

      await credentialStore.updateCounter(passkey.credentialId, verification.authenticationInfo.newCounter);

      // Clear MFA pending flag
      req.session.mfaPending = false;
      logger.log(`[PasskeyMFA] MFA verified for user ${userId}`);

      res.json({ success: true, verified: true });
    } catch (error) {
      logger.error('[PasskeyMFA] Auth verify error:', error);
      res.status(500).json({ error: 'Failed to verify authentication' });
    }
  });

  // ── Management ──

  router.get('/list', requireOidc, async (req, res) => {
    try {
      if (req.session?.mfaPending) {
        return res.status(403).json({ error: 'Complete MFA verification first' });
      }

      const userId = getUserId(req);
      if (!userId) return res.json({ passkeys: [] });

      const passkeys = await credentialStore.getByUser(userId);
      res.json({
        passkeys: passkeys.map(pk => ({
          id: pk.id,
          deviceName: pk.deviceName || pk.device_name,
          createdAt: pk.createdAt || pk.created_at,
          lastUsedAt: pk.lastUsedAt || pk.last_used_at,
        })),
      });
    } catch (error) {
      logger.error('[PasskeyMFA] List error:', error);
      res.status(500).json({ error: 'Failed to list passkeys' });
    }
  });

  router.delete('/:id', requireOidc, async (req, res) => {
    try {
      if (req.session?.mfaPending) {
        return res.status(403).json({ error: 'Complete MFA verification first' });
      }

      const userId = getUserId(req);
      const removed = await credentialStore.remove(req.params.id, userId);

      if (!removed) {
        return res.status(404).json({ error: 'Passkey not found' });
      }

      logger.log(`[PasskeyMFA] Deleted passkey ${req.params.id} for user ${userId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('[PasskeyMFA] Delete error:', error);
      res.status(500).json({ error: 'Failed to delete passkey' });
    }
  });

  return router;
}
