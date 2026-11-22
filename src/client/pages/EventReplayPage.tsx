import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, RefreshCw } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { DeliveryRecord, EndpointRecord, EventRecord } from '../../shared/types';
import { formatRelativeTime, formatTimestamp, truncateId } from '../utils/format';
import { DeliveryStatusText, EnabledStateText, HttpStatusText } from '../components/StatusText';
import { JsonViewer } from '../components/JsonViewer';
import { Modal } from '../components/Modal';

interface EventReplayPageProps {
  initialEventId?: string | null;
  onInspectDelivery: (deliveryId: string) => void;
}

export function EventReplayPage({
  initialEventId,
  onInspectDelivery,
}: EventReplayPageProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(initialEventId || '');
  const [eventDetail, setEventDetail] = useState<EventRecord | null>(null);
  const [eventDeliveries, setEventDeliveries] = useState<DeliveryRecord[]>([]);
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    try {
      const [evRes, epRes] = await Promise.all([
        api.listEvents({ limit: 50 }),
        api.listEndpoints({ limit: 100 }),
      ]);
      setEvents(evRes.data);
      setEndpoints(epRes.data);
      if (!selectedEventId && evRes.data.length > 0) {
        setSelectedEventId(initialEventId || evRes.data[0].id);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load events and endpoints');
    } finally {
      setLoading(false);
    }
  }, [initialEventId, selectedEventId]);

  const loadEventDetail = useCallback(async (id: string) => {
    if (!id) {
      setEventDetail(null);
      setEventDeliveries([]);
      return;
    }
    try {
      const res = await api.getEvent(id);
      setEventDetail(res.data);
      setEventDeliveries(res.deliveries);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load event detail');
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (initialEventId) {
      setSelectedEventId(initialEventId);
    }
  }, [initialEventId]);

  useEffect(() => {
    if (selectedEventId) {
      void loadEventDetail(selectedEventId);
    }
  }, [selectedEventId, loadEventDetail]);

  const toggleEndpoint = (id: string) => {
    setSelectedEndpointIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfirmReplay = async () => {
    if (!selectedEventId || selectedEndpointIds.length === 0) return;
    setReplaying(true);
    setError(null);
    try {
      const res = await api.replayEvent(selectedEventId, selectedEndpointIds);
      setConfirmOpen(false);
      setNotice(
        `Replayed event ${res.event_id} to ${res.replayed_delivery_ids.length} endpoint(s). Original deliveries remain untouched.`
      );
      setTimeout(() => void loadEventDetail(selectedEventId), 600);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to replay event');
    } finally {
      setReplaying(false);
    }
  };

  const originalDeliveries = eventDeliveries.filter((d) => !d.is_replay);
  const replayedDeliveries = eventDeliveries.filter((d) => d.is_replay);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">Event Replay</h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Select a historical event, inspect its immutable payload, and replay it to one or more
            endpoints with separate execution tracking.
          </p>
        </div>
        {selectedEventId && (
          <button
            type="button"
            onClick={() => void loadEventDetail(selectedEventId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#c8cddc] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Status
          </button>
        )}
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

      {loading ? (
        <div className="p-8 text-xs text-[#7c8396]">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-10 text-center text-xs text-[#646b7d]">
          No events exist in the database yet. Dispatch an event first to test event replay.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Step 1: Select Event */}
          <div className="lg:col-span-4 bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden self-start">
            <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-[#eef0f5]">
              1. Select Event ({events.length})
            </div>
            <div className="divide-y divide-[#181b23] max-h-[540px] overflow-y-auto">
              {events.map((ev) => {
                const active = ev.id === selectedEventId;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => {
                      setSelectedEventId(ev.id);
                      setSelectedEndpointIds([]);
                    }}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      active ? 'bg-[#181d29]' : 'hover:bg-[#141720]'
                    }`}
                  >
                    <div className="font-mono text-xs font-medium text-[#eef0f5]">{ev.type}</div>
                    <div className="font-mono text-[11px] text-[#646b7d] mt-0.5 flex items-center justify-between">
                      <span>{truncateId(ev.id)}</span>
                      <span>{formatRelativeTime(ev.created_at)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2 & 3: Payload + Eligible Endpoints + Deliveries */}
          <div className="lg:col-span-8 space-y-4">
            {eventDetail && (
              <>
                <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-sm font-semibold text-[#eef0f5]">
                        {eventDetail.type}
                      </div>
                      <div className="font-mono text-[11px] text-[#7c8396] mt-0.5">
                        {eventDetail.id} · Recorded {formatTimestamp(eventDetail.created_at)}
                      </div>
                    </div>
                  </div>
                  <JsonViewer
                    title="Original Immutable Payload"
                    value={eventDetail.raw_payload}
                    maxHeightClass="max-h-60"
                  />
                </div>

                {/* Select Target Endpoints */}
                <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-xs font-semibold text-[#eef0f5]">
                        2. Select Target Endpoints
                      </h2>
                      <p className="text-[11px] text-[#7c8396] mt-0.5">
                        Choose one or more registered endpoints to receive a fresh signed copy of
                        this event.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={selectedEndpointIds.length === 0}
                      onClick={() => setConfirmOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 disabled:opacity-40 rounded-md cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Replay to {selectedEndpointIds.length || ''} Endpoint
                      {selectedEndpointIds.length === 1 ? '' : 's'}
                    </button>
                  </div>

                  {endpoints.length === 0 ? (
                    <div className="text-xs text-[#646b7d] py-2">
                      No endpoints registered yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#181b23] border border-[#1d2028] rounded-md">
                      {endpoints.map((ep) => {
                        const checked = selectedEndpointIds.includes(ep.id);
                        return (
                          <label
                            key={ep.id}
                            className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[#151822] cursor-pointer text-xs"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleEndpoint(ep.id)}
                                className="rounded border-[#2c3140] bg-[#0a0b0e] text-sky-400"
                              />
                              <div className="min-w-0">
                                <div className="font-medium text-[#e8eaef] truncate">{ep.name}</div>
                                <div className="font-mono text-[11px] text-[#646b7d] truncate">
                                  {ep.url}
                                </div>
                              </div>
                            </div>
                            <EnabledStateText enabled={ep.enabled} />
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Original vs Replayed Deliveries */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-[#eef0f5]">
                      Original Deliveries ({originalDeliveries.length})
                    </div>
                    {originalDeliveries.length === 0 ? (
                      <div className="p-4 text-xs text-[#646b7d]">
                        No original deliveries recorded.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#181b23]">
                        {originalDeliveries.map((del) => (
                          <div
                            key={del.id}
                            onClick={() => onInspectDelivery(del.id)}
                            className="px-4 py-2.5 hover:bg-[#151822] cursor-pointer flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="text-[#e8eaef] truncate">{del.endpoint_name}</div>
                              <div className="font-mono text-[11px] text-[#646b7d]">
                                {truncateId(del.id)} · {formatRelativeTime(del.created_at)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <HttpStatusText status={del.last_http_status} />
                              <DeliveryStatusText status={del.status} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#1d2028] text-xs font-semibold text-sky-300">
                      Replayed Deliveries ({replayedDeliveries.length})
                    </div>
                    {replayedDeliveries.length === 0 ? (
                      <div className="p-4 text-xs text-[#646b7d]">
                        No replays executed for this event yet.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#181b23]">
                        {replayedDeliveries.map((del) => (
                          <div
                            key={del.id}
                            onClick={() => onInspectDelivery(del.id)}
                            className="px-4 py-2.5 hover:bg-[#151822] cursor-pointer flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="text-[#e8eaef] truncate">{del.endpoint_name}</div>
                              <div className="font-mono text-[11px] text-[#646b7d]">
                                {truncateId(del.id)} · {formatRelativeTime(del.created_at)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <HttpStatusText status={del.last_http_status} />
                              <DeliveryStatusText status={del.status} />
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
        </div>
      )}

      {/* Confirmation Modal */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm Event Replay"
        description="This will send real signed HTTP POST requests to the selected endpoints."
      >
        <div className="space-y-4 text-xs text-[#c8cddc]">
          <p>
            Replay event{' '}
            <code className="font-mono text-sky-300">{eventDetail?.type}</code> (
            <code className="font-mono text-[#9aa1b4]">{selectedEventId}</code>) to{' '}
            <strong className="text-[#eef0f5]">{selectedEndpointIds.length}</strong> selected
            endpoint(s)?
          </p>
          <p className="text-[#8b92a5]">
            New delivery records marked as replays will be created with fresh HMAC timestamps and
            delivery IDs. Original delivery records and attempt history will not be modified.
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-[#9aa1b4] bg-[#161a24] rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={replaying}
              onClick={() => void handleConfirmReplay()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {replaying ? 'Replaying...' : 'Confirm & Replay'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
