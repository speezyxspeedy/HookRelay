import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCw } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { DeliveryRecord } from '../../shared/types';
import { formatDuration, formatRelativeTime, truncateId } from '../utils/format';
import { DeliveryStatusText, HttpStatusText } from '../components/StatusText';

interface DeliveriesPageProps {
  onInspectDelivery: (deliveryId: string) => void;
  searchQuery?: string;
}

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'succeeded', label: 'Succeeded' },
  { id: 'retrying', label: 'Retrying' },
  { id: 'pending', label: 'Pending' },
  { id: 'dead_letter', label: 'Dead Letter' },
] as const;

export function DeliveriesPage({
  onInspectDelivery,
  searchQuery = '',
}: DeliveriesPageProps) {
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [originFilter, setOriginFilter] = useState<'all' | 'original' | 'replay'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listDeliveries({
        status: statusFilter === 'all' ? undefined : statusFilter,
        is_replay:
          originFilter === 'all' ? undefined : originFilter === 'replay' ? true : false,
        search: searchQuery || undefined,
        page,
        limit: 25,
      });
      setDeliveries(res.data);
      setTotal(res.pagination.total);
      setTotalPages(res.pagination.total_pages);
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, originFilter, searchQuery, page]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const handleManualRetry = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setRetryingId(id);
    try {
      await api.retryDelivery(id);
      await load();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Manual retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">Deliveries</h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Click any delivery row to inspect full request headers, raw payload, response body, and
            attempt timeline.
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

      {/* Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center p-1 bg-[#111318] border border-[#1d2028] rounded-md">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setPage(1);
                }}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[#1c212e] text-[#eef0f5]'
                    : 'text-[#8b92a5] hover:text-[#d8dce6]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center p-1 bg-[#111318] border border-[#1d2028] rounded-md">
            {(
              [
                ['all', 'All Executions'],
                ['original', 'Original'],
                ['replay', 'Replays'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setOriginFilter(id);
                  setPage(1);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  originFilter === id
                    ? 'bg-[#1c212e] text-[#eef0f5]'
                    : 'text-[#8b92a5] hover:text-[#d8dce6]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <span className="text-xs font-mono text-[#7c8396] tabular-nums">
          {total} record{total === 1 ? '' : 's'}
        </span>
      </div>

      {/* Table */}
      <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-xs text-[#7c8396]">Loading deliveries...</div>
        ) : deliveries.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#646b7d]">
            No deliveries match the selected filters.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1d2028] text-[11px] font-medium text-[#7c8396]">
                    <th className="py-2.5 px-4">Delivery / Event</th>
                    <th className="py-2.5 px-3">Endpoint</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">HTTP</th>
                    <th className="py-2.5 px-3 text-right">Attempts</th>
                    <th className="py-2.5 px-3 text-right">Latency</th>
                    <th className="py-2.5 px-3 text-right">Next Retry</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181b23] text-xs">
                  {deliveries.map((del) => (
                    <tr
                      key={del.id}
                      onClick={() => onInspectDelivery(del.id)}
                      className="hover:bg-[#151822] transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <div className="font-mono text-[#eef0f5]">
                          {del.event_type}
                          {del.is_replay ? (
                            <span className="ml-2 text-[11px] text-sky-400">Replay</span>
                          ) : null}
                        </div>
                        <div className="font-mono text-[11px] text-[#646b7d]">
                          {truncateId(del.id)} · {truncateId(del.event_id)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-[#d8dce6] truncate max-w-[180px]">
                          {del.endpoint_name}
                        </div>
                        <div className="font-mono text-[11px] text-[#646b7d] truncate max-w-[200px]">
                          {del.endpoint_url}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <DeliveryStatusText status={del.status} />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <HttpStatusText status={del.last_http_status} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#c8cddc]">
                        {del.attempt_count}/{del.max_attempts}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#9aa1b4]">
                        {formatDuration(del.last_latency_ms)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#7c8396]">
                        {del.next_attempt_at ? formatRelativeTime(del.next_attempt_at) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {del.status !== 'succeeded' && del.status !== 'processing' ? (
                          <button
                            type="button"
                            disabled={retryingId === del.id}
                            onClick={(e) => void handleManualRetry(e, del.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-300 bg-[#161a24] hover:bg-[#1f2433] border border-[#242834] rounded cursor-pointer whitespace-nowrap"
                          >
                            <RotateCw className="w-3 h-3" />
                            Retry
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#646b7d]">Inspect</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-[#1d2028] flex items-center justify-between text-xs text-[#8b92a5]">
                <span className="font-mono tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-2.5 py-1 bg-[#161a24] disabled:opacity-40 rounded cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-2.5 py-1 bg-[#161a24] disabled:opacity-40 rounded cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
