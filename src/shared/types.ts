export type DeliveryStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'retrying'
  | 'failed'
  | 'dead_letter';

export type AttemptOutcome =
  | 'succeeded'
  | 'retryable_failure'
  | 'permanent_failure';

export type ReceiverMode =
  | '200_ok'
  | '400_bad_request'
  | '429_rate_limited'
  | '500_server_error'
  | 'delayed_200'
  | 'timeout';

export interface EndpointRecord {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  description: string;
  subscribed_events: string[];
  secret_preview: string;
  enabled: boolean;
  last_delivery_status: DeliveryStatus | null;
  last_delivery_at: string | null;
  created_at: string;
  updated_at: string;
  stats?: {
    total_deliveries: number;
    succeeded_deliveries: number;
    failed_deliveries: number;
    success_rate: number | null;
    avg_latency_ms: number | null;
  };
}

export interface EndpointWithSecret extends EndpointRecord {
  signing_secret: string;
}

export interface EventRecord {
  id: string;
  workspace_id: string;
  type: string;
  payload: unknown;
  raw_payload: string;
  idempotency_key: string | null;
  source: 'api' | 'dashboard' | 'test';
  created_at: string;
  delivery_summary?: {
    total: number;
    succeeded: number;
    pending: number;
    failed: number;
    dead_letter: number;
  };
}

export interface DeliveryRecord {
  id: string;
  workspace_id: string;
  event_id: string;
  event_type: string;
  endpoint_id: string;
  endpoint_name: string;
  endpoint_url: string;
  replay_of_delivery_id: string | null;
  is_replay: boolean;
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
  dlq_archived: boolean;
  dlq_archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAttemptRecord {
  id: string;
  delivery_id: string;
  attempt_number: number;
  request_url: string;
  request_method: string;
  request_headers: Record<string, string>;
  request_body: string;
  response_status: number | null;
  response_headers: Record<string, string> | null;
  response_body: string | null;
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
  outcome: AttemptOutcome;
  created_at: string;
}

export interface DeliveryDetail extends DeliveryRecord {
  event_payload: unknown;
  event_raw_payload: string;
  attempts: DeliveryAttemptRecord[];
}

export interface RetrySettings {
  max_attempts: number;
  initial_delay_ms: number;
  max_delay_ms: number;
  request_timeout_ms: number;
  retry_on_408: boolean;
  retry_on_429: boolean;
  allow_localhost_webhooks: boolean;
  signature_tolerance_seconds: number;
  workspace_name: string;
  environment_label: string;
}

export interface OverviewAnalytics {
  metrics: {
    total_events: number;
    total_deliveries: number;
    successful_deliveries: number;
    failed_deliveries: number;
    pending_retries: number;
    dead_letter_count: number;
    success_rate: number | null;
    avg_response_time_ms: number | null;
  };
  status_distribution: Array<{
    status: DeliveryStatus;
    count: number;
  }>;
  endpoint_health: Array<{
    endpoint_id: string;
    name: string;
    url: string;
    enabled: boolean;
    total_deliveries: number;
    succeeded: number;
    failed: number;
    success_rate: number | null;
    avg_latency_ms: number | null;
    last_delivery_status: DeliveryStatus | null;
    last_delivery_at: string | null;
  }>;
  recent_events: EventRecord[];
  recent_deliveries: DeliveryRecord[];
}

export interface DeliveryAnalyticsResponse {
  range: {
    from: string;
    to: string;
    preset: string;
  };
  summary: {
    total_deliveries: number;
    succeeded: number;
    failed: number;
    retried_deliveries: number;
    total_attempts: number;
    retry_rate: number | null;
    avg_latency_ms: number | null;
    p95_latency_ms: number | null;
  };
  time_series: Array<{
    bucket: string;
    succeeded: number;
    failed: number;
    retrying: number;
    success_rate: number;
    failure_rate: number;
  }>;
  latency_distribution: Array<{
    bucket: string;
    count: number;
  }>;
  status_code_distribution: Array<{
    code: string;
    count: number;
  }>;
  unreliable_endpoints: Array<{
    endpoint_id: string;
    name: string;
    url: string;
    total: number;
    failed: number;
    failure_rate: number;
  }>;
  most_retried_events: Array<{
    event_id: string;
    event_type: string;
    total_attempts: number;
    deliveries_count: number;
    created_at: string;
  }>;
  deliveries_per_endpoint: Array<{
    endpoint_id: string;
    name: string;
    total: number;
    succeeded: number;
    failed: number;
  }>;
}

export interface ReceiverConfig {
  mode: ReceiverMode;
  delay_ms: number;
  retry_after_seconds: number;
  verification_secret_configured: boolean;
  verification_endpoint_id: string | null;
  receiver_url: string;
}

export interface ReceiverRequestLog {
  id: string;
  event_type: string | null;
  event_id: string | null;
  delivery_id: string | null;
  attempt_number: number | null;
  timestamp_header: string | null;
  signature_header: string | null;
  signature_valid: boolean;
  signature_error: string | null;
  headers: Record<string, string>;
  body: string;
  response_mode: ReceiverMode;
  response_status: number;
  received_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}

export interface AuthStatus {
  authenticated: boolean;
  setup_required: boolean;
  env_key_configured: boolean;
  environment: string;
}

export interface HealthResponse {
  status: 'ok';
  database: 'connected';
  worker: {
    running: boolean;
    active_jobs: number;
    poll_interval_ms: number;
  };
  environment: string;
  allow_localhost_webhooks: boolean;
  uptime_seconds: number;
  timestamp: string;
}
