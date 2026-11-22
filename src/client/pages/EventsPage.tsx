import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { DeliveryRecord, EventRecord } from '../../shared/types';
import { formatRelativeTime, formatTimestamp, truncateId } from '../utils/format';
import { DeliveryStatusText, HttpStatusText } from '../components/StatusText';
import { Modal } from '../components/Modal';
import { JsonViewer } from '../components/JsonViewer';

interface EventsPageProps {
  onInspectDelivery: (deliveryId: string) => void;
  onJumpToReplay: (eventId: string) => void;
  searchQuery?: string;
}

const SAMPLE_TEMPLATES: Record<string, { type: string; data: Record<string, unknown> }> = {
  'order.created': {
    type: 'order.created',
    data: {
      orderId: 'ORD-1001',
      amount: 1499,
      currency: 'INR',
      customerEmail: 'dev@example.com',
    },
  },
  'payment.succeeded': {
    type: 'payment.succeeded',
    data: {
      paymentId: 'PAY-8821',
      orderId: 'ORD-1001',
      amount: 1499,
      method: 'card',
    },
  },
  'invoice.payment_failed': {
    type: 'invoice.payment_failed',
    data: {
      invoiceId: 'INV-4490',
      subscriptionId: 'SUB-102',
      attempt: 1,
      reason: 'insufficient_funds',
    },
  },
};

export function EventsPage({
  onInspectDelivery,
  onJumpToReplay,
  searchQuery = '',
}: EventsPageProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected Event Inspector
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null);
  const [selectedDeliveries, setSelectedDeliveries] = useState<DeliveryRecord[]>([]);

  // Dispatch Event Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [eventType, setEventType] = useState('order.created');
  const [payloadText, setPayloadText] = useState(
    JSON.stringify(SAMPLE_TEMPLATES['order.created'].data, null, 2)
  );
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listEvents({
        page,
        limit: 20,
        type: typeFilter || undefined,
        search: searchQuery || undefined,
      });
      setEvents(res.data);
      setTotal(res.pagination.total);
      setTotalPages(res.pagination.total_pages);
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, searchQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEventDetail = async (id: string) => {
    try {
      const res = await api.getEvent(id);
      setSelectedEvent(res.data);
      setSelectedDeliveries(res.deliveries);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load event details');
    }
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(payloadText);
    } catch {
      setFormError('Payload data must be valid JSON.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createEvent({
        type: eventType.trim(),
        data: parsedData,
        idempotency_key: idempotencyKey.trim() || undefined,
        source: 'dashboard',
      });
      setCreateOpen(false);
      setIdempotencyKey('');
      setNotice(
        res.idempotent_replay
          ? `Idempotency key matched existing event ${res.data.id} — no duplicate deliveries generated.`
          : `Event ${res.data.id} stored and queued for ${res.deliveries_created} matching endpoint(s).`
      );
      await load();
      await openEventDetail(res.data.id);
    } catch (err) {
      setFormError(err instanceof ClientApiError ? err.message : 'Failed to create event');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">Events</h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Ingest webhook events, inspect exact transmitted payloads, and track fan-out deliveries.
          </p>
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
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Dispatch Event
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-3 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md flex items-center justify-between gap-3">
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

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Filter by exact event type (e.g. order.created)"
            className="w-72 px-3 py-1.5 text-xs font-mono bg-[#111318] border border-[#222633] rounded-md text-[#e8eaef] placeholder-[#5c6375] focus:outline-none focus:border-sky-500"
          />
          {typeFilter && (
            <button
              type="button"
              onClick={() => setTypeFilter('')}
              className="text-xs text-[#8b92a5] hover:text-[#eef0f5] cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-xs text-[#7c8396] font-mono tabular-nums">
          {total} total event{total === 1 ? '' : 's'}
        </div>
      </div>

      {/* Main Split: Events Table + Detail Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div
          className={`${
            selectedEvent ? 'lg:col-span-7' : 'lg:col-span-12'
          } bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden`}
        >
          {loading ? (
            <div className="p-8 text-xs text-[#7c8396]">Loading events...</div>
          ) : events.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <div className="text-sm font-medium text-[#e8eaef]">No events recorded</div>
              <p className="text-xs text-[#7c8396] max-w-md mx-auto">
                Dispatch an event here or POST to{' '}
                <code className="font-mono text-[#c8cddc]">/api/events</code> to trigger real
                signed HTTP deliveries to subscribed endpoints.
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Dispatch First Event
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1d2028] text-[11px] font-medium text-[#7c8396]">
                      <th className="py-2.5 px-4">Event ID</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Deliveries</th>
                      <th className="py-2.5 px-3">Idempotency Key</th>
                      <th className="py-2.5 px-4 text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#181b23] text-xs">
                    {events.map((ev) => {
                      const active = selectedEvent?.id === ev.id;
                      return (
                        <tr
                          key={ev.id}
                          onClick={() => void openEventDetail(ev.id)}
                          className={`cursor-pointer transition-colors ${
                            active ? 'bg-[#171c28]' : 'hover:bg-[#151822]'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-mono text-sky-300">
                            {truncateId(ev.id)}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-medium text-[#eef0f5]">
                            {ev.type}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-[#c8cddc]">
                            <span className="text-emerald-400">
                              {ev.delivery_summary?.succeeded ?? 0}
                            </span>
                            <span className="text-[#525866]"> / </span>
                            <span>{ev.delivery_summary?.total ?? 0}</span>
                            {(ev.delivery_summary?.dead_letter ?? 0) > 0 && (
                              <span className="text-rose-400 ml-1.5">
                                ({ev.delivery_summary?.dead_letter} DLQ)
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-[#7c8396] truncate max-w-[140px]">
                            {ev.idempotency_key || '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#7c8396]">
                            {formatRelativeTime(ev.created_at)}
                          </td>
                        </tr>
                      );
                    })}
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

        {selectedEvent && (
          <div className="lg:col-span-5 bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-4 self-start">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-sm font-semibold text-[#eef0f5]">
                  {selectedEvent.type}
                </div>
                <div className="font-mono text-[11px] text-[#7c8396] mt-0.5">
                  {selectedEvent.id} · {formatTimestamp(selectedEvent.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onJumpToReplay(selectedEvent.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-sky-300 bg-[#161a24] hover:bg-[#1e2330] border border-[#242834] rounded-md cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Replay
              </button>
            </div>

            <JsonViewer title="Transmitted Event Envelope" value={selectedEvent.raw_payload} />

            <div>
              <div className="text-xs font-semibold text-[#c8cddc] mb-2">
                Associated Deliveries ({selectedDeliveries.length})
              </div>
              {selectedDeliveries.length === 0 ? (
                <div className="text-xs text-[#646b7d] py-3">
                  No enabled endpoints were subscribed to{' '}
                  <code className="font-mono">{selectedEvent.type}</code> when this event arrived.
                </div>
              ) : (
                <div className="divide-y divide-[#181b23] border border-[#1d2028] rounded-md overflow-hidden">
                  {selectedDeliveries.map((del) => (
                    <div
                      key={del.id}
                      onClick={() => onInspectDelivery(del.id)}
                      className="px-3 py-2.5 hover:bg-[#151822] cursor-pointer flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-[#e8eaef] truncate">
                          {del.endpoint_name}
                          {del.is_replay ? (
                            <span className="ml-1.5 text-[11px] text-sky-400 font-mono">
                              [Replay]
                            </span>
                          ) : null}
                        </div>
                        <div className="font-mono text-[11px] text-[#646b7d]">
                          {truncateId(del.id)} · {del.attempt_count}/{del.max_attempts} attempts
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <HttpStatusText status={del.last_http_status} />
                        <DeliveryStatusText status={del.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dispatch Event Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Dispatch Webhook Event"
        description="Persists the event to SQLite and dispatches signed HTTP POST requests to all matching enabled endpoints."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleDispatch} className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-[#7c8396] mr-1">Templates:</span>
            {Object.keys(SAMPLE_TEMPLATES).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setEventType(SAMPLE_TEMPLATES[key].type);
                  setPayloadText(JSON.stringify(SAMPLE_TEMPLATES[key].data, null, 2));
                }}
                className="px-2 py-1 font-mono text-[#c8cddc] bg-[#161a24] hover:bg-[#1f2433] border border-[#242834] rounded cursor-pointer"
              >
                {key}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">Event Type</label>
            <input
              type="text"
              required
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              placeholder="order.created"
              className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
              Event Data (JSON)
            </label>
            <textarea
              rows={8}
              required
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
              Idempotency Key (optional)
            </label>
            <input
              type="text"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              placeholder="e.g. ord-1001-created-v1"
              className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] placeholder-[#525866] focus:outline-none focus:border-sky-500"
            />
          </div>

          {formError && (
            <div className="px-3 py-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
              {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-[#9aa1b4] bg-[#161a24] rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {submitting ? 'Dispatching...' : 'Dispatch Event'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
