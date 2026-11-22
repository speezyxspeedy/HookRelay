import { Router } from 'express';
import { z } from 'zod';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import { getSettings, updateSettings } from '../services/settingsService.js';

const updateSettingsSchema = z.object({
  max_attempts: z.number().int().min(1).max(20).optional(),
  initial_delay_ms: z.number().int().min(200).max(300_000).optional(),
  max_delay_ms: z.number().int().min(1000).max(3_600_000).optional(),
  request_timeout_ms: z.number().int().min(500).max(60_000).optional(),
  retry_on_408: z.boolean().optional(),
  retry_on_429: z.boolean().optional(),
  allow_localhost_webhooks: z.boolean().optional(),
  signature_tolerance_seconds: z.number().int().min(30).max(3600).optional(),
  workspace_name: z.string().trim().min(1).max(80).optional(),
  environment_label: z.string().trim().min(1).max(32).optional(),
});

export function createSettingsRouter(db: HookRelayDB, config: AppConfig): Router {
  const router = Router();

  router.get('/', (_req, res, next) => {
    try {
      const data = getSettings(db, config);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/', (req, res, next) => {
    try {
      const parsed = updateSettingsSchema.parse(req.body);
      const data = updateSettings(db, config, parsed);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
