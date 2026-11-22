import crypto from 'crypto';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { ReceiverConfig, ReceiverMode, ReceiverRequestLog } from '../../shared/types.js';
import { verifyWebhookSignature } from '../security/hmac.js';
import { redactHeaders } from '../security/redaction.js';
import { getEndpointSecretInternal } from './endpointService.js';
import { getSettings } from './settingsService.js';

const RECEIVER_KEYS = {
  mode: 'receiver_mode',
  delayMs: 'receiver_delay_ms',
  retryAfterSeconds: 'receiver_retry_after_seconds',
  verificationEndpointId: 'receiver_verification_endpoint_id',
  customSecret: 'receiver_custom_secret',
} as const;

const VALID_MODES: ReceiverMode[] = [
  '200_ok',
  '400_bad_request',
  '429_rate_limited',
  '500_server_error',
  'delayed_200',
  'timeout',
];

export function getReceiverConfig(db: HookRelayDB, config: AppConfig): ReceiverConfig {
  const rows = db
    .prepare(
      `SELECT key, value FROM application_settings WHERE key IN (${Object.values(RECEIVER_KEYS)
        .map(() => '?')
        .join(',')})`
    )
    .all(...Object.values(RECEIVER_KEYS)) as Array<{ key: string; value: string }>;

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const rawMode = map.get(RECEIVER_KEYS.mode) as ReceiverMode | undefined;
  const mode: ReceiverMode = rawMode && VALID_MODES.includes(rawMode) ? rawMode : '200_ok';
  const delayMs = Number(map.get(RECEIVER_KEYS.delayMs) ?? 1500);
  const retryAfterSeconds = Number(map.get(RECEIVER_KEYS.retryAfterSeconds) ?? 5);
  const endpointId = map.get(RECEIVER_KEYS.verificationEndpointId) || null;
  const customSecret = map.get(RECEIVER_KEYS.customSecret) || null;

  return {
    mode,
    delay_ms: Number.isFinite(delayMs) ? delayMs : 1500,
    retry_after_seconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 5,
    verification_secret_configured: Boolean(endpointId || customSecret),
    verification_endpoint_id: endpointId,
    receiver_url: `http://127.0.0.1:${config.port}/api/receiver/ingest`,
  };
}

export function updateReceiverConfig(
  db: HookRelayDB,
  config: AppConfig,
  patch: {
    mode?: ReceiverMode;
    delay_ms?: number;
    retry_after_seconds?: number;
    verification_endpoint_id?: string | null;
    custom_secret?: string | null;
  }
): ReceiverConfig {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO application_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const del = db.prepare('DELETE FROM application_settings WHERE key = ?');

  const tx = db.transaction(() => {
    if (patch.mode && VALID_MODES.includes(patch.mode)) {
      upsert.run(RECEIVER_KEYS.mode, patch.mode, now);
    }
    if (patch.delay_ms !== undefined && Number.isFinite(patch.delay_ms)) {
      upsert.run(RECEIVER_KEYS.delayMs, String(Math.max(100, Math.min(30000, patch.delay_ms))), now);
    }
    if (patch.retry_after_seconds !== undefined && Number.isFinite(patch.retry_after_seconds)) {
      upsert.run(
        RECEIVER_KEYS.retryAfterSeconds,
        String(Math.max(1, Math.min(300, patch.retry_after_seconds))),
        now
      );
    }
    if (patch.verification_endpoint_id !== undefined) {
      if (patch.verification_endpoint_id) {
        upsert.run(RECEIVER_KEYS.verificationEndpointId, patch.verification_endpoint_id, now);
        del.run(RECEIVER_KEYS.customSecret);
      } else {
        del.run(RECEIVER_KEYS.verificationEndpointId);
      }
    }
    if (patch.custom_secret !== undefined) {
      if (patch.custom_secret && patch.custom_secret.trim()) {
        upsert.run(RECEIVER_KEYS.customSecret, patch.custom_secret.trim(), now);
        del.run(RECEIVER_KEYS.verificationEndpointId);
      } else {
        del.run(RECEIVER_KEYS.customSecret);
      }
    }
  });
  tx();

  return getReceiverConfig(db, config);
}

function resolveVerificationSecret(
  db: HookRelayDB,
  deliveryId: string | null
): string | null {
  const endpointSetting = db
    .prepare('SELECT value FROM application_settings WHERE key = ?')
    .get(RECEIVER_KEYS.verificationEndpointId) as { value: string } | undefined;

  if (endpointSetting?.value) {
    const epSecret = getEndpointSecretInternal(db, endpointSetting.value);
    if (epSecret) return epSecret;
  }

  const customSetting = db
    .prepare('SELECT value FROM application_settings WHERE key = ?')
    .get(RECEIVER_KEYS.customSecret) as { value: string } | undefined;
  if (customSetting?.value) {
    return customSetting.value;
  }

  // Fallback: if this delivery came from HookRelay itself, look up the endpoint's secret by delivery_id
  if (deliveryId) {
    const row = db
      .prepare(
        `SELECT ep.signing_secret
         FROM deliveries d
         JOIN endpoints ep ON ep.id = d.endpoint_id
         WHERE d.id = ?`
      )
      .get(deliveryId) as { signing_secret: string } | undefined;
    if (row?.signing_secret) return row.signing_secret;
  }

  return null;
}

export function recordIncomingReceiverRequest(
  db: HookRelayDB,
  config: AppConfig,
  input: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    mode: ReceiverMode;
    responseStatus: number;
  }
): ReceiverRequestLog {
  const getHeader = (name: string): string | null => {
    const target = name.toLowerCase();
    for (const [k, v] of Object.entries(input.headers)) {
      if (k.toLowerCase() === target) {
        return Array.isArray(v) ? v[0] ?? null : v ?? null;
      }
    }
    return null;
  };

  const eventType = getHeader('x-hookrelay-event');
  const eventId = getHeader('x-hookrelay-event-id');
  const deliveryId = getHeader('x-hookrelay-delivery');
  const attemptRaw = getHeader('x-hookrelay-attempt');
  const timestampHeader = getHeader('x-hookrelay-timestamp');
  const signatureHeader = getHeader('x-hookrelay-signature');

  const secret = resolveVerificationSecret(db, deliveryId);
  const settings = getSettings(db, config);

  let signatureValid = false;
  let signatureError: string | null = null;

  if (!secret) {
    signatureValid = false;
    signatureError = 'No verification secret configured on receiver';
  } else if (!signatureHeader) {
    signatureValid = false;
    signatureError = 'Missing X-HookRelay-Signature header';
  } else {
    const result = verifyWebhookSignature(secret, input.rawBody, signatureHeader, {
      toleranceSeconds: settings.signature_tolerance_seconds,
    });
    signatureValid = result.valid;
    signatureError = result.reason ?? null;
  }

  const id = `rcv_${crypto.randomBytes(8).toString('hex')}`;
  const receivedAt = new Date().toISOString();
  const safeHeaders = redactHeaders(input.headers);
  const attemptNumber = attemptRaw && /^\d+$/.test(attemptRaw) ? Number(attemptRaw) : null;

  db.prepare(
    `INSERT INTO receiver_requests (
      id, event_type, event_id, delivery_id, attempt_number,
      timestamp_header, signature_header, signature_valid, signature_error,
      headers, body, response_mode, response_status, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    eventType,
    eventId,
    deliveryId,
    attemptNumber,
    timestampHeader,
    signatureHeader,
    signatureValid ? 1 : 0,
    signatureError,
    JSON.stringify(safeHeaders),
    input.rawBody,
    input.mode,
    input.responseStatus,
    receivedAt
  );

  return {
    id,
    event_type: eventType,
    event_id: eventId,
    delivery_id: deliveryId,
    attempt_number: attemptNumber,
    timestamp_header: timestampHeader,
    signature_header: signatureHeader,
    signature_valid: signatureValid,
    signature_error: signatureError,
    headers: safeHeaders,
    body: input.rawBody,
    response_mode: input.mode,
    response_status: input.responseStatus,
    received_at: receivedAt,
  };
}

export function listReceiverRequests(db: HookRelayDB, limit = 50): ReceiverRequestLog[] {
  const rows = db
    .prepare('SELECT * FROM receiver_requests ORDER BY received_at DESC LIMIT ?')
    .all(Math.min(200, Math.max(1, limit))) as Array<{
    id: string;
    event_type: string | null;
    event_id: string | null;
    delivery_id: string | null;
    attempt_number: number | null;
    timestamp_header: string | null;
    signature_header: string | null;
    signature_valid: number;
    signature_error: string | null;
    headers: string;
    body: string;
    response_mode: ReceiverMode;
    response_status: number;
    received_at: string;
  }>;

  return rows.map((row) => {
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(row.headers);
    } catch {
      headers = {};
    }
    return {
      id: row.id,
      event_type: row.event_type,
      event_id: row.event_id,
      delivery_id: row.delivery_id,
      attempt_number: row.attempt_number,
      timestamp_header: row.timestamp_header,
      signature_header: row.signature_header,
      signature_valid: row.signature_valid === 1,
      signature_error: row.signature_error,
      headers,
      body: row.body,
      response_mode: row.response_mode,
      response_status: row.response_status,
      received_at: row.received_at,
    };
  });
}

export function clearReceiverRequests(db: HookRelayDB): number {
  const res = db.prepare('DELETE FROM receiver_requests').run();
  return res.changes;
}
