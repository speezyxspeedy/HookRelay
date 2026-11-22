import express, { Router } from 'express';
import { z } from 'zod';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import {
  clearReceiverRequests,
  getReceiverConfig,
  listReceiverRequests,
  recordIncomingReceiverRequest,
  updateReceiverConfig,
} from '../services/receiverService.js';
import { getSettings } from '../services/settingsService.js';

const updateReceiverSchema = z.object({
  mode: z
    .enum([
      '200_ok',
      '400_bad_request',
      '429_rate_limited',
      '500_server_error',
      'delayed_200',
      'timeout',
    ])
    .optional(),
  delay_ms: z.number().int().min(100).max(30_000).optional(),
  retry_after_seconds: z.number().int().min(1).max(300).optional(),
  verification_endpoint_id: z.string().nullable().optional(),
  custom_secret: z.string().max(256).nullable().optional(),
});

export function createReceiverIngestRouter(db: HookRelayDB, config: AppConfig): Router {
  const router = Router();

  // Accept exact raw request body so HMAC-SHA256 verification checks exact transmitted bytes
  router.post(
    '/ingest',
    express.raw({ type: '*/*', limit: '512kb' }),
    async (req, res) => {
      const receiverConfig = getReceiverConfig(db, config);
      const settings = getSettings(db, config);

      const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body ?? {});

      let statusToReturn = 200;
      let responsePayload: Record<string, unknown> = {
        received: true,
        mode: receiverConfig.mode,
      };

      if (receiverConfig.mode === '400_bad_request') {
        statusToReturn = 400;
        responsePayload = {
          received: false,
          error: 'Simulated HTTP 400 permanent client error',
        };
      } else if (receiverConfig.mode === '429_rate_limited') {
        statusToReturn = 429;
        res.setHeader('Retry-After', String(receiverConfig.retry_after_seconds));
        responsePayload = {
          received: false,
          error: 'Simulated HTTP 429 rate limit exceeded',
          retry_after_seconds: receiverConfig.retry_after_seconds,
        };
      } else if (receiverConfig.mode === '500_server_error') {
        statusToReturn = 500;
        responsePayload = {
          received: false,
          error: 'Simulated HTTP 500 transient server failure',
        };
      } else if (receiverConfig.mode === 'delayed_200') {
        statusToReturn = 200;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, receiverConfig.delay_ms);
          req.on('close', () => {
            clearTimeout(t);
            resolve();
          });
        });
        responsePayload = {
          received: true,
          delayed_ms: receiverConfig.delay_ms,
        };
      } else if (receiverConfig.mode === 'timeout') {
        // Log receipt immediately, then hold connection past dispatcher timeout
        statusToReturn = 504;
        recordIncomingReceiverRequest(db, config, {
          rawBody,
          headers: req.headers,
          mode: receiverConfig.mode,
          responseStatus: 504,
        });

        const holdMs = Math.min(settings.request_timeout_ms + 2500, 35_000);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, holdMs);
          req.on('close', () => {
            clearTimeout(t);
            resolve();
          });
        });

        if (!res.writableEnded) {
          res.status(504).json({ error: 'Simulated receiver timeout' });
        }
        return;
      }

      const logged = recordIncomingReceiverRequest(db, config, {
        rawBody,
        headers: req.headers,
        mode: receiverConfig.mode,
        responseStatus: statusToReturn,
      });

      if (!res.writableEnded) {
        res.status(statusToReturn).json({
          ...responsePayload,
          receipt_id: logged.id,
          signature_valid: logged.signature_valid,
          signature_error: logged.signature_error,
        });
      }
    }
  );

  return router;
}

export function createReceiverAdminRouter(db: HookRelayDB, config: AppConfig): Router {
  const router = Router();

  router.get('/config', (_req, res, next) => {
    try {
      res.json({ data: getReceiverConfig(db, config) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/config', (req, res, next) => {
    try {
      const parsed = updateReceiverSchema.parse(req.body);
      res.json({ data: updateReceiverConfig(db, config, parsed) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/requests', (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const data = listReceiverRequests(db, Number.isFinite(limit) ? limit : 50);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/requests', (_req, res, next) => {
    try {
      const deleted = clearReceiverRequests(db);
      res.json({ deleted });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
