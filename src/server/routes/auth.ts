import { Router } from 'express';
import { z } from 'zod';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import {
  claimInitialAdminKey,
  createSessionToken,
  isRequestAuthenticated,
  isSetupRequired,
  verifyAdminCredential,
} from '../security/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { ApiError } from '../middleware/errorHandler.js';

const authSchema = z.object({
  api_key: z.string().min(1, 'API key is required').max(256),
});

export function createAuthRouter(db: HookRelayDB, config: AppConfig): Router {
  const router = Router();
  const authRateLimit = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
    keyPrefix: 'auth',
  });

  router.get('/status', (req, res) => {
    const authenticated = isRequestAuthenticated(
      db,
      config,
      req.header('x-api-key'),
      req.header('authorization')
    );

    res.json({
      authenticated,
      setup_required: isSetupRequired(db, config),
      env_key_configured: Boolean(config.apiKey && config.apiKey.length > 0),
      environment: config.nodeEnv,
    });
  });

  router.post('/setup', authRateLimit, (req, res, next) => {
    try {
      const parsed = authSchema.parse(req.body);
      const result = claimInitialAdminKey(db, config, parsed.api_key);
      if (!result.ok) {
        throw new ApiError(409, 'SETUP_UNAVAILABLE', result.error || 'Setup unavailable');
      }

      const session = createSessionToken('admin');
      res.status(201).json({
        authenticated: true,
        token: session.token,
        expires_at: session.expiresAt,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', authRateLimit, (req, res, next) => {
    try {
      const parsed = authSchema.parse(req.body);
      if (isSetupRequired(db, config)) {
        throw new ApiError(
          409,
          'ADMIN_SETUP_REQUIRED',
          'No admin key configured yet. Complete first-run setup first.'
        );
      }

      if (!verifyAdminCredential(db, config, parsed.api_key)) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid admin API key');
      }

      const session = createSessionToken('admin');
      res.json({
        authenticated: true,
        token: session.token,
        expires_at: session.expiresAt,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
