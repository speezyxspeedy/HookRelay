import path from 'path';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  dbPath: string;
  apiKey: string | null;
  allowLocalhostWebhooks: boolean;
  workerPollIntervalMs: number;
  workerConcurrency: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxPayloadBytes: number;
  appUrl: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const port = overrides.port ?? Number(process.env.PORT || 3000);
  const rawDbPath = overrides.dbPath ?? process.env.HOOKRELAY_DB_PATH ?? './data/hookrelay.db';
  const dbPath =
    rawDbPath === ':memory:' ? ':memory:' : path.resolve(process.cwd(), rawDbPath);
  const envApiKey = process.env.HOOKRELAY_API_KEY?.trim() || null;
  const apiKey = overrides.apiKey !== undefined ? overrides.apiKey : envApiKey;

  const allowLocalhostEnv = process.env.ALLOW_LOCALHOST_WEBHOOKS;
  const allowLocalhostWebhooks =
    overrides.allowLocalhostWebhooks ??
    (allowLocalhostEnv !== undefined
      ? allowLocalhostEnv.toLowerCase() === 'true'
      : nodeEnv !== 'production');

  return {
    port,
    nodeEnv,
    dbPath,
    apiKey,
    allowLocalhostWebhooks,
    workerPollIntervalMs:
      overrides.workerPollIntervalMs ?? Number(process.env.WORKER_POLL_INTERVAL_MS || 1500),
    workerConcurrency:
      overrides.workerConcurrency ?? Number(process.env.WORKER_CONCURRENCY || 5),
    requestTimeoutMs:
      overrides.requestTimeoutMs ?? Number(process.env.WEBHOOK_REQUEST_TIMEOUT_MS || 10000),
    maxResponseBytes:
      overrides.maxResponseBytes ?? Number(process.env.WEBHOOK_MAX_RESPONSE_BYTES || 65536),
    maxPayloadBytes:
      overrides.maxPayloadBytes ?? Number(process.env.WEBHOOK_MAX_PAYLOAD_BYTES || 262144),
    appUrl: overrides.appUrl ?? (process.env.APP_URL || `http://localhost:${port}`),
  };
}
