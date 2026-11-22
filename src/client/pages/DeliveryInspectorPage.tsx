import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, RotateCw, RotateCcw } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { DeliveryDetail } from '../../shared/types';
import {
  formatDuration,
  formatIsoShort,
  formatRelativeTime,
} from '../utils/format';
import {
  AttemptOutcomeText,
  DeliveryStatusText,
  HttpStatusText,
} from '../components/StatusText';
import { JsonViewer } from '../components/JsonViewer';

interface DeliveryInspectorPageProps {
  deliveryId: string;
  onBack: () => void;
  onInspectDelivery: (id: string) => void;
}

export function DeliveryInspectorPage({
  deliveryId,
  onBack,
  onInspectDelivery,
}: DeliveryInspectorPageProps) {
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [selectedAttemptIdx, setSelectedAttemptIdx] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getDelivery(deliveryId);
      setDetail(res);
      setSelectedAttemptIdx((prev) => {
        if (res.attempts.length === 0) return 0;
        return Math.min(prev, res.attempts.length - 1);
      });
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load delivery detail');
    } finally {
      setLoading(false);
    }
  }, [deliveryId]);

  useEffect(() => {
    setLoading(true);
    setSelectedAttemptIdx(0);
    void load();
  }, [load]);

  const handleManualRetry = async () => {
    setActionLoading(true);
    try {
      await api.retryDelivery(deliveryId);
      setTimeout(() => void load(), 600);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to trigger manual retry');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReplayFromDlq = async () => {
    setActionLoading(true);
    try {
      const replayed = await api.replayDeadLetter(deliveryId);
      onInspectDelivery(replayed.id);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to replay delivery');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 bg-[#141720] rounded animate-pulse" />
        <div className="h-44 bg-[#111318] border border-[#1d2028] rounded-md animate-pulse" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Deliveries
        </button>
        <div className="px-4 py-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
          {error || 'Delivery not found.'}
        </div>
      </div>
    );
  }

  const activeAttempt = detail.attempts[selectedAttemptIdx] || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 text-[#8b92a5] hover:text-[#eef0f5] bg-[#13161e] border border-[#222633] rounded-md cursor-pointer"
            aria-label="Back to deliveries"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-semibold font-mono text-[#eef0f5]">{detail.id}</h1>
              <DeliveryStatusText status={detail.status} />
              {detail.is_replay && (
                <span className="text-xs font-mono text-sky-400">
                  Replay Execution
                </span>
              )}
            </div>
            <div className="text-xs text-[#8b92a5] mt-0.5 font-mono truncate">
              POST {detail.endpoint_url}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#c8cddc] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {detail.status !== 'succeeded' && detail.status !== 'processing' && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void handleManualRetry()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#061018] bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-md cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              Retry Now
            </button>
          )}
          {detail.status === 'dead_letter' && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void handleReplayFromDlq()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Replay as New Delivery
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
          {error}
        </div>
      )}

      {/* Delivery Metadata Grid */}
      <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-[#7c8396]">Event ID</div>
            <div className="font-mono text-[#e8eaef] mt-1 break-all">{detail.event_id}</div>
          </div>
          <div>
            <div className="text-[#7c8396]">Event Type</div>
            <div className="font-mono text-sky-300 mt-1">{detail.event_type}</div>
          </div>
          <div>
            <div className="text-[#7c8396]">Endpoint Name</div>
            <div className="text-[#e8eaef] font-medium mt-1">{detail.endpoint_name}</div>
          </div>
          <div>
            <div className="text-[#7c8396]">Attempt Count</div>
            <div className="font-mono text-[#e8eaef] tabular-nums mt-1">
              {detail.attempt_count} / {detail.max_attempts}
            </div>
          </div>
          <div>
            <div className="text-[#7c8396]">Created Timestamp</div>
            <div className="font-mono text-[#c8cddc] tabular-nums mt-1">
              {formatIsoShort(detail.created_at)}
            </div>
          </div>
          <div>
            <div className="text-[#7c8396]">Last Attempt</div>
            <div className="font-mono text-[#c8cddc] tabular-nums mt-1">
              {formatIsoShort(detail.last_attempt_at)}
            </div>
          </div>
          <div>
            <div className="text-[#7c8396]">Next Retry Scheduled</div>
            <div className="font-mono text-amber-300 tabular-nums mt-1">
              {detail.next_attempt_at
                ? `${formatIsoShort(detail.next_attempt_at)} (${formatRelativeTime(detail.next_attempt_at)})`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[#7c8396]">Total Processing Duration</div>
            <div className="font-mono text-[#e8eaef] tabular-nums mt-1">
              {formatDuration(detail.total_duration_ms)}
            </div>
          </div>
        </div>

        {detail.replay_of_delivery_id && (
          <div className="mt-4 pt-3 border-t border-[#1d2028] text-xs text-[#8b92a5] flex items-center gap-2">
            <span>Replayed from original delivery:</span>
            <button
              type="button"
              onClick={() => onInspectDelivery(detail.replay_of_delivery_id!)}
              className="font-mono text-sky-400 hover:text-sky-300 underline cursor-pointer"
            >
              {detail.replay_of_delivery_id}
            </button>
          </div>
        )}

        {detail.last_error && (
          <div className="mt-4 px-3 py-2 text-xs font-mono text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded">
            Last error: {detail.last_error}
          </div>
        )}
      </div>

      {/* Attempt History Timeline & Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-[#eef0f5]">
            Delivery Attempts ({detail.attempts.length})
          </div>
          {detail.attempts.length === 0 ? (
            <div className="p-6 text-xs text-[#646b7d]">
              Queued — awaiting worker execution. Click Refresh shortly.
            </div>
          ) : (
            <div className="divide-y divide-[#181b23]">
              {detail.attempts.map((att, idx) => {
                const selected = idx === selectedAttemptIdx;
                return (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() => setSelectedAttemptIdx(idx)}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      selected ? 'bg-[#181d29]' : 'hover:bg-[#141720]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-[#eef0f5]">
                        Attempt #{att.attempt_number}
                      </span>
                      <div className="flex items-center gap-2">
                        <HttpStatusText status={att.response_status} />
                        <span className="font-mono text-[11px] text-[#7c8396] tabular-nums">
                          {formatDuration(att.latency_ms)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <AttemptOutcomeText outcome={att.outcome} />
                      <span className="font-mono text-[11px] text-[#646b7d] tabular-nums">
                        {formatIsoShort(att.created_at)}
                      </span>
                    </div>
                    {att.error_message && (
                      <div className="mt-1 font-mono text-[11px] text-rose-300/90 truncate">
                        {att.error_message}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-8 space-y-4">
          {!activeAttempt ? (
            <div className="bg-[#111318] border border-[#1d2028] rounded-md p-6">
              <JsonViewer title="Event Payload (Pending Dispatch)" value={detail.event_raw_payload} />
            </div>
          ) : (
            <>
              {/* Request Details */}
              <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[#eef0f5]">
                    Request · Attempt #{activeAttempt.attempt_number}
                  </h2>
                  <span className="font-mono text-[11px] text-[#7c8396] tabular-nums">
                    Sent {formatIsoShort(activeAttempt.created_at)}
                  </span>
                </div>

                <div className="font-mono text-xs text-[#c8cddc] bg-[#0c0d11] border border-[#1d2028] px-3 py-2 rounded break-all">
                  <span className="text-sky-400 mr-2">{activeAttempt.request_method}</span>
                  {activeAttempt.request_url}
                </div>

                <JsonViewer
                  title="Request Headers (Sensitive values redacted)"
                  value={activeAttempt.request_headers}
                  maxHeightClass="max-h-56"
                />
                <JsonViewer
                  title="Request Body (Signed raw JSON)"
                  value={activeAttempt.request_body}
                  maxHeightClass="max-h-72"
                />
              </div>

              {/* Response Details */}
              <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[#eef0f5]">Response</h2>
                  <div className="flex items-center gap-3 text-xs">
                    <span>
                      Status: <HttpStatusText status={activeAttempt.response_status} />
                    </span>
                    <span className="text-[#2b303f]">·</span>
                    <span className="font-mono text-[#c8cddc] tabular-nums">
                      Latency: {formatDuration(activeAttempt.latency_ms)}
                    </span>
                  </div>
                </div>

                {activeAttempt.error_message && (
                  <div className="px-3 py-2 text-xs font-mono text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded">
                    {activeAttempt.error_code ? `[${activeAttempt.error_code}] ` : ''}
                    {activeAttempt.error_message}
                  </div>
                )}

                {activeAttempt.response_headers && (
                  <JsonViewer
                    title="Response Headers"
                    value={activeAttempt.response_headers}
                    maxHeightClass="max-h-48"
                  />
                )}

                <JsonViewer
                  title="Response Body"
                  value={activeAttempt.response_body}
                  maxHeightClass="max-h-64"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
