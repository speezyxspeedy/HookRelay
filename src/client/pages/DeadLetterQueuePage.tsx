import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, Archive, AlertOctagon } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { DeliveryRecord } from '../../shared/types';
import { formatRelativeTime, truncateId } from '../utils/format';
import { HttpStatusText } from '../components/StatusText';

interface DeadLetterQueuePageProps {
  onInspectDelivery: (deliveryId: string) => void;
}

export function DeadLetterQueuePage({ onInspectDelivery }: DeadLetterQueuePageProps) {
  const [items, setItems] = useState<DeliveryRecord[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listDeadLetters({
        include_archived: includeArchived,
        limit: 100,
      });
      setItems(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load dead letter queue');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReplay = async (e: React.MouseEvent, del: DeliveryRecord) => {
    e.stopPropagation();
    setBusyId(del.id);
    setError(null);
    try {
      const replayed = await api.replayDeadLetter(del.id);
      setNotice(
        `Created new replay delivery ${replayed.id} from ${del.id}. Historical attempts remain preserved.`
      );
      await load();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to replay dead letter');
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (e: React.MouseEvent, del: DeliveryRecord) => {
    e.stopPropagation();
    setBusyId(del.id);
    setError(null);
    try {
      await api.archiveDeadLetter(del.id);
      setNotice(`Archived dead letter ${del.id}. Attempt logs remain queryable.`);
      await load();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to archive dead letter');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">
            Dead Letter Queue
          </h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Deliveries that exhausted all retry attempts or received permanent non-retryable errors.
            Replaying spawns a fresh delivery execution while retaining full attempt history.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-[#9aa1b4] cursor-pointer">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded border-[#2c3140] bg-[#0a0b0e] text-sky-400"
            />
            Show archived
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#c8cddc] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
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

      <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-xs text-[#7c8396]">Loading dead letter queue...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <AlertOctagon className="w-6 h-6 text-[#525866] mx-auto" />
            <div className="text-sm font-medium text-[#e8eaef]">No dead-lettered deliveries</div>
            <p className="text-xs text-[#7c8396] max-w-md mx-auto">
              Deliveries appear here only after exhausting all configured retry attempts or failing
              permanently (such as HTTP 400).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#1d2028] text-[11px] font-medium text-[#7c8396]">
                  <th className="py-2.5 px-4">Delivery / Event</th>
                  <th className="py-2.5 px-3">Endpoint</th>
                  <th className="py-2.5 px-3 text-right">HTTP</th>
                  <th className="py-2.5 px-3 text-right">Attempts</th>
                  <th className="py-2.5 px-3">Failure Reason</th>
                  <th className="py-2.5 px-3 text-right">Failed</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181b23] text-xs">
                {items.map((del) => (
                  <tr
                    key={del.id}
                    onClick={() => onInspectDelivery(del.id)}
                    className={`hover:bg-[#151822] transition-colors cursor-pointer ${
                      del.dlq_archived ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-[#eef0f5]">
                        {del.event_type}
                        {del.dlq_archived ? (
                          <span className="ml-2 text-[11px] text-[#7c8396]">Archived</span>
                        ) : null}
                      </div>
                      <div className="font-mono text-[11px] text-[#646b7d]">
                        {truncateId(del.id)} · {truncateId(del.event_id)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-[#d8dce6] truncate max-w-[170px]">
                        {del.endpoint_name}
                      </div>
                      <div className="font-mono text-[11px] text-[#646b7d] truncate max-w-[200px]">
                        {del.endpoint_url}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <HttpStatusText status={del.last_http_status} />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#c8cddc]">
                      {del.attempt_count}/{del.max_attempts}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-rose-300 max-w-[240px] truncate">
                      {del.last_error || 'Exhausted max attempts'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#7c8396]">
                      {formatRelativeTime(del.completed_at || del.updated_at)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyId === del.id}
                          onClick={(e) => void handleReplay(e, del)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-sky-300 bg-[#161a24] hover:bg-[#1f2433] border border-[#242834] rounded cursor-pointer whitespace-nowrap"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Replay
                        </button>
                        {!del.dlq_archived && (
                          <button
                            type="button"
                            disabled={busyId === del.id}
                            onClick={(e) => void handleArchive(e, del)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#9aa1b4] hover:text-[#eef0f5] bg-[#161a24] hover:bg-[#1f2433] border border-[#242834] rounded cursor-pointer whitespace-nowrap"
                          >
                            <Archive className="w-3 h-3" />
                            Archive
                          </button>
                        )}
                      </div>
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
