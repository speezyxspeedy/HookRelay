import crypto from 'crypto';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type {
  DeliveryAttemptRecord,
  DeliveryDetail,
  DeliveryRecord,
  DeliveryStatus,
} from '../../shared/types.js';
import type { RetryWorker } from '../workers/retryWorker.js';
import { getSettings } from './settingsService.js';
import { ApiError } from '../middleware/errorHandler.js';

interface RawDeliveryRow {
  id: string;
  workspace_id: string;
  event_id: string;
  event_type: string;
  endpoint_id: string;
  endpoint_name: string;
  endpoint_url: string;
  replay_of_delivery_id: string | null;
  is_replay: number;
  status: DeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_http_status: number | null;
  last_error: string | null;
  last_latency_ms: number | null;
  total_duration_ms: number;
  last_attempt_at: string | null;
  completed_at: string | null;
  dlq_archived: number;
  dlq_archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RawAttemptRow {
  id: string;
  delivery_id: string;
  attempt_number: number;
  request_url: string;
  request_method: string;
  request_headers: string;
  request_body: string;
  response_status: number | null;
  response_headers: string | null;
  response_body: string | null;
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
  outcome: DeliveryAttemptRecord['outcome'];
  created_at: string;
}

function mapDeliveryRow(row: RawDeliveryRow): DeliveryRecord {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    event_id: row.event_id,
    event_type: row.event_type,
    endpoint_id: row.endpoint_id,
    endpoint_name: row.endpoint_name,
    endpoint_url: row.endpoint_url,
    replay_of_delivery_id: row.replay_of_delivery_id,
    is_replay: row.is_replay === 1,
    status: row.status,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    next_attempt_at: row.next_attempt_at,
    last_http_status: row.last_http_status,
    last_error: row.last_error,
    last_latency_ms: row.last_latency_ms,
    total_duration_ms: row.total_duration_ms,
    last_attempt_at: row.last_attempt_at,
    completed_at: row.completed_at,
    dlq_archived: row.dlq_archived === 1,
    dlq_archived_at: row.dlq_archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapAttemptRow(row: RawAttemptRow): DeliveryAttemptRecord {
  let reqHeaders: Record<string, string> = {};
  let respHeaders: Record<string, string> | null = null;
  try {
    reqHeaders = JSON.parse(row.request_headers);
  } catch {
    reqHeaders = {};
  }
  if (row.response_headers) {
    try {
      respHeaders = JSON.parse(row.response_headers);
    } catch {
      respHeaders = null;
    }
  }

  return {
    id: row.id,
    delivery_id: row.delivery_id,
    attempt_number: row.attempt_number,
    request_url: row.request_url,
    request_method: row.request_method,
    request_headers: reqHeaders,
    request_body: row.request_body,
    response_status: row.response_status,
    response_headers: respHeaders,
    response_body: row.response_body,
    latency_ms: row.latency_ms,
    error_code: row.error_code,
    error_message: row.error_message,
    outcome: row.outcome,
    created_at: row.created_at,
  };
}

export function listDeliveries(
  db: HookRelayDB,
  options: {
    workspace_id?: string;
    status?: string;
    endpoint_id?: string;
    event_id?: string;
    search?: string;
    is_replay?: boolean;
    dlq_only?: boolean;
    include_archived?: boolean;
    page?: number;
    limit?: number;
  } = {}
): { data: DeliveryRecord[]; total: number; page: number; limit: number } {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (options.workspace_id) {
    where.push('d.workspace_id = ?');
    params.push(options.workspace_id);
  }
  if (options.dlq_only) {
    where.push("d.status = 'dead_letter'");
    if (!options.include_archived) {
      where.push('d.dlq_archived = 0');
    }
  } else if (options.status && options.status !== 'all') {
    const statuses = options.status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      where.push('d.status = ?');
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      where.push(`d.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
  }
  if (options.endpoint_id) {
    where.push('d.endpoint_id = ?');
    params.push(options.endpoint_id);
  }
  if (options.event_id) {
    where.push('d.event_id = ?');
    params.push(options.event_id);
  }
  if (options.is_replay !== undefined) {
    where.push('d.is_replay = ?');
    params.push(options.is_replay ? 1 : 0);
  }
  if (options.search && options.search.trim()) {
    where.push('(d.id LIKE ? OR d.event_id LIKE ? OR ev.type LIKE ? OR ep.name LIKE ? OR ep.url LIKE ?)');
    const q = `%${options.search.trim()}%`;
    params.push(q, q, q, q, q);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const baseJoins = `
    FROM deliveries d
    JOIN events ev ON ev.id = d.event_id
    JOIN endpoints ep ON ep.id = d.endpoint_id
  `;

  const countRow = db
    .prepare(`SELECT COUNT(*) AS count ${baseJoins} ${whereSql}`)
    .get(...params) as { count: number };

  const orderClause =
    options.status === 'retrying'
      ? 'ORDER BY COALESCE(d.next_attempt_at, d.created_at) ASC'
      : 'ORDER BY d.created_at DESC';

  const rows = db
    .prepare(
      `SELECT
         d.*,
         ev.type AS event_type,
         ep.name AS endpoint_name,
         ep.url AS endpoint_url
       ${baseJoins}
       ${whereSql}
       ${orderClause}
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as RawDeliveryRow[];

  return {
    data: rows.map(mapDeliveryRow),
    total: countRow.count,
    page,
    limit,
  };
}

export function getDeliveryDetail(db: HookRelayDB, id: string): DeliveryDetail | null {
  const row = db
    .prepare(
      `SELECT
         d.*,
         ev.type AS event_type,
         ev.payload AS event_raw_payload,
         ep.name AS endpoint_name,
         ep.url AS endpoint_url
       FROM deliveries d
       JOIN events ev ON ev.id = d.event_id
       JOIN endpoints ep ON ep.id = d.endpoint_id
       WHERE d.id = ?`
    )
    .get(id) as (RawDeliveryRow & { event_raw_payload: string }) | undefined;

  if (!row) return null;

  const attempts = getDeliveryAttempts(db, id);
  let parsedPayload: unknown = {};
  try {
    parsedPayload = JSON.parse(row.event_raw_payload);
  } catch {
    parsedPayload = row.event_raw_payload;
  }

  return {
    ...mapDeliveryRow(row),
    event_payload: parsedPayload,
    event_raw_payload: row.event_raw_payload,
    attempts,
  };
}

export function getDeliveryAttempts(db: HookRelayDB, deliveryId: string): DeliveryAttemptRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM delivery_attempts
       WHERE delivery_id = ?
       ORDER BY attempt_number ASC`
    )
    .all(deliveryId) as RawAttemptRow[];

  return rows.map(mapAttemptRow);
}

export function triggerManualRetry(
  db: HookRelayDB,
  worker: RetryWorker | null,
  deliveryId: string
): DeliveryRecord {
  const row = db
    .prepare('SELECT id, status, attempt_count, max_attempts FROM deliveries WHERE id = ?')
    .get(deliveryId) as
    | { id: string; status: DeliveryStatus; attempt_count: number; max_attempts: number }
    | undefined;

  if (!row) {
    throw new ApiError(404, 'DELIVERY_NOT_FOUND', `Delivery "${deliveryId}" not found`);
  }

  if (row.status === 'processing') {
    throw new ApiError(409, 'DELIVERY_IN_PROGRESS', 'Delivery is currently being processed');
  }
  if (row.status === 'succeeded') {
    throw new ApiError(
      409,
      'DELIVERY_ALREADY_SUCCEEDED',
      'Delivery already succeeded. Use Event Replay to dispatch a fresh copy.'
    );
  }

  const now = new Date().toISOString();
  // If delivery exhausted max_attempts, allow one more manual attempt without deleting history
  const nextMaxAttempts =
    row.attempt_count >= row.max_attempts ? row.attempt_count + 1 : row.max_attempts;

  db.prepare(
    `UPDATE deliveries
     SET status = 'retrying',
         max_attempts = ?,
         next_attempt_at = ?,
         locked_at = NULL,
         locked_by = NULL,
         completed_at = NULL,
         updated_at = ?
     WHERE id = ?`
  ).run(nextMaxAttempts, now, now, deliveryId);

  if (worker) {
    worker.wakeUp();
  }

  const updated = getDeliveryDetail(db, deliveryId);
  if (!updated) {
    throw new ApiError(500, 'RETRY_FAILED', 'Failed to reload delivery after scheduling retry');
  }
  return updated;
}

export function replayDeadLetter(
  db: HookRelayDB,
  config: AppConfig,
  worker: RetryWorker | null,
  deadLetterDeliveryId: string
): DeliveryRecord {
  const original = db
    .prepare('SELECT * FROM deliveries WHERE id = ?')
    .get(deadLetterDeliveryId) as
    | {
        id: string;
        workspace_id: string;
        event_id: string;
        endpoint_id: string;
        status: DeliveryStatus;
      }
    | undefined;

  if (!original) {
    throw new ApiError(404, 'DEAD_LETTER_NOT_FOUND', `Dead letter "${deadLetterDeliveryId}" not found`);
  }

  if (original.status !== 'dead_letter' && original.status !== 'failed') {
    throw new ApiError(
      409,
      'NOT_IN_DEAD_LETTER',
      'Only dead-letter or failed deliveries can be replayed from the Dead Letter Queue'
    );
  }

  const settings = getSettings(db, config);
  const newDeliveryId = `del_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();

  // Create a brand new delivery execution while preserving the original DLQ record & all its attempts
  db.prepare(
    `INSERT INTO deliveries (
      id, workspace_id, event_id, endpoint_id, replay_of_delivery_id, is_replay,
      status, attempt_count, max_attempts, next_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'pending', 0, ?, ?, ?, ?)`
  ).run(
    newDeliveryId,
    original.workspace_id,
    original.event_id,
    original.endpoint_id,
    original.id,
    settings.max_attempts,
    now,
    now,
    now
  );

  if (worker) {
    worker.wakeUp();
  }

  const detail = getDeliveryDetail(db, newDeliveryId);
  if (!detail) {
    throw new ApiError(500, 'DLQ_REPLAY_FAILED', 'Failed to load replayed delivery');
  }
  return detail;
}

export function archiveDeadLetter(db: HookRelayDB, deadLetterDeliveryId: string): DeliveryRecord {
  const existing = db
    .prepare("SELECT id FROM deliveries WHERE id = ? AND status = 'dead_letter'")
    .get(deadLetterDeliveryId) as { id: string } | undefined;

  if (!existing) {
    throw new ApiError(404, 'DEAD_LETTER_NOT_FOUND', `Dead letter "${deadLetterDeliveryId}" not found`);
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE deliveries
     SET dlq_archived = 1, dlq_archived_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, now, deadLetterDeliveryId);

  const detail = getDeliveryDetail(db, deadLetterDeliveryId);
  if (!detail) {
    throw new ApiError(500, 'ARCHIVE_FAILED', 'Failed to load archived dead letter');
  }
  return detail;
}
