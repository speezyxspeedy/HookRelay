import type {
  ApiErrorResponse,
  AuthStatus,
  DeliveryAnalyticsResponse,
  DeliveryAttemptRecord,
  DeliveryDetail,
  DeliveryRecord,
  EndpointRecord,
  EndpointWithSecret,
  EventRecord,
  HealthResponse,
  OverviewAnalytics,
  PaginatedResponse,
  ReceiverConfig,
  ReceiverMode,
  ReceiverRequestLog,
  RetrySettings,
} from '../../shared/types';

// Session token is held strictly in JS memory (never localStorage or sessionStorage).
let inMemoryToken: string | null = null;
let onUnauthorizedCallback: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function setUnauthorizedHandler(cb: (() => void) | null): void {
  onUnauthorizedCallback = cb;
}

export class ClientApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { skipAuthRedirect?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (inMemoryToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRedirect && onUnauthorizedCallback) {
      inMemoryToken = null;
      onUnauthorizedCallback();
    }
    const errBody = parsed as ApiErrorResponse | null;
    const code = errBody?.error?.code || `HTTP_${response.status}`;
    const message = errBody?.error?.message || `Request failed with status ${response.status}`;
    throw new ClientApiError(response.status, code, message, errBody?.error?.details);
  }

  return parsed as T;
}

function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      sp.set(k, String(v));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  // System & Auth
  getHealth: () => request<HealthResponse>('/api/health', { skipAuthRedirect: true }),
  getAuthStatus: () => request<AuthStatus>('/api/auth/status', { skipAuthRedirect: true }),
  setupAdminKey: (apiKey: string) =>
    request<{ authenticated: boolean; token: string; expires_at: string }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey }),
      skipAuthRedirect: true,
    }),
  loginAdminKey: (apiKey: string) =>
    request<{ authenticated: boolean; token: string; expires_at: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey }),
      skipAuthRedirect: true,
    }),

  // Analytics
  getOverview: (workspaceId = 'default') =>
    request<{ data: OverviewAnalytics }>(
      `/api/analytics/overview${toQuery({ workspace_id: workspaceId })}`
    ).then((r) => r.data),

  getDeliveryAnalytics: (params: {
    workspace_id?: string;
    range?: string;
    from?: string;
    to?: string;
  }) =>
    request<{ data: DeliveryAnalyticsResponse }>(
      `/api/analytics/deliveries${toQuery(params)}`
    ).then((r) => r.data),

  // Endpoints
  listEndpoints: (params: {
    workspace_id?: string;
    enabled?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) => request<PaginatedResponse<EndpointRecord>>(`/api/endpoints${toQuery(params)}`),

  getEndpoint: (id: string) =>
    request<{ data: EndpointRecord; recent_deliveries: DeliveryRecord[] }>(
      `/api/endpoints/${encodeURIComponent(id)}`
    ),

  createEndpoint: (payload: {
    name: string;
    url: string;
    description?: string;
    subscribed_events: string[];
    enabled?: boolean;
    workspace_id?: string;
  }) =>
    request<{ data: EndpointWithSecret }>('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((r) => r.data),

  updateEndpoint: (
    id: string,
    payload: {
      name?: string;
      url?: string;
      description?: string;
      subscribed_events?: string[];
      enabled?: boolean;
    }
  ) =>
    request<{ data: EndpointRecord }>(`/api/endpoints/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }).then((r) => r.data),

  deleteEndpoint: (id: string) =>
    request<{ deleted: boolean; id: string }>(`/api/endpoints/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  rotateEndpointSecret: (id: string) =>
    request<{ data: EndpointWithSecret }>(
      `/api/endpoints/${encodeURIComponent(id)}/rotate-secret`,
      { method: 'POST' }
    ).then((r) => r.data),

  revealEndpointSecret: (id: string) =>
    request<{ data: { id: string; signing_secret: string } }>(
      `/api/endpoints/${encodeURIComponent(id)}/reveal-secret`,
      { method: 'POST' }
    ).then((r) => r.data),

  sendTestWebhook: (id: string, payload?: { event_type?: string; data?: Record<string, unknown> }) =>
    request<{ event: EventRecord; delivery: DeliveryDetail | null }>(
      `/api/endpoints/${encodeURIComponent(id)}/test`,
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      }
    ),

  // Events
  listEvents: (params: {
    workspace_id?: string;
    type?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) => request<PaginatedResponse<EventRecord>>(`/api/events${toQuery(params)}`),

  getEvent: (id: string) =>
    request<{ data: EventRecord; deliveries: DeliveryRecord[] }>(
      `/api/events/${encodeURIComponent(id)}`
    ),

  createEvent: (payload: {
    type: string;
    data: unknown;
    idempotency_key?: string;
    source?: 'api' | 'dashboard' | 'test';
    workspace_id?: string;
  }) =>
    request<{
      data: EventRecord;
      deliveries_created: number;
      delivery_ids: string[];
      idempotent_replay: boolean;
    }>('/api/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  replayEvent: (id: string, endpointIds: string[]) =>
    request<{ data: { event_id: string; replayed_delivery_ids: string[] } }>(
      `/api/events/${encodeURIComponent(id)}/replay`,
      {
        method: 'POST',
        body: JSON.stringify({ endpoint_ids: endpointIds }),
      }
    ).then((r) => r.data),

  // Deliveries
  listDeliveries: (params: {
    workspace_id?: string;
    status?: string;
    endpoint_id?: string;
    event_id?: string;
    search?: string;
    is_replay?: boolean;
    page?: number;
    limit?: number;
  } = {}) => request<PaginatedResponse<DeliveryRecord>>(`/api/deliveries${toQuery(params)}`),

  getDelivery: (id: string) =>
    request<{ data: DeliveryDetail }>(`/api/deliveries/${encodeURIComponent(id)}`).then(
      (r) => r.data
    ),

  getDeliveryAttempts: (id: string) =>
    request<{ data: DeliveryAttemptRecord[] }>(
      `/api/deliveries/${encodeURIComponent(id)}/attempts`
    ).then((r) => r.data),

  retryDelivery: (id: string) =>
    request<{ data: DeliveryRecord }>(`/api/deliveries/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    }).then((r) => r.data),

  // Dead Letter Queue
  listDeadLetters: (params: {
    workspace_id?: string;
    include_archived?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) => request<PaginatedResponse<DeliveryRecord>>(`/api/dead-letters${toQuery(params)}`),

  replayDeadLetter: (id: string) =>
    request<{ data: DeliveryRecord }>(`/api/dead-letters/${encodeURIComponent(id)}/replay`, {
      method: 'POST',
    }).then((r) => r.data),

  archiveDeadLetter: (id: string) =>
    request<{ data: DeliveryRecord }>(`/api/dead-letters/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
    }).then((r) => r.data),

  // Settings
  getSettings: () => request<{ data: RetrySettings }>('/api/settings').then((r) => r.data),
  updateSettings: (patch: Partial<RetrySettings>) =>
    request<{ data: RetrySettings }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.data),

  // Local Webhook Receiver
  getReceiverConfig: () =>
    request<{ data: ReceiverConfig }>('/api/receiver/config').then((r) => r.data),
  updateReceiverConfig: (patch: {
    mode?: ReceiverMode;
    delay_ms?: number;
    retry_after_seconds?: number;
    verification_endpoint_id?: string | null;
    custom_secret?: string | null;
  }) =>
    request<{ data: ReceiverConfig }>('/api/receiver/config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.data),
  listReceiverRequests: (limit = 50) =>
    request<{ data: ReceiverRequestLog[] }>(
      `/api/receiver/requests${toQuery({ limit })}`
    ).then((r) => r.data),
  clearReceiverRequests: () =>
    request<{ deleted: number }>('/api/receiver/requests', { method: 'DELETE' }),

  // OpenAPI Spec
  getOpenApiSpec: () => request<Record<string, unknown>>('/api/openapi.json'),
};
