import express from 'express';
import type { Express } from 'express';
import type { HookRelayDB } from './database/db.js';
import type { AppConfig } from './config.js';
import type { RetryWorker } from './workers/retryWorker.js';
import { attachRequestId, errorHandler, ApiError } from './middleware/errorHandler.js';
import { createAuthMiddleware } from './middleware/authMiddleware.js';
import { createHealthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createEndpointsRouter } from './routes/endpoints.js';
import { createEventsRouter } from './routes/events.js';
import { createDeliveriesRouter } from './routes/deliveries.js';
import { createDeadLettersRouter } from './routes/deadLetters.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createSettingsRouter } from './routes/settings.js';
import { createReceiverAdminRouter, createReceiverIngestRouter } from './routes/receiver.js';
import { createOpenApiRouter } from './routes/openapi.js';

export function createApp(
  db: HookRelayDB,
  config: AppConfig,
  worker: RetryWorker | null
): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(attachRequestId);

  // Mount raw-body local webhook receiver ingest route BEFORE express.json()
  // so HMAC-SHA256 verification inspects the exact transmitted request payload.
  app.use('/api/receiver', createReceiverIngestRouter(db, config));

  // Enforce payload size limit on standard JSON API routes
  app.use(
    express.json({
      limit: `${Math.max(64, Math.ceil(config.maxPayloadBytes / 1024))}kb`,
    })
  );

  // Public operational / docs / auth bootstrap routes
  app.use('/api/health', createHealthRouter(db, config, worker));
  app.use('/api/auth', createAuthRouter(db, config));
  app.use('/api', createOpenApiRouter(config));

  // All administrative API routes require valid server-side API key or session Bearer token
  const requireAuth = createAuthMiddleware(db, config);
  app.use('/api/endpoints', requireAuth, createEndpointsRouter(db, config, worker));
  app.use('/api/events', requireAuth, createEventsRouter(db, config, worker));
  app.use('/api/deliveries', requireAuth, createDeliveriesRouter(db, worker));
  app.use('/api/dead-letters', requireAuth, createDeadLettersRouter(db, config, worker));
  app.use('/api/analytics', requireAuth, createAnalyticsRouter(db));
  app.use('/api/settings', requireAuth, createSettingsRouter(db, config));
  app.use('/api/receiver', requireAuth, createReceiverAdminRouter(db, config));

  // 404 handler for unknown /api routes
  app.use('/api', (req, _res, next) => {
    next(new ApiError(404, 'ROUTE_NOT_FOUND', `API route ${req.method} ${req.originalUrl} not found`));
  });

  app.use(errorHandler);
  return app;
}
