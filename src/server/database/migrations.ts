import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_hookrelay_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS endpoints (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL DEFAULT 'default',
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          subscribed_events TEXT NOT NULL,
          signing_secret TEXT NOT NULL,
          secret_preview TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_delivery_status TEXT,
          last_delivery_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_endpoints_workspace
          ON endpoints(workspace_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_endpoints_enabled
          ON endpoints(workspace_id, enabled);

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL DEFAULT 'default',
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          idempotency_key TEXT,
          source TEXT NOT NULL DEFAULT 'api',
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_workspace_created
          ON events(workspace_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_events_type
          ON events(type);

        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL DEFAULT 'default',
          event_id TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_idempotency_event
          ON idempotency_keys(event_id);

        CREATE TABLE IF NOT EXISTS deliveries (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL DEFAULT 'default',
          event_id TEXT NOT NULL,
          endpoint_id TEXT NOT NULL,
          replay_of_delivery_id TEXT,
          is_replay INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'retrying', 'failed', 'dead_letter')),
          attempt_count INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          next_attempt_at TEXT,
          locked_at TEXT,
          locked_by TEXT,
          last_http_status INTEGER,
          last_error TEXT,
          last_latency_ms INTEGER,
          total_duration_ms INTEGER NOT NULL DEFAULT 0,
          last_attempt_at TEXT,
          completed_at TEXT,
          dlq_archived INTEGER NOT NULL DEFAULT 0,
          dlq_archived_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
          FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE,
          FOREIGN KEY (replay_of_delivery_id) REFERENCES deliveries(id) ON DELETE SET NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_event_endpoint_original
          ON deliveries(event_id, endpoint_id)
          WHERE is_replay = 0;

        CREATE INDEX IF NOT EXISTS idx_deliveries_due
          ON deliveries(status, next_attempt_at);

        CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint_created
          ON deliveries(endpoint_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_deliveries_event
          ON deliveries(event_id);

        CREATE INDEX IF NOT EXISTS idx_deliveries_dlq
          ON deliveries(status, dlq_archived, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_deliveries_workspace_created
          ON deliveries(workspace_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS delivery_attempts (
          id TEXT PRIMARY KEY,
          delivery_id TEXT NOT NULL,
          attempt_number INTEGER NOT NULL,
          request_url TEXT NOT NULL,
          request_method TEXT NOT NULL DEFAULT 'POST',
          request_headers TEXT NOT NULL,
          request_body TEXT NOT NULL,
          response_status INTEGER,
          response_headers TEXT,
          response_body TEXT,
          latency_ms INTEGER NOT NULL,
          error_code TEXT,
          error_message TEXT,
          outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'retryable_failure', 'permanent_failure')),
          created_at TEXT NOT NULL,
          FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
          UNIQUE(delivery_id, attempt_number)
        );

        CREATE INDEX IF NOT EXISTS idx_attempts_delivery
          ON delivery_attempts(delivery_id, attempt_number ASC);

        CREATE INDEX IF NOT EXISTS idx_attempts_created
          ON delivery_attempts(created_at DESC);

        CREATE TABLE IF NOT EXISTS application_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS receiver_requests (
          id TEXT PRIMARY KEY,
          event_type TEXT,
          event_id TEXT,
          delivery_id TEXT,
          attempt_number INTEGER,
          timestamp_header TEXT,
          signature_header TEXT,
          signature_valid INTEGER NOT NULL DEFAULT 0,
          signature_error TEXT,
          headers TEXT NOT NULL,
          body TEXT NOT NULL,
          response_mode TEXT NOT NULL,
          response_status INTEGER NOT NULL,
          received_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_receiver_requests_received
          ON receiver_requests(received_at DESC);
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations')
    .all() as Array<{ version: number }>;
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }
    const tx = db.transaction(() => {
      migration.up(db);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
    });
    tx();
  }
}
