import crypto from 'crypto';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { DeliveryRecord, EventRecord } from '../../shared/types.js';
import type { RetryWorker } from '../workers/retryWorker.js';
import { findMatchingEndpoints } from './endpointService.js';
import { getSettings } from './settingsService.js';
import { ApiError } from '../middleware/errorHandler.js';

interface EventRow {
  id: string;
  workspace_id: string;
  type: string;
  payload: string;
  idempotency_key: string | null;
  source: 'api' | 'dashboard' | 'test';
  created_at: string;
}

const VALID_EVENT_TYPE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

function hydrateEventRow(db: HookRelayDB, row: EventRow): EventRecord {
  let parsedPayload: unknown = {};
  try {
    parsedPayload = JSON.parse(row.payload);
  } catch {
    parsedPayload = row.payload;
  }

  const summary = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN status IN ('pending', 'processing', 'retrying') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter
       FROM deliveries
       WHERE event_id = ?`
    )
    .get(row.id) as {
    total: number;
    succeeded: number | null;
    pending: number | null;
    failed: number | null;
    dead_letter: number | null;
  };

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    type: row.type,
    payload: parsedPayload,
    raw_payload: row.payload,
    idempotency_key: row.idempotency_key,
    source: row.source,
    created_at: row.created_at,
    delivery_summary: {
      total: summary?.total ?? 0,
      succeeded: summary?.succeeded ?? 0,
      pending: summary?.pending ?? 0,
      failed: summary?.failed ?? 0,
      dead_letter: summary?.dead_letter ?? 0,
    },
  };
}

export function createEvent(
  db: HookRelayDB,
  config: AppConfig,
  worker: RetryWorker | null,
  input: {
    type: string;
    data: unknown;
    idempotency_key?: string | null;
    source?: 'api' | 'dashboard' | 'test';
    workspace_id?: string;
    target_endpoint_ids?: string[];
  }
): {
  event: EventRecord;
  deliveries_created: number;
  delivery_ids: string[];
  idempotent_replay: boolean;
} {
  const eventType = String(input.type || '').trim();
  if (!VALID_EVENT_TYPE.test(eventType)) {
    throw new ApiError(
      400,
      'INVALID_EVENT_TYPE',
      'Event type must be a dot-separated identifier like "order.created" or "payment.failed"'
    );
  }

  if (input.data === undefined || input.data === null || typeof input.data !== 'object') {
    throw new ApiError(400, 'INVALID_EVENT_DATA', 'Event "data" must be a valid JSON object or array');
  }

  const workspaceId = input.workspace_id || 'default';
  const idempotencyKey = input.idempotency_key?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) {
    throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key cannot exceed 200 characters');
  }

  const normalizedDataJson = JSON.stringify(input.data);
  if (Buffer.byteLength(normalizedDataJson, 'utf8') > config.maxPayloadBytes) {
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Event payload exceeds maximum size of ${config.maxPayloadBytes} bytes`
    );
  }

  const requestHash = crypto
    .createHash('sha256')
    .update(`${eventType}:${normalizedDataJson}`)
    .digest('hex');

  // Check idempotency key inside transaction to avoid duplicate events/deliveries
  const settings = getSettings(db, config);
  const now = new Date().toISOString();

  const txResult = db.transaction(() => {
    if (idempotencyKey) {
      const existingKey = db
        .prepare('SELECT event_id, request_hash FROM idempotency_keys WHERE key = ?')
        .get(idempotencyKey) as { event_id: string; request_hash: string } | undefined;

      if (existingKey) {
        if (existingKey.request_hash !== requestHash) {
          throw new ApiError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was already used with a different event type or payload'
          );
        }
        const existingEventRow = db
          .prepare('SELECT * FROM events WHERE id = ?')
          .get(existingKey.event_id) as EventRow | undefined;

        if (existingEventRow) {
          const existingDeliveries = db
            .prepare('SELECT id FROM deliveries WHERE event_id = ? AND is_replay = 0')
            .all(existingEventRow.id) as Array<{ id: string }>;

          return {
            eventRow: existingEventRow,
            deliveryIds: existingDeliveries.map((d) => d.id),
            idempotentReplay: true,
          };
        }
      }
    }

    const eventId = `evt_${crypto.randomBytes(8).toString('hex')}`;
    const fullEnvelope = JSON.stringify({
      id: eventId,
      type: eventType,
      created_at: now,
      data: input.data,
    });

    db.prepare(
      `INSERT INTO events (id, workspace_id, type, payload, idempotency_key, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      workspaceId,
      eventType,
      fullEnvelope,
      idempotencyKey,
      input.source ?? 'api',
      now
    );

    if (idempotencyKey) {
      db.prepare(
        `INSERT INTO idempotency_keys (key, workspace_id, event_id, request_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(idempotencyKey, workspaceId, eventId, requestHash, now);
    }

    let endpointsToDeliver: Array<{ id: string }> = [];
    if (input.target_endpoint_ids && input.target_endpoint_ids.length > 0) {
      const placeholders = input.target_endpoint_ids.map(() => '?').join(',');
      endpointsToDeliver = db
        .prepare(`SELECT id FROM endpoints WHERE id IN (${placeholders})`)
        .all(...input.target_endpoint_ids) as Array<{ id: string }>;
    } else {
      endpointsToDeliver = findMatchingEndpoints(db, eventType, workspaceId);
    }

    const insertDelivery = db.prepare(
      `INSERT INTO deliveries (
        id, workspace_id, event_id, endpoint_id, replay_of_delivery_id, is_replay,
        status, attempt_count, max_attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 0, 'pending', 0, ?, ?, ?, ?)`
    );

    const deliveryIds: string[] = [];
    for (const ep of endpointsToDeliver) {
      const delId = `del_${crypto.randomBytes(8).toString('hex')}`;
      insertDelivery.run(
        delId,
        workspaceId,
        eventId,
        ep.id,
        settings.max_attempts,
        now,
        now,
        now
      );
      deliveryIds.push(delId);
    }

    const eventRow = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(eventId) as EventRow;

    return {
      eventRow,
      deliveryIds,
      idempotentReplay: false,
    };
  })();

  if (!txResult.idempotentReplay && txResult.deliveryIds.length > 0 && worker) {
    worker.wakeUp();
  }

  return {
    event: hydrateEventRow(db, txResult.eventRow),
    deliveries_created: txResult.idempotentReplay ? 0 : txResult.deliveryIds.length,
    delivery_ids: txResult.deliveryIds,
    idempotent_replay: txResult.idempotentReplay,
  };
}

export function listEvents(
  db: HookRelayDB,
  options: {
    workspace_id?: string;
    type?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}
): { data: EventRecord[]; total: number; page: number; limit: number } {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (options.workspace_id) {
    where.push('workspace_id = ?');
    params.push(options.workspace_id);
  }
  if (options.type && options.type.trim()) {
    where.push('type = ?');
    params.push(options.type.trim());
  }
  if (options.search && options.search.trim()) {
    where.push('(id LIKE ? OR type LIKE ? OR payload LIKE ? OR idempotency_key LIKE ?)');
    const q = `%${options.search.trim()}%`;
    params.push(q, q, q, q);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM events ${whereSql}`)
    .get(...params) as { count: number };

  const rows = db
    .prepare(`SELECT * FROM events ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as EventRow[];

  return {
    data: rows.map((row) => hydrateEventRow(db, row)),
    total: countRow.count,
    page,
    limit,
  };
}

export function getEventById(
  db: HookRelayDB,
  id: string
): { event: EventRecord; deliveries: DeliveryRecord[] } | null {
  const row = db
    .prepare('SELECT * FROM events WHERE id = ?')
    .get(id) as EventRow | undefined;
  if (!row) return null;

  const deliveryRows = db
    .prepare(
      `SELECT
         d.*,
         ev.type AS event_type,
         ep.name AS endpoint_name,
         ep.url AS endpoint_url
       FROM deliveries d
       JOIN events ev ON ev.id = d.event_id
       JOIN endpoints ep ON ep.id = d.endpoint_id
       WHERE d.event_id = ?
       ORDER BY d.created_at DESC`
    )
    .all(id) as Array<
    Omit<DeliveryRecord, 'is_replay' | 'dlq_archived'> & {
      is_replay: number;
      dlq_archived: number;
    }
  >;

  return {
    event: hydrateEventRow(db, row),
    deliveries: deliveryRows.map((d) => ({
      ...d,
      is_replay: d.is_replay === 1,
      dlq_archived: d.dlq_archived === 1,
    })),
  };
}

export function replayEventToEndpoints(
  db: HookRelayDB,
  config: AppConfig,
  worker: RetryWorker | null,
  eventId: string,
  endpointIds: string[]
): { event_id: string; replayed_delivery_ids: string[] } {
  const eventRow = db
    .prepare('SELECT * FROM events WHERE id = ?')
    .get(eventId) as EventRow | undefined;
  if (!eventRow) {
    throw new ApiError(404, 'EVENT_NOT_FOUND', `Event "${eventId}" not found`);
  }

  if (!Array.isArray(endpointIds) || endpointIds.length === 0) {
    throw new ApiError(400, 'ENDPOINTS_REQUIRED', 'Select at least one endpoint to replay the event to');
  }

  const uniqueEndpointIds = Array.from(new Set(endpointIds));
  const placeholders = uniqueEndpointIds.map(() => '?').join(',');
  const endpoints = db
    .prepare(`SELECT id FROM endpoints WHERE id IN (${placeholders})`)
    .all(...uniqueEndpointIds) as Array<{ id: string }>;

  if (endpoints.length === 0) {
    throw new ApiError(404, 'ENDPOINTS_NOT_FOUND', 'None of the selected endpoints exist');
  }

  const settings = getSettings(db, config);
  const now = new Date().toISOString();

  const replayedIds = db.transaction(() => {
    const ids: string[] = [];
    const findOriginal = db.prepare(
      'SELECT id FROM deliveries WHERE event_id = ? AND endpoint_id = ? AND is_replay = 0 LIMIT 1'
    );
    const insertDelivery = db.prepare(
      `INSERT INTO deliveries (
        id, workspace_id, event_id, endpoint_id, replay_of_delivery_id, is_replay,
        status, attempt_count, max_attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'pending', 0, ?, ?, ?, ?)`
    );

    for (const ep of endpoints) {
      const original = findOriginal.get(eventId, ep.id) as { id: string } | undefined;
      const newDelId = `del_${crypto.randomBytes(8).toString('hex')}`;
      insertDelivery.run(
        newDelId,
        eventRow.workspace_id,
        eventId,
        ep.id,
        original?.id ?? null,
        settings.max_attempts,
        now,
        now,
        now
      );
      ids.push(newDelId);
    }
    return ids;
  })();

  if (replayedIds.length > 0 && worker) {
    worker.wakeUp();
  }

  return {
    event_id: eventId,
    replayed_delivery_ids: replayedIds,
  };
}
