import crypto from 'crypto';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { EndpointRecord, EndpointWithSecret, DeliveryStatus } from '../../shared/types.js';
import { generateSigningSecret } from '../security/hmac.js';
import { maskSecret } from '../security/redaction.js';
import { validateDestinationUrl } from '../security/urlValidator.js';
import { getSettings } from './settingsService.js';
import { ApiError } from '../middleware/errorHandler.js';

interface EndpointRow {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  description: string;
  subscribed_events: string;
  signing_secret: string;
  secret_preview: string;
  enabled: number;
  last_delivery_status: DeliveryStatus | null;
  last_delivery_at: string | null;
  created_at: string;
  updated_at: string;
}

const EVENT_TYPE_PATTERN = /^(\*|[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}(\.\*)?)$/;

export function validateEventTypes(events: string[]): string[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new ApiError(400, 'INVALID_SUBSCRIPTIONS', 'At least one subscribed event type is required');
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of events) {
    const trimmed = String(raw || '').trim();
    if (!EVENT_TYPE_PATTERN.test(trimmed)) {
      throw new ApiError(
        400,
        'INVALID_EVENT_TYPE',
        `Invalid event subscription "${trimmed}". Use dot-separated identifiers (e.g. "order.created", "order.*", or "*").`
      );
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }
  return normalized;
}

export function eventMatchesSubscription(eventType: string, subscribedEvents: string[]): boolean {
  for (const pattern of subscribedEvents) {
    if (pattern === '*') return true;
    if (pattern === eventType) return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -1); // includes trailing dot
      if (eventType.startsWith(prefix)) return true;
    }
  }
  return false;
}

function hydrateEndpointRow(db: HookRelayDB, row: EndpointRow): EndpointRecord {
  let parsedEvents: string[] = [];
  try {
    parsedEvents = JSON.parse(row.subscribed_events);
  } catch {
    parsedEvents = [];
  }

  const statRow = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) AS failed,
         AVG(last_latency_ms) AS avg_latency
       FROM deliveries
       WHERE endpoint_id = ?`
    )
    .get(row.id) as {
    total: number;
    succeeded: number | null;
    failed: number | null;
    avg_latency: number | null;
  };

  const total = statRow?.total ?? 0;
  const succeeded = statRow?.succeeded ?? 0;
  const failed = statRow?.failed ?? 0;
  const terminal = succeeded + failed;

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    url: row.url,
    description: row.description,
    subscribed_events: parsedEvents,
    secret_preview: row.secret_preview,
    enabled: row.enabled === 1,
    last_delivery_status: row.last_delivery_status,
    last_delivery_at: row.last_delivery_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stats: {
      total_deliveries: total,
      succeeded_deliveries: succeeded,
      failed_deliveries: failed,
      success_rate: terminal > 0 ? Math.round((succeeded / terminal) * 1000) / 10 : null,
      avg_latency_ms: statRow?.avg_latency !== null && statRow?.avg_latency !== undefined
        ? Math.round(statRow.avg_latency)
        : null,
    },
  };
}

export async function createEndpoint(
  db: HookRelayDB,
  config: AppConfig,
  input: {
    name: string;
    url: string;
    description?: string;
    subscribed_events: string[];
    enabled?: boolean;
    workspace_id?: string;
  }
): Promise<EndpointWithSecret> {
  const settings = getSettings(db, config);
  const urlCheck = await validateDestinationUrl(input.url, {
    allowLocalhost: settings.allow_localhost_webhooks,
  });
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    throw new ApiError(400, 'INVALID_DESTINATION_URL', urlCheck.error || 'Invalid destination URL');
  }

  const events = validateEventTypes(input.subscribed_events);
  const id = `ep_${crypto.randomBytes(8).toString('hex')}`;
  const signingSecret = generateSigningSecret();
  const secretPreview = maskSecret(signingSecret);
  const now = new Date().toISOString();
  const workspaceId = input.workspace_id || 'default';

  db.prepare(
    `INSERT INTO endpoints (
      id, workspace_id, name, url, description, subscribed_events,
      signing_secret, secret_preview, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    workspaceId,
    input.name.trim(),
    urlCheck.normalizedUrl,
    (input.description || '').trim(),
    JSON.stringify(events),
    signingSecret,
    secretPreview,
    input.enabled === false ? 0 : 1,
    now,
    now
  );

  const created = getEndpointById(db, id);
  if (!created) {
    throw new ApiError(500, 'ENDPOINT_CREATE_FAILED', 'Failed to retrieve created endpoint');
  }
  return {
    ...created,
    signing_secret: signingSecret,
  };
}

export function listEndpoints(
  db: HookRelayDB,
  options: {
    workspace_id?: string;
    enabled?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  } = {}
): { data: EndpointRecord[]; total: number; page: number; limit: number } {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (options.workspace_id) {
    where.push('workspace_id = ?');
    params.push(options.workspace_id);
  }
  if (options.enabled !== undefined) {
    where.push('enabled = ?');
    params.push(options.enabled ? 1 : 0);
  }
  if (options.search && options.search.trim()) {
    where.push('(name LIKE ? OR url LIKE ? OR subscribed_events LIKE ?)');
    const q = `%${options.search.trim()}%`;
    params.push(q, q, q);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM endpoints ${whereSql}`)
    .get(...params) as { count: number };

  const rows = db
    .prepare(
      `SELECT * FROM endpoints ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as EndpointRow[];

  return {
    data: rows.map((row) => hydrateEndpointRow(db, row)),
    total: countRow.count,
    page,
    limit,
  };
}

export function getEndpointById(db: HookRelayDB, id: string): EndpointRecord | null {
  const row = db
    .prepare('SELECT * FROM endpoints WHERE id = ?')
    .get(id) as EndpointRow | undefined;
  if (!row) return null;
  return hydrateEndpointRow(db, row);
}

export function getEndpointSecretInternal(db: HookRelayDB, id: string): string | null {
  const row = db
    .prepare('SELECT signing_secret FROM endpoints WHERE id = ?')
    .get(id) as { signing_secret: string } | undefined;
  return row?.signing_secret ?? null;
}

export async function updateEndpoint(
  db: HookRelayDB,
  config: AppConfig,
  id: string,
  patch: {
    name?: string;
    url?: string;
    description?: string;
    subscribed_events?: string[];
    enabled?: boolean;
  }
): Promise<EndpointRecord> {
  const existing = db
    .prepare('SELECT * FROM endpoints WHERE id = ?')
    .get(id) as EndpointRow | undefined;
  if (!existing) {
    throw new ApiError(404, 'ENDPOINT_NOT_FOUND', `Endpoint "${id}" not found`);
  }

  let nextUrl = existing.url;
  if (patch.url !== undefined && patch.url !== existing.url) {
    const settings = getSettings(db, config);
    const urlCheck = await validateDestinationUrl(patch.url, {
      allowLocalhost: settings.allow_localhost_webhooks,
    });
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      throw new ApiError(400, 'INVALID_DESTINATION_URL', urlCheck.error || 'Invalid destination URL');
    }
    nextUrl = urlCheck.normalizedUrl;
  }

  const nextEvents =
    patch.subscribed_events !== undefined
      ? JSON.stringify(validateEventTypes(patch.subscribed_events))
      : existing.subscribed_events;

  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
  const nextDesc = patch.description !== undefined ? patch.description.trim() : existing.description;
  const nextEnabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE endpoints
     SET name = ?, url = ?, description = ?, subscribed_events = ?, enabled = ?, updated_at = ?
     WHERE id = ?`
  ).run(nextName, nextUrl, nextDesc, nextEvents, nextEnabled, now, id);

  const updated = getEndpointById(db, id);
  if (!updated) {
    throw new ApiError(500, 'ENDPOINT_UPDATE_FAILED', 'Failed to load updated endpoint');
  }
  return updated;
}

export function deleteEndpoint(db: HookRelayDB, id: string): void {
  const result = db.prepare('DELETE FROM endpoints WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new ApiError(404, 'ENDPOINT_NOT_FOUND', `Endpoint "${id}" not found`);
  }
}

export function rotateEndpointSecret(db: HookRelayDB, id: string): EndpointWithSecret {
  const existing = db
    .prepare('SELECT id FROM endpoints WHERE id = ?')
    .get(id) as { id: string } | undefined;
  if (!existing) {
    throw new ApiError(404, 'ENDPOINT_NOT_FOUND', `Endpoint "${id}" not found`);
  }

  const nextSecret = generateSigningSecret();
  const nextPreview = maskSecret(nextSecret);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE endpoints SET signing_secret = ?, secret_preview = ?, updated_at = ? WHERE id = ?`
  ).run(nextSecret, nextPreview, now, id);

  const updated = getEndpointById(db, id);
  if (!updated) {
    throw new ApiError(500, 'SECRET_ROTATION_FAILED', 'Failed to retrieve endpoint after secret rotation');
  }

  return {
    ...updated,
    signing_secret: nextSecret,
  };
}

export function revealEndpointSecret(db: HookRelayDB, id: string): { id: string; signing_secret: string } {
  const row = db
    .prepare('SELECT id, signing_secret FROM endpoints WHERE id = ?')
    .get(id) as { id: string; signing_secret: string } | undefined;
  if (!row) {
    throw new ApiError(404, 'ENDPOINT_NOT_FOUND', `Endpoint "${id}" not found`);
  }
  return row;
}

export function findMatchingEndpoints(
  db: HookRelayDB,
  eventType: string,
  workspaceId = 'default'
): EndpointRow[] {
  const rows = db
    .prepare('SELECT * FROM endpoints WHERE workspace_id = ? AND enabled = 1')
    .all(workspaceId) as EndpointRow[];

  return rows.filter((row) => {
    try {
      const subs = JSON.parse(row.subscribed_events) as string[];
      return eventMatchesSubscription(eventType, subs);
    } catch {
      return false;
    }
  });
}
