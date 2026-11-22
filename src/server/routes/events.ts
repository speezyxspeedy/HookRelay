import { Router } from 'express';
import { z } from 'zod';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { RetryWorker } from '../workers/retryWorker.js';
import {
  createEvent,
  getEventById,
  listEvents,
  replayEventToEndpoints,
} from '../services/eventService.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errorHandler.js';

const createEventSchema = z.object({
  type: z.string().trim().min(1, 'Event type is required').max(120),
  data: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  idempotency_key: z.string().trim().max(200).optional(),
  source: z.enum(['api', 'dashboard', 'test']).optional(),
  workspace_id: z.string().trim().min(1).max(64).optional(),
});

const replayEventSchema = z.object({
  endpoint_ids: z.array(z.string().min(1)).min(1, 'Select at least one endpoint'),
});

export function createEventsRouter(
  db: HookRelayDB,
  config: AppConfig,
  worker: RetryWorker | null
): Router {
  const router = Router();
  const ingestLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 180,
    keyPrefix: 'events-ingest',
  });

  router.get('/', (req, res, next) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 25;
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const workspaceId =
        typeof req.query.workspace_id === 'string' ? req.query.workspace_id : 'default';

      const result = listEvents(db, {
        workspace_id: workspaceId,
        type,
        search,
        page: Number.isFinite(page) ? page : 1,
        limit: Number.isFinite(limit) ? limit : 25,
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

  router.post('/', ingestLimiter, (req, res, next) => {
    try {
      const parsed = createEventSchema.parse(req.body);
      const headerIdempotencyKey = req.header('idempotency-key') || req.header('x-idempotency-key');
      const idempotencyKey = parsed.idempotency_key || headerIdempotencyKey || undefined;

      const result = createEvent(db, config, worker, {
        type: parsed.type,
        data: parsed.data,
        idempotency_key: idempotencyKey,
        source: parsed.source ?? 'api',
        workspace_id: parsed.workspace_id ?? 'default',
      });

      res.status(result.idempotent_replay ? 200 : 201).json({
        data: result.event,
        deliveries_created: result.deliveries_created,
        delivery_ids: result.delivery_ids,
        idempotent_replay: result.idempotent_replay,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const detail = getEventById(db, req.params.id);
      if (!detail) {
        throw new ApiError(404, 'EVENT_NOT_FOUND', `Event "${req.params.id}" not found`);
      }
      res.json({
        data: detail.event,
        deliveries: detail.deliveries,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/replay', ingestLimiter, (req, res, next) => {
    try {
      const parsed = replayEventSchema.parse(req.body);
      const result = replayEventToEndpoints(db, config, worker, req.params.id, parsed.endpoint_ids);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
