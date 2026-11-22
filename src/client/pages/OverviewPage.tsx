import { useCallback, useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { RefreshCw, Plus, Radio, ArrowRight } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { DeliveryStatus, OverviewAnalytics } from '../../shared/types';
import {
  formatDuration,
  formatPercent,
  formatRelativeTime,
  truncateId,
} from '../utils/format';
import { DeliveryStatusText, EnabledStateText, HttpStatusText } from '../components/StatusText';
import type { NavSection } from '../components/Layout';

interface OverviewPageProps {
  onNavigate: (section: NavSection) => void;
  onInspectDelivery: (deliveryId: string) => void;
  onInspectEndpoint: (endpointId: string) => void;
}

const STATUS_BAR_COLORS: Record<DeliveryStatus, string> = {
  succeeded: '#10b981',
  retrying: '#f59e0b',
  pending: '#38bdf8',
  processing: '#0ea5e9',
  failed: '#f43f5e',
  dead_letter: '#e11d48',
};

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  succeeded: 'Succeeded',
  retrying: 'Retrying',
  pending: 'Pending',
  processing: 'Processing',
  failed: 'Failed',
  dead_letter: 'Dead Letter',
};

export function OverviewPage({
  onNavigate,
  onInspectDelivery,
  onInspectEndpoint,
}: OverviewPageProps) {
  const [data, setData] = useState<OverviewAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getOverview();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load overview metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-7 w-48 bg-[#141720] rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-[#111318] border border-[#1d2028] rounded-md animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-[#111318] border border-[#1d2028] rounded-md animate-pulse" />
      </div>
    );
  }

  const m = data?.metrics;
  const chartData = (data?.status_distribution || []).map((item) => ({
    status: item.status,
    label: STATUS_LABELS[item.status],
    count: item.count,
  }));

  const isEmpty = (m?.total_events ?? 0) === 0 && (data?.endpoint_health.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">Overview</h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Live delivery telemetry, endpoint health, and queue state queried directly from SQLite.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#c8cddc] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => onNavigate('events')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Dispatch Event
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
          {error}
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Total Events</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#eef0f5] tabular-nums">
            {m?.total_events ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-[#646b7d]">Persisted records</div>
        </div>

        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Successful Deliveries</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
            {m?.successful_deliveries ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-[#646b7d]">HTTP 2xx confirmed</div>
        </div>

        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Failed Deliveries</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-rose-400 tabular-nums">
            {m?.failed_deliveries ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-[#646b7d]">
            {m?.dead_letter_count ?? 0} active in DLQ
          </div>
        </div>

        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Pending Retries</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-amber-400 tabular-nums">
            {m?.pending_retries ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-[#646b7d]">Scheduled in queue</div>
        </div>

        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Success Rate</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#eef0f5] tabular-nums">
            {formatPercent(m?.success_rate)}
          </div>
          <div className="mt-1 text-[11px] text-[#646b7d]">Terminal deliveries</div>
        </div>

        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Avg Response Time</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#eef0f5] tabular-nums">
            {formatDuration(m?.avg_response_time_ms)}
          </div>
          <div className="mt-1 text-[11px] text-[#646b7d]">Across all attempts</div>
        </div>
      </div>

      {/* Empty Workspace Onboarding Banner */}
      {isEmpty && (
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-6">
          <h2 className="text-sm font-semibold text-[#eef0f5]">
            No webhook endpoints or events recorded yet
          </h2>
          <p className="text-xs text-[#8b92a5] mt-1.5 max-w-2xl leading-relaxed">
            Register an endpoint subscribed to an event type (for example{' '}
            <code className="font-mono text-[#c8cddc]">order.created</code>), or point an endpoint
            at HookRelay&apos;s built-in Local Receiver to test real HTTP delivery, HMAC-SHA256
            signature verification, and automatic exponential-backoff retries.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button
              type="button"
              onClick={() => onNavigate('endpoints')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Register First Endpoint
            </button>
            <button
              type="button"
              onClick={() => onNavigate('receiver')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#e8eaef] bg-[#161a24] hover:bg-[#1e2330] border border-[#242834] rounded-md cursor-pointer"
            >
              <Radio className="w-3.5 h-3.5 text-sky-400" />
              Open Local Test Receiver
            </button>
          </div>
        </div>
      )}

      {/* Middle Row: Status Distribution Chart + Endpoint Health */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#eef0f5]">Delivery Status Distribution</h2>
              <p className="text-xs text-[#7c8396] mt-0.5">
                Current breakdown across {m?.total_deliveries ?? 0} total deliveries
              </p>
            </div>
          </div>
          {(m?.total_deliveries ?? 0) === 0 ? (
            <div className="h-52 flex items-center justify-center text-xs text-[#646b7d]">
              Dispatch an event to populate delivery status metrics.
            </div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#8b92a5', fontSize: 11 }}
                    axisLine={{ stroke: '#1d2028' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#8b92a5', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    contentStyle={{
                      backgroundColor: '#13161e',
                      border: '1px solid #242834',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#eef0f5',
                    }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={36}>
                    {chartData.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_BAR_COLORS[entry.status]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-7 bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden flex flex-col">
          <div className="px-4 py-3.5 border-b border-[#1d2028] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[#eef0f5]">Endpoint Health</h2>
              <p className="text-xs text-[#7c8396] mt-0.5">
                Delivery reliability and latency per destination
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('endpoints')}
              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
            >
              Manage
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {!data || data.endpoint_health.length === 0 ? (
            <div className="flex-1 p-8 text-center text-xs text-[#646b7d]">
              No endpoints registered yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1d2028] text-[11px] font-medium text-[#7c8396]">
                    <th className="py-2.5 px-4">Endpoint</th>
                    <th className="py-2.5 px-3">State</th>
                    <th className="py-2.5 px-3 text-right">Deliveries</th>
                    <th className="py-2.5 px-3 text-right">Success</th>
                    <th className="py-2.5 px-3 text-right">Avg Latency</th>
                    <th className="py-2.5 px-4">Last Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181b23] text-xs">
                  {data.endpoint_health.map((ep) => (
                    <tr
                      key={ep.endpoint_id}
                      onClick={() => onInspectEndpoint(ep.endpoint_id)}
                      className="hover:bg-[#151822] transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-[#e8eaef] truncate max-w-[200px]">
                          {ep.name}
                        </div>
                        <div className="font-mono text-[11px] text-[#646b7d] truncate max-w-[220px]">
                          {ep.url}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <EnabledStateText enabled={ep.enabled} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#c8cddc]">
                        {ep.total_deliveries}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#c8cddc]">
                        {formatPercent(ep.success_rate)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#9aa1b4]">
                        {formatDuration(ep.avg_latency_ms)}
                      </td>
                      <td className="py-2.5 px-4">
                        <DeliveryStatusText status={ep.last_delivery_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Recent Deliveries + Recent Events */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[#1d2028] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#eef0f5]">Recent Delivery Attempts</h2>
            <button
              type="button"
              onClick={() => onNavigate('deliveries')}
              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {!data || data.recent_deliveries.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#646b7d]">
              No delivery attempts have been executed yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1d2028] text-[11px] font-medium text-[#7c8396]">
                    <th className="py-2.5 px-4">Delivery / Event</th>
                    <th className="py-2.5 px-3">Endpoint</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">HTTP</th>
                    <th className="py-2.5 px-3 text-right">Attempts</th>
                    <th className="py-2.5 px-4 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181b23] text-xs">
                  {data.recent_deliveries.map((del) => (
                    <tr
                      key={del.id}
                      onClick={() => onInspectDelivery(del.id)}
                      className="hover:bg-[#151822] transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <div className="font-mono text-[#e8eaef]">{del.event_type}</div>
                        <div className="font-mono text-[11px] text-[#646b7d]">
                          {truncateId(del.id)}
                          {del.is_replay ? ' · Replay' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[#c8cddc] truncate max-w-[160px]">
                        {del.endpoint_name}
                      </td>
                      <td className="py-2.5 px-3">
                        <DeliveryStatusText status={del.status} />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <HttpStatusText status={del.last_http_status} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#9aa1b4]">
                        {del.attempt_count}/{del.max_attempts}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#7c8396]">
                        {formatRelativeTime(del.last_attempt_at || del.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[#1d2028] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#eef0f5]">Recent Events</h2>
            <button
              type="button"
              onClick={() => onNavigate('events')}
              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {!data || data.recent_events.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#646b7d]">
              No events ingested yet.
            </div>
          ) : (
            <div className="divide-y divide-[#181b23]">
              {data.recent_events.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => onNavigate('events')}
                  className="px-4 py-3 hover:bg-[#151822] transition-colors cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-medium text-[#e8eaef] truncate">
                      {ev.type}
                    </div>
                    <div className="text-[11px] text-[#646b7d] font-mono mt-0.5 flex items-center gap-1.5">
                      <span>{truncateId(ev.id)}</span>
                      <span>·</span>
                      <span>
                        {ev.delivery_summary?.succeeded ?? 0}/{ev.delivery_summary?.total ?? 0}{' '}
                        delivered
                      </span>
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-[#7c8396] whitespace-nowrap tabular-nums">
                    {formatRelativeTime(ev.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
