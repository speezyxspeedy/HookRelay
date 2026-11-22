import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import type { RetrySettings } from '../../shared/types.js';

const SETTING_KEYS = [
  'max_attempts',
  'initial_delay_ms',
  'max_delay_ms',
  'request_timeout_ms',
  'retry_on_408',
  'retry_on_429',
  'allow_localhost_webhooks',
  'signature_tolerance_seconds',
  'workspace_name',
  'environment_label',
] as const;

export function getSettings(db: HookRelayDB, config: AppConfig): RetrySettings {
  const rows = db
    .prepare(
      `SELECT key, value FROM application_settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(',')})`
    )
    .all(...SETTING_KEYS) as Array<{ key: string; value: string }>;

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const parseNum = (key: string, fallback: number): number => {
    const raw = map.get(key);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const parseBool = (key: string, fallback: boolean): boolean => {
    const raw = map.get(key);
    if (raw === undefined) return fallback;
    return raw === 'true';
  };

  // In production, never allow enabling localhost delivery unless explicitly enabled via env var
  const allowLocalhost =
    config.nodeEnv === 'production'
      ? config.allowLocalhostWebhooks
      : parseBool('allow_localhost_webhooks', config.allowLocalhostWebhooks);

  return {
    max_attempts: parseNum('max_attempts', 5),
    initial_delay_ms: parseNum('initial_delay_ms', 5000),
    max_delay_ms: parseNum('max_delay_ms', 300000),
    request_timeout_ms: parseNum('request_timeout_ms', config.requestTimeoutMs),
    retry_on_408: parseBool('retry_on_408', true),
    retry_on_429: parseBool('retry_on_429', true),
    allow_localhost_webhooks: allowLocalhost,
    signature_tolerance_seconds: parseNum('signature_tolerance_seconds', 300),
    workspace_name: map.get('workspace_name') || 'Production Core',
    environment_label: map.get('environment_label') || config.nodeEnv,
  };
}

export function updateSettings(
  db: HookRelayDB,
  config: AppConfig,
  patch: Partial<RetrySettings>
): RetrySettings {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO application_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const tx = db.transaction(() => {
    for (const key of SETTING_KEYS) {
      const val = patch[key];
      if (val === undefined) continue;
      if (key === 'allow_localhost_webhooks' && config.nodeEnv === 'production') {
        continue;
      }
      upsert.run(key, String(val), now);
    }
  });
  tx();

  return getSettings(db, config);
}
