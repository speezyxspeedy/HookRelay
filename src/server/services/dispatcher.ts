import crypto from 'crypto';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { AttemptOutcome, DeliveryStatus, RetrySettings } from '../../shared/types.js';
import { buildSignatureHeader } from '../security/hmac.js';
import { validateDestinationUrl } from '../security/urlValidator.js';
import { redactHeaders, sanitizeErrorMessage } from '../security/redaction.js';
import { getSettings } from './settingsService.js';

export function calculateBackoffDelay(
  attemptNumber: number,
  initialDelayMs: number,
  maxDelayMs: number
): number {
  const exponent = Math.max(0, attemptNumber - 1);
  const raw = initialDelayMs * Math.pow(2, exponent);
  return Math.min(Math.round(raw), maxDelayMs);
}

export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  maxDelayMs: number
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, maxDelayMs);
    }
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    const diff = parsedDate - Date.now();
    if (diff > 0) {
      return Math.min(diff, maxDelayMs);
    }
  }

  return null;
}

export function classifyHttpStatus(
  status: number,
  settings: Pick<RetrySettings, 'retry_on_408' | 'retry_on_429'>
): AttemptOutcome {
  if (status >= 200 && status < 300) {
    return 'succeeded';
  }
  if (status === 408 && settings.retry_on_408) {
    return 'retryable_failure';
  }
  if (status === 429 && settings.retry_on_429) {
    return 'retryable_failure';
  }
  if (status >= 500 && status < 600) {
    return 'retryable_failure';
  }
  // 3xx redirects (not followed) and non-retryable 4xx are permanent failures
  return 'permanent_failure';
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      if (totalBytes + value.byteLength > maxBytes) {
        const remaining = maxBytes - totalBytes;
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          totalBytes += remaining;
        }
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } catch {
    // Ignore stream cancellation errors after reading up to limit
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(combined);
  return truncated ? `${decoded}\n...[truncated at ${maxBytes} bytes]` : decoded;
}

interface DeliveryJoinRow {
  delivery_id: string;
  event_id: string;
  endpoint_id: string;
  attempt_count: number;
  max_attempts: number;
  total_duration_ms: number;
  event_type: string;
  event_payload: string;
  endpoint_url: string;
  endpoint_signing_secret: string;
  endpoint_enabled: number;
}

export async function executeDeliveryAttempt(
  db: HookRelayDB,
  config: AppConfig,
  deliveryId: string
): Promise<{ status: DeliveryStatus; attemptNumber: number }> {
  const row = db
    .prepare(
      `SELECT
         d.id AS delivery_id,
         d.event_id,
         d.endpoint_id,
         d.attempt_count,
         d.max_attempts,
         d.total_duration_ms,
         ev.type AS event_type,
         ev.payload AS event_payload,
         ep.url AS endpoint_url,
         ep.signing_secret AS endpoint_signing_secret,
         ep.enabled AS endpoint_enabled
       FROM deliveries d
       JOIN events ev ON ev.id = d.event_id
       JOIN endpoints ep ON ep.id = d.endpoint_id
       WHERE d.id = ?`
    )
    .get(deliveryId) as DeliveryJoinRow | undefined;

  if (!row) {
    return { status: 'failed', attemptNumber: 0 };
  }

  const settings = getSettings(db, config);
  const attemptNumber = row.attempt_count + 1;
  const rawBody = row.event_payload;
  const attemptId = `att_${crypto.randomBytes(8).toString('hex')}`;
  const startedAt = Date.now();
  const attemptTimestampIso = new Date(startedAt).toISOString();

  // Sign exact raw request body
  const { timestamp, signatureHeader } = buildSignatureHeader(
    row.endpoint_signing_secret,
    rawBody
  );

  const outboundHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'HookRelay-Dispatcher/1.0',
    'X-HookRelay-Event': row.event_type,
    'X-HookRelay-Event-Id': row.event_id,
    'X-HookRelay-Delivery': row.delivery_id,
    'X-HookRelay-Timestamp': timestamp,
    'X-HookRelay-Signature': signatureHeader,
    'X-HookRelay-Attempt': String(attemptNumber),
  };

  let responseStatus: number | null = null;
  let responseHeaders: Record<string, string> | null = null;
  let responseBody: string | null = null;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let outcome: AttemptOutcome = 'retryable_failure';
  let retryAfterHeader: string | null = null;

  // Re-validate destination URL & DNS right before outbound network call (mitigates DNS rebinding / SSRF)
  const urlCheck = await validateDestinationUrl(row.endpoint_url, {
    allowLocalhost: settings.allow_localhost_webhooks,
  });

  if (!urlCheck.valid) {
    outcome = 'permanent_failure';
    errorCode = 'SSRF_BLOCKED';
    errorMessage = urlCheck.error || 'Destination URL blocked by security policy';
  } else {
    const controller = new AbortController();
    const timeoutMs = Math.max(500, Math.min(settings.request_timeout_ms, 60000));
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(row.endpoint_url, {
        method: 'POST',
        headers: outboundHeaders,
        body: rawBody,
        redirect: 'manual',
        signal: controller.signal,
      });

      responseStatus = response.status;
      const rawRespHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        rawRespHeaders[key] = value;
      });
      responseHeaders = redactHeaders(rawRespHeaders);
      retryAfterHeader = response.headers.get('retry-after');
      responseBody = await readBoundedText(response, config.maxResponseBytes);

      if (responseStatus >= 300 && responseStatus < 400) {
        outcome = 'permanent_failure';
        errorCode = 'REDIRECT_BLOCKED';
        errorMessage = `HTTP ${responseStatus} redirect rejected (redirects are not followed automatically)`;
      } else {
        outcome = classifyHttpStatus(responseStatus, settings);
        if (outcome !== 'succeeded') {
          errorCode = `HTTP_${responseStatus}`;
          errorMessage = `Endpoint responded with HTTP ${responseStatus}`;
        }
      }
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.name === 'TimeoutError');
      if (isAbort) {
        errorCode = 'REQUEST_TIMEOUT';
        errorMessage = `Request timed out after ${timeoutMs}ms`;
      } else {
        errorCode = 'CONNECTION_ERROR';
        errorMessage = sanitizeErrorMessage(err);
      }
      outcome = 'retryable_failure';
    } finally {
      clearTimeout(timer);
    }
  }

  const latencyMs = Math.max(1, Date.now() - startedAt);
  const nowIso = new Date().toISOString();
  const totalDurationMs = row.total_duration_ms + latencyMs;

  let nextStatus: DeliveryStatus;
  let nextAttemptAt: string | null = null;
  let completedAt: string | null = null;

  if (outcome === 'succeeded') {
    nextStatus = 'succeeded';
    completedAt = nowIso;
  } else if (outcome === 'permanent_failure') {
    nextStatus = 'dead_letter';
    completedAt = nowIso;
  } else if (attemptNumber >= row.max_attempts) {
    nextStatus = 'dead_letter';
    completedAt = nowIso;
    if (!errorMessage) {
      errorMessage = `Exhausted all ${row.max_attempts} delivery attempts`;
    }
  } else {
    nextStatus = 'retrying';
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader, settings.max_delay_ms);
    const delayMs =
      retryAfterMs !== null
        ? retryAfterMs
        : calculateBackoffDelay(
            attemptNumber,
            settings.initial_delay_ms,
            settings.max_delay_ms
          );
    nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO delivery_attempts (
        id, delivery_id, attempt_number, request_url, request_method,
        request_headers, request_body, response_status, response_headers,
        response_body, latency_ms, error_code, error_message, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      attemptId,
      row.delivery_id,
      attemptNumber,
      row.endpoint_url,
      'POST',
      JSON.stringify(redactHeaders(outboundHeaders)),
      rawBody,
      responseStatus,
      responseHeaders ? JSON.stringify(responseHeaders) : null,
      responseBody,
      latencyMs,
      errorCode,
      errorMessage,
      outcome,
      attemptTimestampIso
    );

    db.prepare(
      `UPDATE deliveries
       SET status = ?,
           attempt_count = ?,
           next_attempt_at = ?,
           locked_at = NULL,
           locked_by = NULL,
           last_http_status = ?,
           last_error = ?,
           last_latency_ms = ?,
           total_duration_ms = ?,
           last_attempt_at = ?,
           completed_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      nextStatus,
      attemptNumber,
      nextAttemptAt,
      responseStatus,
      errorMessage,
      latencyMs,
      totalDurationMs,
      attemptTimestampIso,
      completedAt,
      nowIso,
      row.delivery_id
    );

    db.prepare(
      `UPDATE endpoints
       SET last_delivery_status = ?, last_delivery_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, attemptTimestampIso, nowIso, row.endpoint_id);
  });

  tx();

  return { status: nextStatus, attemptNumber };
}
