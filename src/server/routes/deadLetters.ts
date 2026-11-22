import { Router } from 'express';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { RetryWorker } from '../workers/retryWorker.js';
import {
  archiveDeadLetter,
  listDeliveries,
  replayDeadLetter,
} from '../services/deliveryService.js';

export function createDeadLettersRouter(
  db: HookRelayDB,
  config: AppConfig,
  worker: RetryWorker | null
): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 25;
      const includeArchived = req.query.include_archived === 'true';
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const endpointId =
        typeof req.query.endpoint_id === 'string' ? req.query.endpoint_id : undefined;
      const workspaceId =
        typeof req.query.workspace_id === 'string' ? req.query.workspace_id : 'default';

      const result = listDeliveries(db, {
        workspace_id: workspaceId,
        dlq_only: true,
        include_archived: includeArchived,
        endpoint_id: endpointId,
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

  router.post('/:id/replay', (req, res, next) => {
    try {
      const replayed = replayDeadLetter(db, config, worker, req.params.id);
      res.status(201).json({ data: replayed });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/archive', (req, res, next) => {
    try {
      const archived = archiveDeadLetter(db, req.params.id);
      res.json({ data: archived });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
