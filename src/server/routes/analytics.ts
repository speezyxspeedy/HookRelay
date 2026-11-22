import { Router } from 'express';
import type { HookRelayDB } from '../database/db.js';
import { getDeliveryAnalytics, getOverviewAnalytics } from '../services/analyticsService.js';

export function createAnalyticsRouter(db: HookRelayDB): Router {
  const router = Router();

  router.get('/overview', (req, res, next) => {
    try {
      const workspaceId =
        typeof req.query.workspace_id === 'string' ? req.query.workspace_id : 'default';
      const data = getOverviewAnalytics(db, workspaceId);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/deliveries', (req, res, next) => {
    try {
      const workspaceId =
        typeof req.query.workspace_id === 'string' ? req.query.workspace_id : 'default';
      const range = typeof req.query.range === 'string' ? req.query.range : '7d';
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;

      const data = getDeliveryAnalytics(db, {
        workspace_id: workspaceId,
        range,
        from,
        to,
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
