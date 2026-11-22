import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  RefreshCw,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Plus,
} from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type {
  EndpointRecord,
  ReceiverConfig,
  ReceiverMode,
  ReceiverRequestLog,
} from '../../shared/types';
import { formatIsoShort, truncateId } from '../utils/format';
import { HttpStatusText } from '../components/StatusText';
import { JsonViewer } from '../components/JsonViewer';

const RESPONSE_MODES: Array<{
  id: ReceiverMode;
  label: string;
  desc: string;
}> = [
  { id: '200_ok', label: '200 Success', desc: 'Returns HTTP 200 OK immediately' },
  {
    id: '400_bad_request',
    label: '400 Permanent Failure',
    desc: 'Non-retryable client error (moves directly to DLQ)',
  },
  {
    id: '429_rate_limited',
    label: '429 Rate Limited',
    desc: 'Returns HTTP 429 with Retry-After header',
  },
  {
    id: '500_server_error',
    label: '500 Temporary Failure',
    desc: 'Transient server error triggering exponential backoff',
  },
  {
    id: 'delayed_200',
    label: 'Delayed 200 Response',
    desc: 'Holds response for configured latency before 200 OK',
  },
  {
    id: 'timeout',
    label: 'Connection Timeout',
    desc: 'Holds socket past dispatcher timeout to verify timeout retries',
  },
];

export function ReceiverPage() {
  const [config, setConfig] = useState<ReceiverConfig | null>(null);
  const [requests, setRequests] = useState<ReceiverRequestLog[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointRecord[]>([]);
  const [selectedLog, setSelectedLog] = useState<ReceiverRequestLog | null>(null);
  const [delayMs, setDelayMs] = useState(1500);
  const [retryAfter, setRetryAfter] = useState(5);
  const [saving, setSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfg, reqs, eps] = await Promise.all([
        api.getReceiverConfig(),
        api.listReceiverRequests(50),
        api.listEndpoints({ limit: 100 }),
      ]);
      setConfig(cfg);
      setDelayMs(cfg.delay_ms);
      setRetryAfter(cfg.retry_after_seconds);
      setRequests(reqs);
      setEndpoints(eps.data);
      setSelectedLog((prev) => {
        if (!prev && reqs.length > 0) return reqs[0];
        if (prev) return reqs.find((r) => r.id === prev.id) || reqs[0] || null;
        return null;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load receiver state');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  const handleModeChange = async (mode: ReceiverMode) => {
    setSaving(true);
    try {
      const updated = await api.updateReceiverConfig({
        mode,
        delay_ms: delayMs,
        retry_after_seconds: retryAfter,
      });
      setConfig(updated);
      setNotice(`Receiver response mode updated to ${mode}.`);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to update receiver mode');
    } finally {
      setSaving(false);
    }
  };

  const handleTimingSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateReceiverConfig({
        delay_ms: delayMs,
        retry_after_seconds: retryAfter,
      });
      setConfig(updated);
      setNotice('Receiver timing settings saved.');
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to update receiver timing');
    } finally {
      setSaving(false);
    }
  };

  const handleVerificationEndpointChange = async (endpointId: string) => {
    setSaving(true);
    try {
      const updated = await api.updateReceiverConfig({
        verification_endpoint_id: endpointId || null,
      });
      setConfig(updated);
    } catch (err) {
      setError(
        err instanceof ClientApiError ? err.message : 'Failed to update verification secret'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      await api.clearReceiverRequests();
      setRequests([]);
      setSelectedLog(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to clear receiver logs');
    }
  };

  const handleQuickRegister = async () => {
    if (!config) return;
    setError(null);
    try {
      const ep = await api.createEndpoint({
        name: 'Local Test Receiver',
        url: config.receiver_url,
        description: 'Built-in HookRelay local webhook consumer for live end-to-end testing',
        subscribed_events: ['*'],
        enabled: true,
      });
      await api.updateReceiverConfig({ verification_endpoint_id: ep.id });
      setNotice(
        `Registered endpoint "${ep.name}" subscribed to "*" and linked its signing secret to the Local Receiver.`
      );
      await load();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to register local endpoint');
    }
  };

  const handleCopyUrl = async () => {
    if (!config) return;
    try {
      await navigator.clipboard.writeText(config.receiver_url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Ignore
    }
  };

  const hasLocalEndpoint = endpoints.some((ep) => ep.url === config?.receiver_url);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">
            Local Webhook Receiver
          </h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Real backend HTTP POST consumer that verifies{' '}
            <code className="font-mono text-[#c8cddc]">X-HookRelay-Signature</code> against the
            exact raw body and simulates real success, failure, rate-limit, and timeout behaviors.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!hasLocalEndpoint && config && (
            <button
              type="button"
              onClick={() => void handleQuickRegister()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Register Receiver as Endpoint
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#c8cddc] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleClear()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 bg-[#13161e] hover:bg-rose-500/10 border border-[#222633] rounded-md cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Log
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-3 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md flex items-center justify-between">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-[#8b92a5] hover:text-[#eef0f5] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
          {error}
        </div>
      )}

      {/* Receiver URL & Response Mode Controls */}
      <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-7">
            <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
              Local Receiver Destination URL
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 bg-[#0a0b0e] border border-[#242834] rounded-md font-mono text-xs text-sky-300 truncate">
                {config?.receiver_url || 'http://127.0.0.1:3000/api/receiver/ingest'}
              </div>
              <button
                type="button"
                onClick={() => void handleCopyUrl()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-[#e8eaef] bg-[#161a24] hover:bg-[#1e2330] border border-[#242834] rounded-md cursor-pointer shrink-0"
              >
                {copiedUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy URL
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="lg:col-span-5">
            <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
              HMAC Verification Secret Source
            </label>
            <select
              value={config?.verification_endpoint_id || ''}
              onChange={(e) => void handleVerificationEndpointChange(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#0a0b0e] border border-[#242834] rounded-md text-[#e8eaef] focus:outline-none focus:border-sky-500"
            >
              <option value="">Auto-resolve from HookRelay Delivery ID</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  Endpoint: {ep.name} ({ep.secret_preview})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mode Selector */}
        <div>
          <div className="text-xs font-medium text-[#c8cddc] mb-2">Simulated HTTP Response Mode</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {RESPONSE_MODES.map((m) => {
              const active = config?.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={saving}
                  onClick={() => void handleModeChange(m.id)}
                  className={`text-left px-3 py-2.5 rounded-md border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#171d2b] border-sky-500/60 text-[#eef0f5]'
                      : 'bg-[#0d0f14] border-[#1d2028] text-[#9aa1b4] hover:border-[#2c3140] hover:text-[#e8eaef]'
                  }`}
                >
                  <div className="text-xs font-semibold">{m.label}</div>
                  <div className="text-[11px] text-[#7c8396] mt-0.5">{m.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {(config?.mode === 'delayed_200' || config?.mode === '429_rate_limited') && (
          <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-[#1d2028]">
            {config.mode === 'delayed_200' && (
              <div>
                <label className="block text-[11px] text-[#8b92a5] mb-1">
                  Response Delay (ms)
                </label>
                <input
                  type="number"
                  min={100}
                  max={30000}
                  step={100}
                  value={delayMs}
                  onChange={(e) => setDelayMs(Number(e.target.value))}
                  className="w-32 px-2.5 py-1.5 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded text-[#e8eaef]"
                />
              </div>
            )}
            {config.mode === '429_rate_limited' && (
              <div>
                <label className="block text-[11px] text-[#8b92a5] mb-1">
                  Retry-After Header (seconds)
                </label>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={retryAfter}
                  onChange={(e) => setRetryAfter(Number(e.target.value))}
                  className="w-32 px-2.5 py-1.5 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded text-[#e8eaef]"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleTimingSave()}
              className="px-3 py-1.5 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded cursor-pointer"
            >
              Save Timing
            </button>
          </div>
        )}
      </div>

      {/* Received Requests Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-[#1d2028] flex items-center justify-between text-xs">
            <span className="font-semibold text-[#eef0f5]">
              Incoming HTTP Requests ({requests.length})
            </span>
          </div>
          {requests.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#646b7d]">
              Waiting for incoming webhook POST requests. Register this URL as an endpoint and
              dispatch an event or send a test webhook.
            </div>
          ) : (
            <div className="divide-y divide-[#181b23] max-h-[540px] overflow-y-auto">
              {requests.map((req) => {
                const active = selectedLog?.id === req.id;
                return (
                  <button
                    key={req.id}
                    type="button"
                    onClick={() => setSelectedLog(req)}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      active ? 'bg-[#181d29]' : 'hover:bg-[#141720]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium text-[#eef0f5] truncate">
                        {req.event_type || 'unknown.event'}
                      </span>
                      <HttpStatusText status={req.response_status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-[#7c8396]">
                        {req.delivery_id ? truncateId(req.delivery_id) : truncateId(req.id)}
                        {req.attempt_number ? ` · Att #${req.attempt_number}` : ''}
                      </span>
                      {req.signature_valid ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <ShieldCheck className="w-3 h-3" />
                          HMAC Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400">
                          <ShieldAlert className="w-3 h-3" />
                          Invalid Sig
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-7 space-y-4">
          {!selectedLog ? (
            <div className="bg-[#111318] border border-[#1d2028] rounded-md p-8 text-center text-xs text-[#646b7d]">
              Select a received request to inspect its verified signature, HookRelay headers, and
              raw JSON payload.
            </div>
          ) : (
            <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#1d2028]">
                <div>
                  <div className="font-mono text-sm font-semibold text-[#eef0f5]">
                    {selectedLog.event_type || 'Incoming Webhook'}
                  </div>
                  <div className="font-mono text-[11px] text-[#7c8396] mt-0.5 tabular-nums">
                    Received {formatIsoShort(selectedLog.received_at)}
                  </div>
                </div>
                {selectedLog.signature_valid ? (
                  <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    HMAC-SHA256 Verified
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
                    <ShieldAlert className="w-4 h-4" />
                    {selectedLog.signature_error || 'Signature Verification Failed'}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-[#7c8396]">Event ID</div>
                  <div className="font-mono text-[#e8eaef] mt-0.5 truncate">
                    {selectedLog.event_id || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[#7c8396]">Delivery ID</div>
                  <div className="font-mono text-[#e8eaef] mt-0.5 truncate">
                    {selectedLog.delivery_id || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[#7c8396]">Attempt</div>
                  <div className="font-mono text-[#e8eaef] mt-0.5 tabular-nums">
                    {selectedLog.attempt_number ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[#7c8396]">Returned HTTP</div>
                  <div className="mt-0.5">
                    <HttpStatusText status={selectedLog.response_status} />
                  </div>
                </div>
              </div>

              <JsonViewer title="Incoming Headers" value={selectedLog.headers} maxHeightClass="max-h-56" />
              <JsonViewer title="Raw Request Body" value={selectedLog.body} maxHeightClass="max-h-72" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
