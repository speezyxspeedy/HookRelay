# HookRelay Error Reporting & Failure Classification Guide

Every HookRelay REST API error and outbound webhook delivery attempt uses structured, deterministic error codes so developers and monitoring systems can diagnose failures without inspecting raw server logs.

## 1. Standardized REST API Error Format

All `4xx` and `5xx` API responses return JSON with the following envelope and include an `X-Request-Id` response header for log correlation:

```json
{
  "error": {
    "code": "INVALID_DESTINATION_URL",
    "message": "Blocked IP destination: Link-local / cloud metadata address (169.254.0.0/16)",
    "details": [],
    "request_id": "req_a1b2c3d4e5f6"
  }
}
```

### API Error Codes

| HTTP Status | Error Code | Description & Resolution |
| :--- | :--- | :--- |
| `400` | `VALIDATION_ERROR` | One or more request fields failed Zod schema validation. Check `error.details` for exact field paths. |
| `400` | `INVALID_JSON` | Request body could not be parsed as valid JSON. |
| `400` | `INVALID_DESTINATION_URL` | Destination URL uses a disallowed protocol, embedded credentials, or resolves to a private/internal/cloud-metadata IP. |
| `400` | `INVALID_EVENT_TYPE` | Event type must match `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$`. |
| `401` | `UNAUTHORIZED` | Missing or invalid `X-API-Key` or `Authorization: Bearer` credential. |
| `401` | `ADMIN_SETUP_REQUIRED` | No `HOOKRELAY_API_KEY` env var is set and initial workspace claim has not been completed. |
| `404` | `ENDPOINT_NOT_FOUND` / `EVENT_NOT_FOUND` / `DELIVERY_NOT_FOUND` / `DEAD_LETTER_NOT_FOUND` | The requested resource ID does not exist in SQLite. |
| `409` | `IDEMPOTENCY_CONFLICT` | The supplied `Idempotency-Key` was previously used with a different event type or JSON payload. Generate a new key for distinct events. |
| `409` | `DELIVERY_IN_PROGRESS` | Manual retry requested while a worker currently holds the lock on this delivery. |
| `409` | `DELIVERY_ALREADY_SUCCEEDED` | Manual retry is blocked on succeeded deliveries; use `POST /api/events/:id/replay` to send a fresh copy. |
| `413` | `PAYLOAD_TOO_LARGE` | Request body exceeded `WEBHOOK_MAX_PAYLOAD_BYTES` (default 256 KB). |
| `429` | `RATE_LIMITED` | Sliding-window per-IP rate limit exceeded. Respect the `Retry-After` response header. |
| `500` | `INTERNAL_SERVER_ERROR` | Unexpected server error; secret values are scrubbed from logs before recording. |

## 2. Outbound Webhook Delivery Failure Classification

Each attempt stored in `delivery_attempts` is classified into one of three outcomes:

| Outcome | Trigger Conditions | Resulting Delivery Transition |
| :--- | :--- | :--- |
| `succeeded` | HTTP `200–299` | Delivery marked `succeeded`, `completed_at` recorded. |
| `retryable_failure` | HTTP `500–599`, HTTP `408` (if enabled), HTTP `429` (if enabled), `REQUEST_TIMEOUT`, `CONNECTION_ERROR` | Scheduled in `retrying` using exponential backoff or `Retry-After` until `attempt_count == max_attempts`, then moved to `dead_letter`. |
| `permanent_failure` | Non-retryable `4xx` (e.g. `400`, `401`, `403`, `404`, `422`), `REDIRECT_BLOCKED` (`3xx`), `SSRF_BLOCKED` | Immediately moved to `dead_letter` without wasting retries. |

### Delivery Attempt Error Codes

- **`HTTP_<STATUS>`**: Remote endpoint responded with a non-2xx HTTP status code. Inspect `response_status`, `response_headers`, and `response_body` (truncated safely at 64 KB) in the Delivery Inspector.
- **`REQUEST_TIMEOUT`**: Remote endpoint did not complete its HTTP response within `request_timeout_ms`.
- **`CONNECTION_ERROR`**: Network error (DNS failure, TCP `ECONNREFUSED`, TLS handshake error, socket reset).
- **`REDIRECT_BLOCKED`**: Target responded with an HTTP `301`/`302`/`307`/`308` redirect. HookRelay sets `redirect: 'manual'` to prevent redirect-based SSRF bypasses.
- **`SSRF_BLOCKED`**: Pre-flight DNS verification detected a private network, loopback (when localhost mode is off), link-local, or cloud metadata address.

## 3. Secret Redaction Policy

- Endpoint signing secrets (`whsec_...`) are scrubbed from all error messages (`whsec_[REDACTED]`) and are never returned in `GET /api/endpoints`, `GET /api/deliveries`, or application logs.
- Sensitive HTTP headers (`Authorization`, `X-API-Key`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, and any header containing `secret`, `token`, or `password`) are replaced with `[REDACTED]` before persisting `request_headers` and `response_headers` to SQLite.
