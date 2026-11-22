import { Router } from 'express';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { RetryWorker } from '../workers/retryWorker.js';
import { getSettings } from '../services/settingsService.js';

export function createHealthRouter(
  db: HookRelayDB,
  config: AppConfig,
  worker: RetryWorker | null
): Router {
  const router = Router();
  const startedAt = Date.now();

  router.get('/', (_req, res) => {
    db.prepare('SELECT 1 AS ok').get();
    const settings = getSettings(db, config);

    res.json({
      status: 'ok',
      database: 'connected',
      worker: worker
        ? worker.getStatus()
        : { running: false, active_jobs: 0, poll_interval_ms: config.workerPollIntervalMs },
      environment: settings.environment_label || config.nodeEnv,
      allow_localhost_webhooks: settings.allow_localhost_webhooks,
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
