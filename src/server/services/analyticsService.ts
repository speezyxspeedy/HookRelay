import type { HookRelayDB } from '../database/db.js';
import type {
  DeliveryAnalyticsResponse,
  DeliveryStatus,
  OverviewAnalytics,
} from '../../shared/types.js';
import { listEvents } from './eventService.js';
import { listDeliveries } from './deliveryService.js';

const ALL_STATUSES: DeliveryStatus[] = [
  'succeeded',
  'retrying',
  'pending',
  'processing',
  'failed',
  'dead_letter',
];

export function getOverviewAnalytics(
  db: HookRelayDB,
  workspaceId = 'default'
): OverviewAnalytics {
  const eventsCount = (
    db
      .prepare('SELECT COUNT(*) AS count FROM events WHERE workspace_id = ?')
      .get(workspaceId) as { count: number }
  ).count;

  const delStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('pending', 'retrying', 'processing') THEN 1 ELSE 0 END) AS pending_retries,
         SUM(CASE WHEN status = 'dead_letter' AND dlq_archived = 0 THEN 1 ELSE 0 END) AS dead_letter_count
       FROM deliveries
       WHERE workspace_id = ?`
    )
    .get(workspaceId) as {
    total: number;
    succeeded: number | null;
    failed: number | null;
    pending_retries: number | null;
    dead_letter_count: number | null;
  };

  const avgLatencyRow = db
    .prepare(
      `SELECT AVG(da.latency_ms) AS avg_ms
       FROM delivery_attempts da
       JOIN deliveries d ON d.id = da.delivery_id
       WHERE d.workspace_id = ?`
    )
    .get(workspaceId) as { avg_ms: number | null };

  const succeeded = delStats.succeeded ?? 0;
  const failed = delStats.failed ?? 0;
  const terminal = succeeded + failed;

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM deliveries
       WHERE workspace_id = ?
       GROUP BY status`
    )
    .all(workspaceId) as Array<{ status: DeliveryStatus; count: number }>;

  const statusMap = new Map(statusRows.map((r) => [r.status, r.count]));
  const statusDistribution = ALL_STATUSES.map((status) => ({
    status,
    count: statusMap.get(status) ?? 0,
  }));

  const endpointHealthRows = db
    .prepare(
      `SELECT
         ep.id AS endpoint_id,
         ep.name,
         ep.url,
         ep.enabled,
         ep.last_delivery_status,
         ep.last_delivery_at,
         COUNT(d.id) AS total_deliveries,
         SUM(CASE WHEN d.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN d.status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) AS failed,
         AVG(d.last_latency_ms) AS avg_latency_ms
       FROM endpoints ep
       LEFT JOIN deliveries d ON d.endpoint_id = ep.id
       WHERE ep.workspace_id = ?
       GROUP BY ep.id
       ORDER BY total_deliveries DESC, ep.created_at DESC
       LIMIT 10`
    )
    .all(workspaceId) as Array<{
    endpoint_id: string;
    name: string;
    url: string;
    enabled: number;
    last_delivery_status: DeliveryStatus | null;
    last_delivery_at: string | null;
    total_deliveries: number;
    succeeded: number | null;
    failed: number | null;
    avg_latency_ms: number | null;
  }>;

  const endpointHealth = endpointHealthRows.map((ep) => {
    const s = ep.succeeded ?? 0;
    const f = ep.failed ?? 0;
    const t = s + f;
    return {
      endpoint_id: ep.endpoint_id,
      name: ep.name,
      url: ep.url,
      enabled: ep.enabled === 1,
      total_deliveries: ep.total_deliveries,
      succeeded: s,
      failed: f,
      success_rate: t > 0 ? Math.round((s / t) * 1000) / 10 : null,
      avg_latency_ms:
        ep.avg_latency_ms !== null && ep.avg_latency_ms !== undefined
          ? Math.round(ep.avg_latency_ms)
          : null,
      last_delivery_status: ep.last_delivery_status,
      last_delivery_at: ep.last_delivery_at,
    };
  });

  const recentEvents = listEvents(db, { workspace_id: workspaceId, page: 1, limit: 8 }).data;
  const recentDeliveries = listDeliveries(db, {
    workspace_id: workspaceId,
    page: 1,
    limit: 10,
  }).data;

  return {
    metrics: {
      total_events: eventsCount,
      total_deliveries: delStats.total ?? 0,
      successful_deliveries: succeeded,
      failed_deliveries: failed,
      pending_retries: delStats.pending_retries ?? 0,
      dead_letter_count: delStats.dead_letter_count ?? 0,
      success_rate: terminal > 0 ? Math.round((succeeded / terminal) * 1000) / 10 : null,
      avg_response_time_ms:
        avgLatencyRow.avg_ms !== null && avgLatencyRow.avg_ms !== undefined
          ? Math.round(avgLatencyRow.avg_ms)
          : null,
    },
    status_distribution: statusDistribution,
    endpoint_health: endpointHealth,
    recent_events: recentEvents,
    recent_deliveries: recentDeliveries,
  };
}

export function getDeliveryAnalytics(
  db: HookRelayDB,
  options: {
    workspace_id?: string;
    range?: string;
    from?: string;
    to?: string;
  } = {}
): DeliveryAnalyticsResponse {
  const workspaceId = options.workspace_id || 'default';
  const now = new Date();
  let preset = options.range || '7d';
  let fromDate: Date;
  let toDate: Date = now;

  if (options.from && options.to) {
    const parsedFrom = new Date(options.from);
    const parsedTo = new Date(options.to);
    if (!Number.isNaN(parsedFrom.getTime()) && !Number.isNaN(parsedTo.getTime())) {
      fromDate = parsedFrom;
      toDate = parsedTo;
      preset = 'custom';
    } else {
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
  } else if (preset === '24h') {
    fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (preset === '30d') {
    fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    preset = '7d';
    fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();
  const spanMs = Math.max(1, toDate.getTime() - fromDate.getTime());
  const useHourlyBuckets = spanMs <= 48 * 60 * 60 * 1000;
  const bucketExpr = useHourlyBuckets
    ? "substr(d.created_at, 1, 13) || ':00'"
    : 'substr(d.created_at, 1, 10)';

  const summaryRow = db
    .prepare(
      `SELECT
         COUNT(*) AS total_deliveries,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN attempt_count > 1 THEN 1 ELSE 0 END) AS retried_deliveries,
         SUM(attempt_count) AS total_attempts
       FROM deliveries
       WHERE workspace_id = ? AND created_at >= ? AND created_at <= ?`
    )
    .get(workspaceId, fromIso, toIso) as {
    total_deliveries: number;
    succeeded: number | null;
    failed: number | null;
    retried_deliveries: number | null;
    total_attempts: number | null;
  };

  const latencies = db
    .prepare(
      `SELECT da.latency_ms
       FROM delivery_attempts da
       JOIN deliveries d ON d.id = da.delivery_id
       WHERE d.workspace_id = ? AND da.created_at >= ? AND da.created_at <= ?
       ORDER BY da.latency_ms ASC`
    )
    .all(workspaceId, fromIso, toIso) as Array<{ latency_ms: number }>;

  let avgLatency: number | null = null;
  let p95Latency: number | null = null;
  if (latencies.length > 0) {
    const sum = latencies.reduce((acc, r) => acc + r.latency_ms, 0);
    avgLatency = Math.round(sum / latencies.length);
    const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
    p95Latency = latencies[p95Idx].latency_ms;
  }

  // Latency distribution histogram
  const latencyBuckets: Record<string, number> = {
    '<50ms': 0,
    '50-150ms': 0,
    '150-500ms': 0,
    '500ms-1s': 0,
    '1s-3s': 0,
    '>3s': 0,
  };
  for (const { latency_ms } of latencies) {
    if (latency_ms < 50) latencyBuckets['<50ms']++;
    else if (latency_ms < 150) latencyBuckets['50-150ms']++;
    else if (latency_ms < 500) latencyBuckets['150-500ms']++;
    else if (latency_ms < 1000) latencyBuckets['500ms-1s']++;
    else if (latency_ms < 3000) latencyBuckets['1s-3s']++;
    else latencyBuckets['>3s']++;
  }

  const timeSeriesRows = db
    .prepare(
      `SELECT
         ${bucketExpr} AS bucket,
         SUM(CASE WHEN d.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN d.status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN d.status IN ('pending', 'retrying', 'processing') THEN 1 ELSE 0 END) AS retrying
       FROM deliveries d
       WHERE d.workspace_id = ? AND d.created_at >= ? AND d.created_at <= ?
       GROUP BY bucket
       ORDER BY bucket ASC`
    )
    .all(workspaceId, fromIso, toIso) as Array<{
    bucket: string;
    succeeded: number;
    failed: number;
    retrying: number;
  }>;

  const timeSeries = timeSeriesRows.map((row) => {
    const total = row.succeeded + row.failed + row.retrying;
    const terminal = row.succeeded + row.failed;
    return {
      bucket: row.bucket,
      succeeded: row.succeeded,
      failed: row.failed,
      retrying: row.retrying,
      success_rate: terminal > 0 ? Math.round((row.succeeded / terminal) * 1000) / 10 : 0,
      failure_rate: total > 0 ? Math.round((row.failed / total) * 1000) / 10 : 0,
    };
  });

  const statusCodes = db
    .prepare(
      `SELECT
         COALESCE(CAST(da.response_status AS TEXT), da.error_code, 'ERR') AS code,
         COUNT(*) AS count
       FROM delivery_attempts da
       JOIN deliveries d ON d.id = da.delivery_id
       WHERE d.workspace_id = ? AND da.created_at >= ? AND da.created_at <= ?
       GROUP BY code
       ORDER BY count DESC`
    )
    .all(workspaceId, fromIso, toIso) as Array<{ code: string; count: number }>;

  const perEndpointRows = db
    .prepare(
      `SELECT
         ep.id AS endpoint_id,
         ep.name,
         ep.url,
         COUNT(d.id) AS total,
         SUM(CASE WHEN d.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN d.status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) AS failed
       FROM deliveries d
       JOIN endpoints ep ON ep.id = d.endpoint_id
       WHERE d.workspace_id = ? AND d.created_at >= ? AND d.created_at <= ?
       GROUP BY ep.id
       ORDER BY total DESC`
    )
    .all(workspaceId, fromIso, toIso) as Array<{
    endpoint_id: string;
    name: string;
    url: string;
    total: number;
    succeeded: number;
    failed: number;
  }>;

  const unreliableEndpoints = perEndpointRows
    .filter((ep) => ep.failed > 0)
    .map((ep) => ({
      endpoint_id: ep.endpoint_id,
      name: ep.name,
      url: ep.url,
      total: ep.total,
      failed: ep.failed,
      failure_rate: ep.total > 0 ? Math.round((ep.failed / ep.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.failure_rate - a.failure_rate || b.failed - a.failed)
    .slice(0, 8);

  const mostRetriedEvents = db
    .prepare(
      `SELECT
         ev.id AS event_id,
         ev.type AS event_type,
         ev.created_at,
         COUNT(d.id) AS deliveries_count,
         SUM(d.attempt_count) AS total_attempts
       FROM deliveries d
       JOIN events ev ON ev.id = d.event_id
       WHERE d.workspace_id = ? AND d.created_at >= ? AND d.created_at <= ?
         AND d.attempt_count > 1
       GROUP BY ev.id
       ORDER BY total_attempts DESC
       LIMIT 8`
    )
    .all(workspaceId, fromIso, toIso) as Array<{
    event_id: string;
    event_type: string;
    created_at: string;
    deliveries_count: number;
    total_attempts: number;
  }>;

  const totalDel = summaryRow.total_deliveries ?? 0;
  const retriedDel = summaryRow.retried_deliveries ?? 0;

  return {
    range: {
      from: fromIso,
      to: toIso,
      preset,
    },
    summary: {
      total_deliveries: totalDel,
      succeeded: summaryRow.succeeded ?? 0,
      failed: summaryRow.failed ?? 0,
      retried_deliveries: retriedDel,
      total_attempts: summaryRow.total_attempts ?? 0,
      retry_rate: totalDel > 0 ? Math.round((retriedDel / totalDel) * 1000) / 10 : null,
      avg_latency_ms: avgLatency,
      p95_latency_ms: p95Latency,
    },
    time_series: timeSeries,
    latency_distribution: Object.entries(latencyBuckets).map(([bucket, count]) => ({
      bucket,
      count,
    })),
    status_code_distribution: statusCodes,
    unreliable_endpoints: unreliableEndpoints,
    most_retried_events: mostRetriedEvents,
    deliveries_per_endpoint: perEndpointRows.map((ep) => ({
      endpoint_id: ep.endpoint_id,
      name: ep.name,
      total: ep.total,
      succeeded: ep.succeeded,
      failed: ep.failed,
    })),
  };
}
