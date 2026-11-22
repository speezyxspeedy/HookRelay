import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCw, Clock } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { DeliveryRecord } from '../../shared/types';
import { formatIsoShort, formatRelativeTime, truncateId } from '../utils/format';
import { DeliveryStatusText, HttpStatusText } from '../components/StatusText';

interface RetryQueuePageProps {
  onInspectDelivery: (deliveryId: string) => void;
}

export function RetryQueuePage({ onInspectDelivery }: RetryQueuePageProps) {
  const [items, setItems] = useState<DeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listDeliveries({
        status: 'retrying,pending,processing',
        limit: 100,
      });
      setItems(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load retry queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  const handleRetryNow = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setRetryingId(id);
    try {
      await api.retryDelivery(id);
      setTimeout(() => void load(), 500);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to execute immediate retry');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">Retry Queue</h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Persistent SQLite queue of scheduled retries using exponential backoff and Retry-After
            headers. Survives server restarts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#c8cddc] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
          {error}
        </div>
      )}

      <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-xs text-[#7c8396]">Loading scheduled retries...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Clock className="w-6 h-6 text-[#525866] mx-auto" />
            <div className="text-sm font-medium text-[#e8eaef]">Retry queue is empty</div>
            <p className="text-xs text-[#7c8396] max-w-md mx-auto">
              Transient failures (HTTP 5xx, 408, 429, timeouts, or connection errors) automatically
              appear here with their scheduled next retry timestamp.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#1d2028] text-[11px] font-medium text-[#7c8396]">
                  <th className="py-2.5 px-4">Delivery / Event</th>
                  <th className="py-2.5 px-3">Endpoint</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Attempts</th>
                  <th className="py-2.5 px-3 text-right">Last HTTP</th>
                  <th className="py-2.5 px-3">Next Scheduled Attempt</th>
                  <th className="py-2.5 px-3">Last Failure Reason</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181b23] text-xs">
                {items.map((del) => (
                  <tr
                    key={del.id}
                    onClick={() => onInspectDelivery(del.id)}
                    className="hover:bg-[#151822] transition-colors cursor-pointer"
                  >
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-[#eef0f5]">{del.event_type}</div>
                      <div className="font-mono text-[11px] text-[#646b7d]">
                        {truncateId(del.id)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-[#c8cddc] truncate max-w-[160px]">
                      {del.endpoint_name}
                    </td>
                    <td className="py-2.5 px-3">
                      <DeliveryStatusText status={del.status} />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#e8eaef]">
                      {del.attempt_count}/{del.max_attempts}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <HttpStatusText status={del.last_http_status} />
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">
                      <div className="text-amber-300">
                        {formatRelativeTime(del.next_attempt_at)}
                      </div>
                      <div className="text-[11px] text-[#646b7d]">
                        {formatIsoShort(del.next_attempt_at)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-rose-300/90 max-w-[220px] truncate">
                      {del.last_error || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        disabled={retryingId === del.id || del.status === 'processing'}
                        onClick={(e) => void handleRetryNow(e, del.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-300 bg-[#161a24] hover:bg-[#1f2433] border border-[#242834] disabled:opacity-40 rounded cursor-pointer whitespace-nowrap"
                      >
                        <RotateCw className="w-3 h-3" />
                        Retry Now
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
