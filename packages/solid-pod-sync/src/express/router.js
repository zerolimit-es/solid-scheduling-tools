/**
 * @zerolimit/solid-pod-sync/express — Sync Router
 *
 * Creates an Express Router with Pod sync endpoints.
 * Database access and auth are injected via options.
 *
 * Routes:
 *   POST /bookings   — Sync unsynced bookings to Pod
 *   GET  /bookings   — Load bookings from Pod (with optional fallback)
 *   GET  /pod-status — Check Pod connectivity
 */

import { Router } from 'express';
import {
  saveBooking,
  loadBookings,
  initializeSchedulerContainer,
} from '../core/solid.js';

/**
 * Create an Express Router with Pod sync endpoints.
 *
 * @param {import('../core/types.js').SyncRouterOptions} options
 * @returns {import('express').Router}
 */
export function createSyncRouter(options) {
  const {
    getPodUrl,
    getAuthenticatedFetch,
    syncStore,
    getTimezone,
    podPaths,
    onSyncComplete,
    getFallbackBookings,
  } = options;

  const logger = options.logger ?? console;
  const router = Router();

  // ── POST /bookings — sync unsynced bookings to Pod ──

  router.post('/bookings', async (req, res) => {
    try {
      const podUrl = getPodUrl(req);
      const authFetch = getAuthenticatedFetch(req);

      if (!podUrl) {
        return res.status(400).json({ error: 'No Pod URL available' });
      }
      if (!authFetch) {
        return res.status(400).json({
          error: 'No authenticated Solid session',
          message: 'Pod sync requires an active Solid session. Please log in again.',
        });
      }
      if (!syncStore) {
        return res.status(501).json({ error: 'Sync store not configured' });
      }

      const unsynced = syncStore.getUnsynced(req);
      if (unsynced.length === 0) {
        return res.json({ success: true, synced: 0, failed: 0, total: 0, message: 'All bookings already synced' });
      }

      logger.log(`[PodSync] Starting sync: ${unsynced.length} bookings to push`);

      let synced = 0;
      let failed = 0;
      const timezone = getTimezone?.(req) || 'UTC';

      for (const booking of unsynced) {
        try {
          const podResourceUrl = await saveBooking(podUrl, booking, authFetch, podPaths);
          syncStore.markSynced(booking.id, podResourceUrl);
          synced++;
          logger.log(`[PodSync] ✓ Synced: ${booking.title || booking.id} → ${podResourceUrl}`);
        } catch (err) {
          failed++;
          logger.error(`[PodSync] ✗ Failed to sync ${booking.id}:`, err.message);
        }
      }

      logger.log(`[PodSync] Complete: ${synced} synced, ${failed} failed out of ${unsynced.length}`);

      const result = { synced, failed, total: unsynced.length };
      if (onSyncComplete) await onSyncComplete(req, result);

      res.json({
        success: true,
        ...result,
        message: synced > 0 ? `Synced ${synced} booking(s) to your Pod` : 'All bookings already synced',
      });
    } catch (error) {
      logger.error('[PodSync] Sync error:', error);
      res.status(500).json({ error: 'Sync failed', message: error.message });
    }
  });

  // ── GET /bookings — load bookings from Pod (with optional fallback) ──

  router.get('/bookings', async (req, res) => {
    try {
      const podUrl = getPodUrl(req);
      const authFetch = getAuthenticatedFetch(req);
      const limit = parseInt(req.query?.limit || '20');

      let bookings = [];
      let source = 'fallback';

      // Try Pod first if we have auth
      if (podUrl && authFetch) {
        try {
          const podBookings = await loadBookings(podUrl, authFetch, {
            from: new Date(),
          }, podPaths);

          if (podBookings.length > 0) {
            bookings = podBookings.slice(0, limit);
            source = 'pod';
          }
        } catch (err) {
          logger.warn('[PodSync] Pod read failed, using fallback:', err.message);
        }
      }

      // Fallback
      if (source === 'fallback' && getFallbackBookings) {
        bookings = await getFallbackBookings(req, { limit });
        source = 'local';
      }

      res.json({ source, bookings });
    } catch (error) {
      logger.error('[PodSync] Load bookings error:', error);
      res.status(500).json({ error: 'Failed to load bookings', message: error.message });
    }
  });

  // ── GET /pod-status — check Pod connectivity ──

  router.get('/pod-status', async (req, res) => {
    try {
      const authFetch = getAuthenticatedFetch(req);
      if (!authFetch) {
        return res.json({ connected: false, reason: 'No authenticated session' });
      }

      const podUrl = getPodUrl(req);
      if (!podUrl) {
        return res.json({ connected: false, reason: 'No Pod URL' });
      }

      const podRes = await authFetch(podUrl, { method: 'HEAD' });
      if (podRes.ok || podRes.status === 403) {
        // 403 means auth works but no access to root (still connected)
        return res.json({ connected: true, podUrl });
      } else {
        return res.json({ connected: false, reason: `Pod returned ${podRes.status}` });
      }
    } catch (err) {
      return res.json({ connected: false, reason: err.message });
    }
  });

  return router;
}
