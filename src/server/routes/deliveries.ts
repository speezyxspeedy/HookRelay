import { Router } from 'express';
import type { HookRelayDB } from '../database/db.js';
import type { RetryWorker } from '../workers/retryWorker.js';
import {
  getDeliveryAttempts,
  getDeliveryDetail,
  listDeliveries,
  triggerManualRetry,
} from '../services/deliveryService.js';
import { ApiError } from '../middleware/errorHandler.js';

export function createDeliveriesRouter(
  db: HookRelayDB,
  worker: RetryWorker | null
): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 25;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const endpointId =
        typeof req.query.endpoint_id === 'string' ? req.query.endpoint_id : undefined;
      const eventId = typeof req.query.event_id === 'string' ? req.query.event_id : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const workspaceId =
        typeof req.query.workspace_id === 'string' ? req.query.workspace_id : 'default';
      const isReplay =
        req.query.is_replay === 'true'
          ? true
          : req.query.is_replay === 'false'
            ? false
            : undefined;

      const result = listDeliveries(db, {
        workspace_id: workspaceId,
        status,
        endpoint_id: endpointId,
        event_id: eventId,
        search,
        is_replay: isReplay,
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

  router.get('/:id', (req, res, next) => {
    try {
      const detail = getDeliveryDetail(db, req.params.id);
      if (!detail) {
        throw new ApiError(404, 'DELIVERY_NOT_FOUND', `Delivery "${req.params.id}" not found`);
      }
      res.json({ data: detail });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/attempts', (req, res, next) => {
    try {
      const detail = getDeliveryDetail(db, req.params.id);
      if (!detail) {
        throw new ApiError(404, 'DELIVERY_NOT_FOUND', `Delivery "${req.params.id}" not found`);
      }
      const attempts = getDeliveryAttempts(db, req.params.id);
      res.json({ data: attempts });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/retry', (req, res, next) => {
    try {
      const updated = triggerManualRetry(db, worker, req.params.id);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
