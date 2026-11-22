import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="border border-[#1d2028] bg-[#0c0d11] rounded-md overflow-hidden">
      <div className="px-3 py-2 border-b border-[#1d2028] bg-[#101218] flex items-center justify-between">
        <span className="text-xs font-medium text-[#9aa1b4]">{title}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 text-xs text-[#9aa1b4] hover:text-[#eef0f5] cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 font-mono text-xs text-[#d4d8e4] overflow-x-auto leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

const NODE_VERIFY_SNIPPET = `import crypto from 'crypto';
import express from 'express';

const app = express();
const SIGNING_SECRET = process.env.HOOKRELAY_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300; // 5 minutes replay protection

function verifyHookRelaySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => kv.trim().split('='))
  );
  const timestamp = Number(parts.t);
  const receivedHex = parts.v1;
  if (!Number.isInteger(timestamp) || !receivedHex) return false;

  // Reject stale timestamps to mitigate replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`, 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

// IMPORTANT: Always read the exact raw bytes before JSON parsing
app.post('/webhooks/hookrelay', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  const sigHeader = req.header('X-HookRelay-Signature');

  if (!verifyHookRelaySignature(rawBody, sigHeader, SIGNING_SECRET)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = JSON.parse(rawBody);
  console.log('Verified event:', event.type, req.header('X-HookRelay-Delivery'));
  res.status(200).json({ received: true });
});`;

const PYTHON_VERIFY_SNIPPET = `import hmac, hashlib, time

def verify_hookrelay_signature(raw_body: bytes, sig_header: str, secret: str, tolerance=300) -> bool:
    parts = dict(item.strip().split("=", 1) for item in sig_header.split(",") if "=" in item)
    ts = int(parts.get("t", "0"))
    v1 = parts.get("v1", "")
    if not ts or not v1 or abs(int(time.time()) - ts) > tolerance:
        return False

    signed_payload = f"{ts}.".encode("utf-8") + raw_body
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)`;

const CURL_EVENT_SNIPPET = `curl -X POST http://localhost:3000/api/events \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $HOOKRELAY_API_KEY" \\
  -H "Idempotency-Key: ord-1001-created-v1" \\
  -d '{
    "type": "order.created",
    "data": {
      "orderId": "ORD-1001",
      "amount": 1499,
      "currency": "INR"
    }
  }'`;

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/health', desc: 'Database, background worker, and runtime health status' },
  { method: 'POST', path: '/api/endpoints', desc: 'Register a webhook endpoint and return initial signing secret once' },
  { method: 'GET', path: '/api/endpoints', desc: 'List registered endpoints with delivery statistics (secrets redacted)' },
  { method: 'GET', path: '/api/endpoints/:id', desc: 'Get endpoint configuration and recent delivery history' },
  { method: 'PATCH', path: '/api/endpoints/:id', desc: 'Update endpoint URL, subscriptions, or enabled status' },
  { method: 'DELETE', path: '/api/endpoints/:id', desc: 'Delete an endpoint and cascade its deliveries' },
  { method: 'POST', path: '/api/endpoints/:id/test', desc: 'Dispatch an immediate live test webhook and return HTTP result' },
  { method: 'POST', path: '/api/endpoints/:id/rotate-secret', desc: 'Generate a new cryptographically secure signing secret' },
  { method: 'POST', path: '/api/events', desc: 'Ingest an event (supports Idempotency-Key) and enqueue deliveries' },
  { method: 'GET', path: '/api/events', desc: 'List persisted events with pagination and type filtering' },
  { method: 'GET', path: '/api/events/:id', desc: 'Inspect event payload and all original/replayed deliveries' },
  { method: 'POST', path: '/api/events/:id/replay', desc: 'Replay an event to selected target endpoints' },
  { method: 'GET', path: '/api/deliveries', desc: 'Filter deliveries by status, endpoint, event, or replay origin' },
  { method: 'GET', path: '/api/deliveries/:id', desc: 'Inspect delivery metadata and all recorded HTTP attempts' },
  { method: 'GET', path: '/api/deliveries/:id/attempts', desc: 'List ordered HTTP request/response attempt logs for a delivery' },
  { method: 'POST', path: '/api/deliveries/:id/retry', desc: 'Schedule immediate manual retry of a non-succeeded delivery' },
  { method: 'GET', path: '/api/dead-letters', desc: 'List permanently failed and exhausted deliveries in DLQ' },
  { method: 'POST', path: '/api/dead-letters/:id/replay', desc: 'Spawn a new replay delivery while keeping original DLQ attempts intact' },
  { method: 'POST', path: '/api/dead-letters/:id/archive', desc: 'Dismiss/archive a dead-lettered delivery without deleting logs' },
  { method: 'GET', path: '/api/analytics/overview', desc: 'Real-time dashboard metrics, endpoint health, and status breakdown' },
  { method: 'GET', path: '/api/analytics/deliveries', desc: 'Time-series success/failure rates, latency buckets, and HTTP code stats' },
];

const ERROR_CODES = [
  { status: '400', code: 'VALIDATION_ERROR', meaning: 'Request JSON body or query parameters failed Zod schema validation.' },
  { status: '400', code: 'INVALID_DESTINATION_URL', meaning: 'URL scheme invalid, embedded credentials present, or host resolves to blocked private/metadata IP.' },
  { status: '401', code: 'UNAUTHORIZED', meaning: 'Missing or invalid X-API-Key header or Authorization Bearer token.' },
  { status: '404', code: 'ENDPOINT_NOT_FOUND / EVENT_NOT_FOUND / DELIVERY_NOT_FOUND', meaning: 'Requested resource ID does not exist in SQLite.' },
  { status: '409', code: 'IDEMPOTENCY_CONFLICT', meaning: 'Idempotency-Key was reused with a different event type or JSON payload.' },
  { status: '413', code: 'PAYLOAD_TOO_LARGE', meaning: 'Event payload exceeds configured WEBHOOK_MAX_PAYLOAD_BYTES limit.' },
  { status: '429', code: 'RATE_LIMITED', meaning: 'Per-IP rate limit exceeded on authentication, secret, or ingestion endpoint.' },
  { status: 'Delivery', code: 'SSRF_BLOCKED', meaning: 'Pre-flight DNS check blocked outbound delivery to internal or cloud metadata IP.' },
  { status: 'Delivery', code: 'REDIRECT_BLOCKED', meaning: 'Target returned HTTP 3xx; automatic redirects are disabled for security.' },
  { status: 'Delivery', code: 'REQUEST_TIMEOUT', meaning: 'Target endpoint did not respond within configured request_timeout_ms (retryable).' },
  { status: 'Delivery', code: 'CONNECTION_ERROR', meaning: 'TCP/TLS connection refused, reset, or DNS failed (retryable).' },
];

export function ApiDocsPage() {
  const [tab, setTab] = useState<'overview' | 'hmac' | 'idempotency' | 'errors'>('overview');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">
            API Documentation
          </h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            OpenAPI 3.0 specification, HMAC-SHA256 verification examples, idempotency guarantees,
            and structured error reporting reference.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#c8cddc] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md"
          >
            OpenAPI JSON
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md"
          >
            Swagger UI
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="inline-flex items-center p-1 bg-[#111318] border border-[#1d2028] rounded-md">
        {(
          [
            ['overview', 'REST API & Auth'],
            ['hmac', 'HMAC Verification'],
            ['idempotency', 'Idempotency & Retries'],
            ['errors', 'Error Reporting Reference'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
              tab === id
                ? 'bg-[#1c212e] text-[#eef0f5]'
                : 'text-[#8b92a5] hover:text-[#d8dce6]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-[#111318] border border-[#1d2028] rounded-md p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#eef0f5]">
              Authentication & Local API Key Setup
            </h2>
            <p className="text-xs text-[#9aa1b4] leading-relaxed">
              Every administrative route under <code className="font-mono text-[#c8cddc]">/api/*</code>{' '}
              (except <code className="font-mono text-[#c8cddc]">/api/health</code>,{' '}
              <code className="font-mono text-[#c8cddc]">/api/docs</code>, and{' '}
              <code className="font-mono text-[#c8cddc]">/api/receiver/ingest</code>) requires
              either an <code className="font-mono text-sky-300">X-API-Key</code> header or{' '}
              <code className="font-mono text-sky-300">Authorization: Bearer &lt;key&gt;</code>{' '}
              header validated on the server.
            </p>
            <CodeBlock
              title="Local Development Setup (.env)"
              code={`# 1. Copy example env file
cp .env.example .env

# 2. Set a strong administrative API key (or claim one on first UI launch)
HOOKRELAY_API_KEY="hr_live_replace_with_32_byte_random_hex"
ALLOW_LOCALHOST_WEBHOOKS=true

# 3. Start HookRelay
npm run dev`}
            />
            <CodeBlock title="Dispatch an Event with cURL" code={CURL_EVENT_SNIPPET} />
          </div>

          <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-[#eef0f5]">
              REST Endpoints Reference
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1d2028] text-[11px] text-[#7c8396]">
                    <th className="py-2.5 px-4">Method</th>
                    <th className="py-2.5 px-3">Path</th>
                    <th className="py-2.5 px-4">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181b23]">
                  {API_ENDPOINTS.map((ep) => (
                    <tr key={`${ep.method}-${ep.path}`} className="hover:bg-[#151822]">
                      <td className="py-2 px-4 font-mono font-semibold text-sky-400">
                        {ep.method}
                      </td>
                      <td className="py-2 px-3 font-mono text-[#eef0f5]">{ep.path}</td>
                      <td className="py-2 px-4 text-[#9aa1b4]">{ep.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'hmac' && (
        <div className="space-y-5">
          <div className="bg-[#111318] border border-[#1d2028] rounded-md p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#eef0f5]">
              Outbound Webhook Headers & Signature Format
            </h2>
            <p className="text-xs text-[#9aa1b4] leading-relaxed">
              Every outbound HTTP POST includes these headers. The signature is calculated over the
              concatenation of the Unix timestamp (seconds), a literal dot{' '}
              <code className="font-mono text-[#c8cddc]">.</code>, and the exact transmitted raw
              JSON body using <code className="font-mono text-[#c8cddc]">HMAC-SHA256</code>.
            </p>
            <CodeBlock
              title="Outbound Webhook Headers"
              code={`Content-Type: application/json
X-HookRelay-Event: order.created
X-HookRelay-Event-Id: evt_9f8a1b2c3d4e5f60
X-HookRelay-Delivery: del_1a2b3c4d5e6f7081
X-HookRelay-Timestamp: 1763827335
X-HookRelay-Signature: t=1763827335,v1=<64-char-hex-hmac-sha256>
X-HookRelay-Attempt: 1

# Signature formula:
# HMAC_SHA256(endpoint_signing_secret, timestamp + "." + rawRequestBody)`}
            />
          </div>

          <CodeBlock title="Node.js / Express Signature Verification" code={NODE_VERIFY_SNIPPET} />
          <CodeBlock title="Python Signature Verification" code={PYTHON_VERIFY_SNIPPET} />
        </div>
      )}

      {tab === 'idempotency' && (
        <div className="space-y-5">
          <div className="bg-[#111318] border border-[#1d2028] rounded-md p-5 space-y-3 text-xs text-[#9aa1b4] leading-relaxed">
            <h2 className="text-sm font-semibold text-[#eef0f5]">
              Event & Delivery Idempotency Guarantees
            </h2>
            <p>
              HookRelay enforces idempotency at two layers backed by SQLite unique constraints:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-[#c8cddc]">
              <li>
                <strong>Event Ingestion Idempotency:</strong> Supply an{' '}
                <code className="font-mono text-sky-300">Idempotency-Key</code> header (or{' '}
                <code className="font-mono text-sky-300">idempotency_key</code> body field) when
                calling <code className="font-mono">POST /api/events</code>. Repeated requests with
                the same key and identical payload return HTTP 200 with the original event and{' '}
                <code className="font-mono">idempotent_replay: true</code> without creating
                duplicate deliveries. Reusing the key with a different payload returns HTTP 409{' '}
                <code className="font-mono">IDEMPOTENCY_CONFLICT</code>.
              </li>
              <li>
                <strong>Delivery-Level Uniqueness:</strong> A partial unique index{' '}
                <code className="font-mono">
                  UNIQUE(event_id, endpoint_id) WHERE is_replay = 0
                </code>{' '}
                guarantees that an event never generates duplicate original delivery rows for the
                same endpoint.
              </li>
              <li>
                <strong>Exponential Backoff & Retry-After:</strong> Transient failures (HTTP
                500–599, 408, 429, timeouts, connection errors) schedule retries using{' '}
                <code className="font-mono text-amber-300">
                  delay = min(initialDelay * 2^(attemptNumber - 1), maxDelay)
                </code>
                . When a valid HTTP <code className="font-mono">Retry-After</code> header is
                returned, HookRelay honors it (capped at <code className="font-mono">maxDelay</code>
                ). Non-retryable 4xx responses (such as 400 or 404) move immediately to the Dead
                Letter Queue.
              </li>
            </ul>
          </div>
        </div>
      )}

      {tab === 'errors' && (
        <div className="space-y-5">
          <div className="bg-[#111318] border border-[#1d2028] rounded-md p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#eef0f5]">
              Standardized API Error Envelope
            </h2>
            <p className="text-xs text-[#9aa1b4]">
              Every failed API request returns a consistent JSON payload with a machine-readable{' '}
              <code className="font-mono">code</code>, human-readable{' '}
              <code className="font-mono">message</code>, optional field-level{' '}
              <code className="font-mono">details</code>, and a correlation{' '}
              <code className="font-mono">request_id</code> matching the{' '}
              <code className="font-mono">X-Request-Id</code> response header.
            </p>
            <CodeBlock
              title="Error Response Format"
              code={`{
  "error": {
    "code": "INVALID_DESTINATION_URL",
    "message": "Blocked IP destination: Link-local / cloud metadata address (169.254.0.0/16)",
    "request_id": "req_7b4f901a3e2c"
  }
}`}
            />
          </div>

          <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-[#eef0f5]">
              API & Delivery Failure Code Catalog
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1d2028] text-[11px] text-[#7c8396]">
                    <th className="py-2.5 px-4">Scope / HTTP</th>
                    <th className="py-2.5 px-3">Error Code</th>
                    <th className="py-2.5 px-4">Cause & Handling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181b23]">
                  {ERROR_CODES.map((row) => (
                    <tr key={row.code} className="hover:bg-[#151822]">
                      <td className="py-2.5 px-4 font-mono text-amber-300 whitespace-nowrap">
                        {row.status}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#eef0f5]">{row.code}</td>
                      <td className="py-2.5 px-4 text-[#9aa1b4]">{row.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
