import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { openDatabase, type HookRelayDB } from '../src/server/database/db.js';
import { loadConfig, type AppConfig } from '../src/server/config.js';
import { createApp } from '../src/server/app.js';
import { RetryWorker } from '../src/server/workers/retryWorker.js';
import {
  buildSignatureHeader,
  generateSigningSecret,
  verifyWebhookSignature,
} from '../src/server/security/hmac.js';
import { validateDestinationUrl } from '../src/server/security/urlValidator.js';
import {
  calculateBackoffDelay,
  parseRetryAfterMs,
} from '../src/server/services/dispatcher.js';

interface TestHarness {
  dbPath: string;
  db: HookRelayDB;
  config: AppConfig;
  worker: RetryWorker;
  server: http.Server;
  baseUrl: string;
  apiKey: string;
}

interface CapturedWebhook {
  headers: http.IncomingHttpHeaders;
  rawBody: string;
  receivedAt: number;
}

async function createMockReceiver(
  handler: (req: http.IncomingMessage, rawBody: string, res: http.ServerResponse) => void
): Promise<{ server: http.Server; url: string; captured: CapturedWebhook[] }> {
  const captured: CapturedWebhook[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      captured.push({
        headers: req.headers,
        rawBody,
        receivedAt: Date.now(),
      });
      handler(req, rawBody, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${addr.port}/webhook`,
    captured,
  };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startHarness(dbPathOverride?: string): Promise<TestHarness> {
  const dbPath =
    dbPathOverride ||
    path.join(
      os.tmpdir(),
      `hookrelay-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
    );
  const apiKey = 'hr_test_admin_key_99887766';
  const db = openDatabase(dbPath);
  const config = loadConfig({
    dbPath,
    apiKey,
    nodeEnv: 'test',
    allowLocalhostWebhooks: true,
    workerPollIntervalMs: 100,
    workerConcurrency: 4,
    requestTimeoutMs: 2500,
  });

  const worker = new RetryWorker(db, config);
  const app = createApp(db, config, worker);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  config.port = addr.port;
  config.appUrl = `http://127.0.0.1:${addr.port}`;

  return {
    dbPath,
    db,
    config,
    worker,
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    apiKey,
  };
}

async function apiJson<T = any>(
  harness: TestHarness,
  method: string,
  route: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${harness.baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': harness.apiKey,
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = (await res.json()) as T;
  return { status: res.status, body: parsed };
}

describe('HookRelay Core Platform', () => {
  let harness: TestHarness;
  const tempFiles: string[] = [];
  const receivers: http.Server[] = [];

  beforeEach(async () => {
    harness = await startHarness();
    tempFiles.push(harness.dbPath);
  });

  afterEach(async () => {
    harness.worker.stop();
    await closeServer(harness.server);
    harness.db.close();
    for (const r of receivers.splice(0)) {
      await closeServer(r);
    }
    for (const f of tempFiles.splice(0)) {
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(f + suffix)) {
          try {
            fs.unlinkSync(f + suffix);
          } catch {
            // Ignore cleanup lock
          }
        }
      }
    }
  });

  it('1. validates HMAC signature generation, verification, and rejects tampered or expired signatures', () => {
    const secret = generateSigningSecret();
    expect(secret.startsWith('whsec_')).toBe(true);
    expect(secret.length).toBeGreaterThan(40);

    const rawBody = JSON.stringify({
      id: 'evt_test_1',
      type: 'order.created',
      data: { orderId: 'ORD-1001', amount: 1499 },
    });
    const nowSec = 1760000000;
    const { signatureHeader } = buildSignatureHeader(secret, rawBody, nowSec);
    expect(signatureHeader).toMatch(/^t=1760000000,v1=[a-f0-9]{64}$/);

    // Valid verification
    const validRes = verifyWebhookSignature(secret, rawBody, signatureHeader, {
      toleranceSeconds: 300,
      nowSeconds: nowSec + 10,
    });
    expect(validRes.valid).toBe(true);

    // Tampered payload rejected
    const tamperedRes = verifyWebhookSignature(secret, rawBody + ' ', signatureHeader, {
      toleranceSeconds: 300,
      nowSeconds: nowSec + 10,
    });
    expect(tamperedRes.valid).toBe(false);

    // Wrong secret rejected
    const wrongSecretRes = verifyWebhookSignature(generateSigningSecret(), rawBody, signatureHeader, {
      toleranceSeconds: 300,
      nowSeconds: nowSec + 10,
    });
    expect(wrongSecretRes.valid).toBe(false);

    // Expired timestamp rejected (replay protection)
    const expiredRes = verifyWebhookSignature(secret, rawBody, signatureHeader, {
      toleranceSeconds: 300,
      nowSeconds: nowSec + 601,
    });
    expect(expiredRes.valid).toBe(false);
    expect(expiredRes.reason).toContain('tolerance');
  });

  it('2. calculates exponential backoff delays and parses Retry-After headers accurately', () => {
    expect(calculateBackoffDelay(1, 5000, 300000)).toBe(5000);
    expect(calculateBackoffDelay(2, 5000, 300000)).toBe(10000);
    expect(calculateBackoffDelay(3, 5000, 300000)).toBe(20000);
    expect(calculateBackoffDelay(4, 5000, 300000)).toBe(40000);
    expect(calculateBackoffDelay(10, 5000, 60000)).toBe(60000);

    expect(parseRetryAfterMs('12', 60000)).toBe(12000);
    expect(parseRetryAfterMs('999', 60000)).toBe(60000);
    expect(parseRetryAfterMs('invalid-header', 60000)).toBeNull();
  });

  it('3. enforces strict SSRF and destination URL security validation', async () => {
    const blockedUrls = [
      'ftp://example.com/hook',
      'file:///etc/passwd',
      'http://user:pass@example.com/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://10.0.0.5/internal',
      'http://192.168.1.10/webhook',
      'http://172.16.0.10/webhook',
      'http://[::ffff:169.254.169.254]/latest',
    ];

    for (const url of blockedUrls) {
      const res = await validateDestinationUrl(url, { allowLocalhost: true });
      expect(res.valid, `Expected ${url} to be blocked`).toBe(false);
    }

    // Localhost blocked when allowLocalhost is false
    const localhostBlocked = await validateDestinationUrl('http://127.0.0.1:3000/hook', {
      allowLocalhost: false,
    });
    expect(localhostBlocked.valid).toBe(false);

    // Localhost allowed only when explicitly enabled
    const localhostAllowed = await validateDestinationUrl('http://127.0.0.1:3000/hook', {
      allowLocalhost: true,
    });
    expect(localhostAllowed.valid).toBe(true);
  });

  it('4. registers endpoints with validation and hides secrets from subsequent GET API responses', async () => {
    // Reject unauthorized requests
    const unauth = await fetch(`${harness.baseUrl}/api/endpoints`);
    expect(unauth.status).toBe(401);

    // Reject blocked private IP
    const badEp = await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Metadata Attempt',
      url: 'http://169.254.169.254/latest/meta-data/',
      subscribed_events: ['order.created'],
    });
    expect(badEp.status).toBe(400);
    expect(badEp.body.error.code).toBe('INVALID_DESTINATION_URL');

    // Create valid endpoint
    const created = await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Orders Consumer',
      url: 'http://127.0.0.1:9999/orders',
      subscribed_events: ['order.created', 'order.updated'],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.signing_secret).toMatch(/^whsec_/);
    const endpointId = created.body.data.id;

    // List endpoints must NEVER include raw signing_secret
    const listed = await apiJson(harness, 'GET', '/api/endpoints');
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].signing_secret).toBeUndefined();
    expect(listed.body.data[0].secret_preview).toContain('••••••••');

    // Get endpoint by ID must NEVER include raw signing_secret
    const fetched = await apiJson(harness, 'GET', `/api/endpoints/${endpointId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.signing_secret).toBeUndefined();
  });

  it('5. matches event subscriptions accurately and dispatches real signed HTTP POST webhooks', async () => {
    const rcvOrder = await createMockReceiver((_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    const rcvWildcard = await createMockReceiver((_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    const rcvDisabled = await createMockReceiver((_req, _body, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    receivers.push(rcvOrder.server, rcvWildcard.server, rcvDisabled.server);

    const ep1 = await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Order Exact',
      url: rcvOrder.url,
      subscribed_events: ['order.created'],
    });
    const ep2 = await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Order Prefix Wildcard',
      url: rcvWildcard.url,
      subscribed_events: ['order.*'],
    });
    await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Disabled Consumer',
      url: rcvDisabled.url,
      subscribed_events: ['*'],
      enabled: false,
    });
    await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Payment Only',
      url: rcvDisabled.url,
      subscribed_events: ['payment.succeeded'],
    });

    const evRes = await apiJson(harness, 'POST', '/api/events', {
      type: 'order.created',
      data: { orderId: 'ORD-1001', amount: 1499, currency: 'INR' },
    });
    expect(evRes.status).toBe(201);
    expect(evRes.body.deliveries_created).toBe(2);

    // Process due deliveries with real HTTP requests
    await harness.worker.processDueNow();

    expect(rcvOrder.captured).toHaveLength(1);
    expect(rcvWildcard.captured).toHaveLength(1);
    expect(rcvDisabled.captured).toHaveLength(0);

    // Verify headers & HMAC signature on real transmitted request
    const received = rcvOrder.captured[0];
    expect(received.headers['content-type']).toBe('application/json');
    expect(received.headers['x-hookrelay-event']).toBe('order.created');
    expect(received.headers['x-hookrelay-delivery']).toBeTruthy();
    expect(received.headers['x-hookrelay-timestamp']).toBeTruthy();
    expect(received.headers['x-hookrelay-attempt']).toBe('1');
    const sigHeader = String(received.headers['x-hookrelay-signature'] || '');
    const sigCheck = verifyWebhookSignature(
      ep1.body.data.signing_secret,
      received.rawBody,
      sigHeader
    );
    expect(sigCheck.valid).toBe(true);

    // Verify second endpoint signed with its own unique secret
    const sigCheck2 = verifyWebhookSignature(
      ep2.body.data.signing_secret,
      rcvWildcard.captured[0].rawBody,
      String(rcvWildcard.captured[0].headers['x-hookrelay-signature'] || '')
    );
    expect(sigCheck2.valid).toBe(true);

    // Verify delivery persisted as succeeded with full attempt history
    const delId = evRes.body.delivery_ids[0];
    const delDetail = await apiJson(harness, 'GET', `/api/deliveries/${delId}`);
    expect(delDetail.status).toBe(200);
    expect(delDetail.body.data.status).toBe('succeeded');
    expect(delDetail.body.data.attempts).toHaveLength(1);
    expect(delDetail.body.data.attempts[0].response_status).toBe(200);
  });

  it('6. handles transient HTTP 500 retries, max attempts to DLQ, DLQ replay, and archive without deleting history', async () => {
    let returnStatus = 500;
    const rcv = await createMockReceiver((_req, _body, res) => {
      res.writeHead(returnStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: returnStatus }));
    });
    receivers.push(rcv.server);

    // Configure fast retries with max 3 attempts
    await apiJson(harness, 'PATCH', '/api/settings', {
      max_attempts: 3,
      initial_delay_ms: 200,
      max_delay_ms: 1000,
    });

    await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Flaky Service',
      url: rcv.url,
      subscribed_events: ['invoice.failed'],
    });

    const ev = await apiJson(harness, 'POST', '/api/events', {
      type: 'invoice.failed',
      data: { invoiceId: 'INV-900' },
    });
    const deliveryId = ev.body.delivery_ids[0];

    // Attempt 1 -> fails with 500, scheduled for retry
    await harness.worker.processDueNow();
    let d = await apiJson(harness, 'GET', `/api/deliveries/${deliveryId}`);
    expect(d.body.data.status).toBe('retrying');
    expect(d.body.data.attempt_count).toBe(1);
    expect(d.body.data.next_attempt_at).toBeTruthy();

    // Force due & run Attempt 2 -> fails with 500
    harness.db
      .prepare('UPDATE deliveries SET next_attempt_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), deliveryId);
    await harness.worker.processDueNow();
    d = await apiJson(harness, 'GET', `/api/deliveries/${deliveryId}`);
    expect(d.body.data.status).toBe('retrying');
    expect(d.body.data.attempt_count).toBe(2);

    // Force due & run Attempt 3 -> exhausts max_attempts -> moves to Dead Letter Queue
    harness.db
      .prepare('UPDATE deliveries SET next_attempt_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), deliveryId);
    await harness.worker.processDueNow();
    d = await apiJson(harness, 'GET', `/api/deliveries/${deliveryId}`);
    expect(d.body.data.status).toBe('dead_letter');
    expect(d.body.data.attempt_count).toBe(3);
    expect(d.body.data.attempts).toHaveLength(3);

    // Confirm present in Dead Letter Queue
    const dlq = await apiJson(harness, 'GET', '/api/dead-letters');
    expect(dlq.body.data).toHaveLength(1);
    expect(dlq.body.data[0].id).toBe(deliveryId);

    // Recover receiver to 200 OK and replay from DLQ
    returnStatus = 200;
    const replayed = await apiJson(harness, 'POST', `/api/dead-letters/${deliveryId}/replay`);
    expect(replayed.status).toBe(201);
    const replayId = replayed.body.data.id;
    expect(replayId).not.toBe(deliveryId);
    expect(replayed.body.data.is_replay).toBe(true);
    expect(replayed.body.data.replay_of_delivery_id).toBe(deliveryId);

    await harness.worker.processDueNow();
    const replayedDetail = await apiJson(harness, 'GET', `/api/deliveries/${replayId}`);
    expect(replayedDetail.body.data.status).toBe('succeeded');

    // Original DLQ delivery's 3 attempts remain intact
    const origDetail = await apiJson(harness, 'GET', `/api/deliveries/${deliveryId}`);
    expect(origDetail.body.data.attempts).toHaveLength(3);

    // Archive DLQ item
    const archived = await apiJson(harness, 'POST', `/api/dead-letters/${deliveryId}/archive`);
    expect(archived.status).toBe(200);
    const activeDlq = await apiJson(harness, 'GET', '/api/dead-letters');
    expect(activeDlq.body.data).toHaveLength(0);
  });

  it('7. treats HTTP 400 as permanent failure while honoring Retry-After on HTTP 429', async () => {
    let mode: '400' | '429' = '400';
    const rcv = await createMockReceiver((_req, _body, res) => {
      if (mode === '400') {
        res.writeHead(400);
        res.end('Bad Request');
      } else {
        res.writeHead(429, { 'Retry-After': '15' });
        res.end('Rate Limited');
      }
    });
    receivers.push(rcv.server);

    await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Strict Receiver',
      url: rcv.url,
      subscribed_events: ['test.400', 'test.429'],
    });

    // HTTP 400 goes immediately to dead_letter without retrying
    const ev400 = await apiJson(harness, 'POST', '/api/events', {
      type: 'test.400',
      data: { case: 400 },
    });
    await harness.worker.processDueNow();
    const d400 = await apiJson(harness, 'GET', `/api/deliveries/${ev400.body.delivery_ids[0]}`);
    expect(d400.body.data.status).toBe('dead_letter');
    expect(d400.body.data.attempt_count).toBe(1);

    // HTTP 429 schedules retry respecting Retry-After: 15s
    mode = '429';
    const before = Date.now();
    const ev429 = await apiJson(harness, 'POST', '/api/events', {
      type: 'test.429',
      data: { case: 429 },
    });
    await harness.worker.processDueNow();
    const d429 = await apiJson(harness, 'GET', `/api/deliveries/${ev429.body.delivery_ids[0]}`);
    expect(d429.body.data.status).toBe('retrying');
    const nextMs = new Date(d429.body.data.next_attempt_at).getTime() - before;
    expect(nextMs).toBeGreaterThanOrEqual(13000);
  });

  it('8. enforces event idempotency keys, rejects mismatched payload reuse, and prevents duplicate deliveries', async () => {
    const rcv = await createMockReceiver((_req, _body, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    receivers.push(rcv.server);

    const ep = await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Billing Receiver',
      url: rcv.url,
      subscribed_events: ['payment.succeeded'],
    });

    const payload = {
      type: 'payment.succeeded',
      data: { paymentId: 'PAY-101', amount: 500 },
    };

    // First call with Idempotency-Key
    const first = await apiJson(harness, 'POST', '/api/events', payload, {
      'Idempotency-Key': 'idem-pay-101',
    });
    expect(first.status).toBe(201);
    expect(first.body.idempotent_replay).toBe(false);
    expect(first.body.deliveries_created).toBe(1);

    // Duplicate call with identical key + payload returns original event without creating new delivery
    const second = await apiJson(harness, 'POST', '/api/events', payload, {
      'Idempotency-Key': 'idem-pay-101',
    });
    expect(second.status).toBe(200);
    expect(second.body.idempotent_replay).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.deliveries_created).toBe(0);

    // Reusing same key with different payload returns 409 Conflict
    const conflict = await apiJson(
      harness,
      'POST',
      '/api/events',
      { type: 'payment.succeeded', data: { paymentId: 'PAY-999', amount: 999 } },
      { 'Idempotency-Key': 'idem-pay-101' }
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    // Database partial unique constraint blocks duplicate original delivery for same (event_id, endpoint_id)
    expect(() => {
      harness.db
        .prepare(
          `INSERT INTO deliveries (
            id, workspace_id, event_id, endpoint_id, is_replay, status, attempt_count, max_attempts, created_at, updated_at
          ) VALUES ('del_dup_test', 'default', ?, ?, 0, 'pending', 0, 5, ?, ?)`
        )
        .run(
          first.body.data.id,
          ep.body.data.id,
          new Date().toISOString(),
          new Date().toISOString()
        );
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('9. supports manual event replay separately from original deliveries', async () => {
    const rcv = await createMockReceiver((_req, _body, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    receivers.push(rcv.server);

    const ep = await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Replay Target',
      url: rcv.url,
      subscribed_events: ['user.created'],
    });

    const ev = await apiJson(harness, 'POST', '/api/events', {
      type: 'user.created',
      data: { userId: 'USR-42' },
    });
    await harness.worker.processDueNow();
    expect(rcv.captured).toHaveLength(1);

    // Replay event manually
    const replayRes = await apiJson(harness, 'POST', `/api/events/${ev.body.data.id}/replay`, {
      endpoint_ids: [ep.body.data.id],
    });
    expect(replayRes.status).toBe(201);
    expect(replayRes.body.data.replayed_delivery_ids).toHaveLength(1);

    await harness.worker.processDueNow();
    expect(rcv.captured).toHaveLength(2);

    const eventDetail = await apiJson(harness, 'GET', `/api/events/${ev.body.data.id}`);
    expect(eventDetail.body.deliveries).toHaveLength(2);
    expect(eventDetail.body.deliveries.filter((d: any) => !d.is_replay)).toHaveLength(1);
    expect(eventDetail.body.deliveries.filter((d: any) => d.is_replay)).toHaveLength(1);
  });

  it('10. persists pending retries and historical data across a full backend restart', async () => {
    let shouldFail = true;
    const rcv = await createMockReceiver((_req, _body, res) => {
      res.writeHead(shouldFail ? 500 : 200);
      res.end(shouldFail ? 'Temporary Error' : 'Recovered OK');
    });
    receivers.push(rcv.server);

    const persistentDbPath = harness.dbPath;

    await apiJson(harness, 'PATCH', '/api/settings', {
      initial_delay_ms: 200,
      max_attempts: 4,
    });
    await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Restart Recovery Target',
      url: rcv.url,
      subscribed_events: ['shipment.dispatched'],
    });

    const ev = await apiJson(harness, 'POST', '/api/events', {
      type: 'shipment.dispatched',
      data: { tracking: 'TRK-777' },
    });
    const deliveryId = ev.body.delivery_ids[0];

    // First attempt fails -> retrying persisted to SQLite
    await harness.worker.processDueNow();
    const beforeRestart = await apiJson(harness, 'GET', `/api/deliveries/${deliveryId}`);
    expect(beforeRestart.body.data.status).toBe('retrying');

    // Simulate full backend shutdown & restart on the exact same SQLite DB file
    harness.worker.stop();
    await closeServer(harness.server);
    harness.db.close();

    shouldFail = false;
    harness = await startHarness(persistentDbPath);

    // Wait past 200ms backoff and let the restarted worker process the persisted retry
    await new Promise((r) => setTimeout(r, 300));
    await harness.worker.processDueNow();

    const afterRestart = await apiJson(harness, 'GET', `/api/deliveries/${deliveryId}`);
    expect(afterRestart.body.data.status).toBe('succeeded');
    expect(afterRestart.body.data.attempt_count).toBe(2);
    expect(afterRestart.body.data.attempts).toHaveLength(2);
    expect(afterRestart.body.data.attempts[0].response_status).toBe(500);
    expect(afterRestart.body.data.attempts[1].response_status).toBe(200);
  });

  it('11. verifies built-in Local Webhook Receiver end-to-end with HMAC verification and real analytics', async () => {
    const rcvConfig = await apiJson(harness, 'GET', '/api/receiver/config');
    expect(rcvConfig.status).toBe(200);
    const localReceiverUrl = rcvConfig.body.data.receiver_url;

    const ep = await apiJson(harness, 'POST', '/api/endpoints', {
      name: 'Built-in Receiver',
      url: localReceiverUrl,
      subscribed_events: ['order.created'],
    });

    await apiJson(harness, 'PATCH', '/api/receiver/config', {
      mode: '200_ok',
      verification_endpoint_id: ep.body.data.id,
    });

    const ev = await apiJson(harness, 'POST', '/api/events', {
      type: 'order.created',
      data: { orderId: 'ORD-LOCAL-1', amount: 2500 },
    });
    await harness.worker.processDueNow();

    // Check Local Receiver log verified the real HMAC signature
    const logs = await apiJson(harness, 'GET', '/api/receiver/requests');
    expect(logs.status).toBe(200);
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0].signature_valid).toBe(true);
    expect(logs.body.data[0].event_id).toBe(ev.body.data.id);
    expect(logs.body.data[0].response_status).toBe(200);

    // Check Analytics Overview reflects real DB rows
    const overview = await apiJson(harness, 'GET', '/api/analytics/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.data.metrics.total_events).toBe(1);
    expect(overview.body.data.metrics.successful_deliveries).toBe(1);
    expect(overview.body.data.metrics.success_rate).toBe(100);
  });
});
