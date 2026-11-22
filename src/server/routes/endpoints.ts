import { Router } from 'express';
import { z } from 'zod';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { RetryWorker } from '../workers/retryWorker.js';
import {
  createEndpoint,
  deleteEndpoint,
  getEndpointById,
  listEndpoints,
  revealEndpointSecret,
  rotateEndpointSecret,
  updateEndpoint,
} from '../services/endpointService.js';
import { createEvent } from '../services/eventService.js';
import { executeDeliveryAttempt } from '../services/dispatcher.js';
import { getDeliveryDetail, listDeliveries } from '../services/deliveryService.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errorHandler.js';

const createEndpointSchema = z.object({
  name: z.string().trim().min(1, 'Endpoint name is required').max(120),
  url: z.string().trim().min(1, 'Destination URL is required').max(2048),
  description: z.string().max(500).optional(),
  subscribed_events: z.array(z.string().min(1)).min(1, 'Subscribe to at least one event type'),
  enabled: z.boolean().optional(),
  workspace_id: z.string().trim().min(1).max(64).optional(),
});

const updateEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  description: z.string().max(500).optional(),
  subscribed_events: z.array(z.string().min(1)).min(1).optional(),
  enabled: z.boolean().optional(),
});

const testWebhookSchema = z
  .object({
    event_type: z.string().trim().min(1).max(120).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

export function createEndpointsRouter(
  db: HookRelayDB,
  config: AppConfig,
  worker: RetryWorker | null
): Router {
  const router = Router();
  const sensitiveLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    keyPrefix: 'endpoint-sensitive',
  });

  router.get('/', (req, res, next) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const enabled =
        req.query.enabled === 'true'
          ? true
          : req.query.enabled === 'false'
            ? false
            : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const workspaceId =
        typeof req.query.workspace_id === 'string' ? req.query.workspace_id : 'default';

      const result = listEndpoints(db, {
        workspace_id: workspaceId,
        enabled,
        search,
        page: Number.isFinite(page) ? page : 1,
        limit: Number.isFinite(limit) ? limit : 50,
      });

      res.json({
        data: result.data,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          total_pages: Math.max(1, Math.ceil(result.total / result.limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const parsed = createEndpointSchema.parse(req.body);
      const created = await createEndpoint(db, config, parsed);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const endpoint = getEndpointById(db, req.params.id);
      if (!endpoint) {
        throw new ApiError(404, 'ENDPOINT_NOT_FOUND', `Endpoint "${req.params.id}" not found`);
      }
      const deliveries = listDeliveries(db, {
        endpoint_id: endpoint.id,
        page: 1,
        limit: 20,
      });
      res.json({
        data: endpoint,
        recent_deliveries: deliveries.data,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const parsed = updateEndpointSchema.parse(req.body);
      const updated = await updateEndpoint(db, config, req.params.id, parsed);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      deleteEndpoint(db, req.params.id);
      res.status(200).json({ deleted: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/rotate-secret', sensitiveLimiter, (req, res, next) => {
    try {
      const rotated = rotateEndpointSecret(db, req.params.id);
      res.json({ data: rotated });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/reveal-secret', sensitiveLimiter, (req, res, next) => {
    try {
      const revealed = revealEndpointSecret(db, req.params.id);
      res.json({ data: revealed });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/test', sensitiveLimiter, async (req, res, next) => {
    try {
      const endpoint = getEndpointById(db, req.params.id);
      if (!endpoint) {
        throw new ApiError(404, 'ENDPOINT_NOT_FOUND', `Endpoint "${req.params.id}" not found`);
      }

      const body = testWebhookSchema.parse(req.body);
      const defaultEventType =
        endpoint.subscribed_events.find((e) => !e.includes('*')) || 'webhook.test';
      const eventType = body?.event_type || defaultEventType;
      const data = body?.data || {
        message: 'HookRelay test webhook delivery',
        endpoint_id: endpoint.id,
        endpoint_name: endpoint.name,
        sent_at: new Date().toISOString(),
      };

      // Create persistent event & delivery record targeting this endpoint, then execute immediately
      const created = createEvent(db, config, null, {
        type: eventType,
        data,
        source: 'test',
        workspace_id: endpoint.workspace_id,
        target_endpoint_ids: [endpoint.id],
      });

      const deliveryId = created.delivery_ids[0];
      if (deliveryId) {
        // Claim and execute synchronously so user receives immediate real HTTP test result
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE deliveries SET status = 'processing', locked_at = ?, locked_by = 'test-dispatch' WHERE id = ?`
        ).run(now, deliveryId);
        await executeDeliveryAttempt(db, config, deliveryId);
        if (worker) {
          worker.wakeUp();
        }
      }

      const delivery = deliveryId ? getDeliveryDetail(db, deliveryId) : null;
      res.status(201).json({
        event: created.event,
        delivery,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
