import { useCallback, useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { RefreshCw } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { DeliveryAnalyticsResponse } from '../../shared/types';
import { formatDuration, formatPercent, truncateId } from '../utils/format';

export function AnalyticsPage() {
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'custom'>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<DeliveryAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params =
        range === 'custom' && customFrom && customTo
          ? {
              range: 'custom',
              from: new Date(customFrom).toISOString(),
              to: new Date(customTo).toISOString(),
            }
          : { range: range === 'custom' ? '7d' : range };
      const res = await api.getDeliveryAnalytics(params);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [range, customFrom, customTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">Analytics</h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Real SQLite aggregations over stored delivery records and HTTP attempt latencies.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 bg-[#111318] border border-[#1d2028] rounded-md">
            {(
              [
                ['24h', 'Last 24h'],
                ['7d', 'Last 7d'],
                ['30d', 'Last 30d'],
                ['custom', 'Custom'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRange(id)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  range === id
                    ? 'bg-[#1c212e] text-[#eef0f5]'
                    : 'text-[#8b92a5] hover:text-[#d8dce6]'
                }`}
              >
                {label}
              </button>
            ))}
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
      </div>

      {range === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 bg-[#111318] border border-[#1d2028] rounded-md p-3">
          <div>
            <label className="block text-[11px] text-[#7c8396] mb-1">From (UTC / Local)</label>
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded text-[#e8eaef]"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#7c8396] mb-1">To</label>
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded text-[#e8eaef]"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3.5 py-1.5 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded cursor-pointer"
          >
            Apply Range
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
          {error}
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Total Deliveries</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#eef0f5] tabular-nums">
            {s?.total_deliveries ?? 0}
          </div>
        </div>
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Total HTTP Attempts</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#eef0f5] tabular-nums">
            {s?.total_attempts ?? 0}
          </div>
        </div>
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Retried Deliveries</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-amber-400 tabular-nums">
            {s?.retried_deliveries ?? 0}
          </div>
        </div>
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Retry Frequency</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-amber-300 tabular-nums">
            {formatPercent(s?.retry_rate)}
          </div>
        </div>
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">Avg Latency</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-[#eef0f5] tabular-nums">
            {formatDuration(s?.avg_latency_ms)}
          </div>
        </div>
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
          <div className="text-xs text-[#8b92a5]">P95 Latency</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-sky-300 tabular-nums">
            {formatDuration(s?.p95_latency_ms)}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className="h-64 bg-[#111318] border border-[#1d2028] rounded-md animate-pulse" />
      ) : (
        <>
          {/* Charts Row 1: Success & Failure Rate Over Time */}
          <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
            <h2 className="text-sm font-semibold text-[#eef0f5]">
              Success & Failure Rate Over Time
            </h2>
            <p className="text-xs text-[#7c8396] mt-0.5 mb-4">
              Percentage of succeeded vs failed deliveries per time bucket
            </p>
            {!data || data.time_series.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-xs text-[#646b7d]">
                No deliveries recorded in the selected time range.
              </div>
            ) : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.time_series}
                    margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                  >
                    <CartesianGrid stroke="#181b23" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucket"
                      tick={{ fill: '#8b92a5', fontSize: 11 }}
                      axisLine={{ stroke: '#1d2028' }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      unit="%"
                      tick={{ fill: '#8b92a5', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#13161e',
                        border: '1px solid #242834',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#eef0f5',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="success_rate"
                      name="Success Rate (%)"
                      stroke="#10b981"
                      fill="rgba(16, 185, 129, 0.14)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="failure_rate"
                      name="Failure Rate (%)"
                      stroke="#f43f5e"
                      fill="rgba(244, 63, 94, 0.12)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Charts Row 2: Latency Distribution + HTTP Status Code Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
              <h2 className="text-sm font-semibold text-[#eef0f5]">
                Delivery Latency Distribution
              </h2>
              <p className="text-xs text-[#7c8396] mt-0.5 mb-4">
                HTTP attempt response times grouped by latency bucket
              </p>
              {!data || data.summary.total_attempts === 0 ? (
                <div className="h-52 flex items-center justify-center text-xs text-[#646b7d]">
                  No attempt latency samples yet.
                </div>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.latency_distribution}
                      margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                    >
                      <XAxis
                        dataKey="bucket"
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
                        }}
                      />
                      <Bar dataKey="count" name="Attempts" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4">
              <h2 className="text-sm font-semibold text-[#eef0f5]">
                HTTP Response Code Distribution
              </h2>
              <p className="text-xs text-[#7c8396] mt-0.5 mb-4">
                Observed status codes and network errors across attempts
              </p>
              {!data || data.status_code_distribution.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-xs text-[#646b7d]">
                  No response codes recorded in this period.
                </div>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.status_code_distribution}
                      margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                    >
                      <XAxis
                        dataKey="code"
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
                        }}
                      />
                      <Bar dataKey="count" name="Attempts" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Tables Row: Unreliable Endpoints, Most Retried Events, Deliveries Per Endpoint */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-[#eef0f5]">
                Most Unreliable Endpoints
              </div>
              {!data || data.unreliable_endpoints.length === 0 ? (
                <div className="p-6 text-xs text-[#646b7d]">
                  No failing endpoints in this period.
                </div>
              ) : (
                <div className="divide-y divide-[#181b23] text-xs">
                  {data.unreliable_endpoints.map((ep) => (
                    <div
                      key={ep.endpoint_id}
                      className="px-4 py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[#e8eaef] font-medium truncate">{ep.name}</div>
                        <div className="font-mono text-[11px] text-[#646b7d]">
                          {ep.failed}/{ep.total} failed
                        </div>
                      </div>
                      <span className="font-mono text-rose-400 tabular-nums">
                        {formatPercent(ep.failure_rate)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-[#eef0f5]">
                Most Frequently Retried Events
              </div>
              {!data || data.most_retried_events.length === 0 ? (
                <div className="p-6 text-xs text-[#646b7d]">
                  No multi-attempt retried events in this period.
                </div>
              ) : (
                <div className="divide-y divide-[#181b23] text-xs">
                  {data.most_retried_events.map((ev) => (
                    <div
                      key={ev.event_id}
                      className="px-4 py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[#e8eaef] truncate">{ev.event_type}</div>
                        <div className="font-mono text-[11px] text-[#646b7d]">
                          {truncateId(ev.event_id)}
                        </div>
                      </div>
                      <span className="font-mono text-amber-300 tabular-nums whitespace-nowrap">
                        {ev.total_attempts} attempts
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-[#eef0f5]">
                Total Deliveries per Endpoint
              </div>
              {!data || data.deliveries_per_endpoint.length === 0 ? (
                <div className="p-6 text-xs text-[#646b7d]">
                  No deliveries dispatched in this period.
                </div>
              ) : (
                <div className="divide-y divide-[#181b23] text-xs">
                  {data.deliveries_per_endpoint.map((ep) => (
                    <div
                      key={ep.endpoint_id}
                      className="px-4 py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="text-[#e8eaef] truncate">{ep.name}</div>
                      <div className="font-mono tabular-nums whitespace-nowrap">
                        <span className="text-emerald-400">{ep.succeeded}</span>
                        <span className="text-[#525866]"> / </span>
                        <span className="text-[#c8cddc]">{ep.total}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
