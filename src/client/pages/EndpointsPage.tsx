import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Send,
  KeyRound,
  Trash2,
  Edit3,
  Power,
  Eye,
  Copy,
  Check,
  Radio,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type {
  DeliveryDetail,
  DeliveryRecord,
  EndpointRecord,
} from '../../shared/types';
import {
  formatDuration,
  formatPercent,
  formatRelativeTime,
  formatTimestamp,
  truncateId,
} from '../utils/format';
import { DeliveryStatusText, EnabledStateText, HttpStatusText } from '../components/StatusText';
import { Modal } from '../components/Modal';
import { JsonViewer } from '../components/JsonViewer';

interface EndpointsPageProps {
  selectedEndpointId: string | null;
  onSelectEndpoint: (id: string | null) => void;
  onInspectDelivery: (deliveryId: string) => void;
  searchQuery?: string;
}

export function EndpointsPage({
  selectedEndpointId,
  onSelectEndpoint,
  onInspectDelivery,
  searchQuery = '',
}: EndpointsPageProps) {
  const [endpoints, setEndpoints] = useState<EndpointRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receiverUrl, setReceiverUrl] = useState<string>('http://127.0.0.1:3000/api/receiver/ingest');

  // Endpoint Detail View
  const [detailEndpoint, setDetailEndpoint] = useState<EndpointRecord | null>(null);
  const [detailDeliveries, setDetailDeliveries] = useState<DeliveryRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create / Edit Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<EndpointRecord | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [eventsText, setEventsText] = useState('order.created, order.updated');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Secret Modal (shown after create, rotate, or explicit reveal)
  const [secretModal, setSecretModal] = useState<{
    title: string;
    endpointName: string;
    secret: string;
    note: string;
  } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Test Webhook Result Modal
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    endpointName: string;
    delivery: DeliveryDetail | null;
  } | null>(null);

  // Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<EndpointRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadEndpoints = useCallback(async () => {
    try {
      const [res, rcvCfg] = await Promise.all([
        api.listEndpoints({ search: searchQuery || undefined, limit: 100 }),
        api.getReceiverConfig().catch(() => null),
      ]);
      setEndpoints(res.data);
      if (rcvCfg?.receiver_url) {
        setReceiverUrl(rcvCfg.receiver_url);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load endpoints');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const loadEndpointDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await api.getEndpoint(id);
      setDetailEndpoint(res.data);
      setDetailDeliveries(res.recent_deliveries);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load endpoint details');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEndpoints();
  }, [loadEndpoints]);

  useEffect(() => {
    if (selectedEndpointId) {
      void loadEndpointDetail(selectedEndpointId);
    } else {
      setDetailEndpoint(null);
      setDetailDeliveries([]);
    }
  }, [selectedEndpointId, loadEndpointDetail]);

  const openCreateModal = () => {
    setEditingEndpoint(null);
    setName('');
    setUrl('');
    setDescription('');
    setEventsText('order.created, payment.succeeded');
    setEnabled(true);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (ep: EndpointRecord) => {
    setEditingEndpoint(ep);
    setName(ep.name);
    setUrl(ep.url);
    setDescription(ep.description || '');
    setEventsText(ep.subscribed_events.join(', '));
    setEnabled(ep.enabled);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSaveEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsedEvents = eventsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (parsedEvents.length === 0) {
      setFormError('Enter at least one event type (e.g. order.created or *).');
      return;
    }

    setSaving(true);
    try {
      if (editingEndpoint) {
        await api.updateEndpoint(editingEndpoint.id, {
          name,
          url,
          description,
          subscribed_events: parsedEvents,
          enabled,
        });
        setFormOpen(false);
        await loadEndpoints();
        if (selectedEndpointId === editingEndpoint.id) {
          await loadEndpointDetail(editingEndpoint.id);
        }
      } else {
        const created = await api.createEndpoint({
          name,
          url,
          description,
          subscribed_events: parsedEvents,
          enabled,
        });
        setFormOpen(false);
        await loadEndpoints();
        setSecretModal({
          title: 'Endpoint Signing Secret Created',
          endpointName: created.name,
          secret: created.signing_secret,
          note: 'Save this signing secret in your receiving service to verify X-HookRelay-Signature headers. It is never included in standard API responses.',
        });
      }
    } catch (err) {
      setFormError(err instanceof ClientApiError ? err.message : 'Failed to save endpoint');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (ep: EndpointRecord) => {
    try {
      await api.updateEndpoint(ep.id, { enabled: !ep.enabled });
      await loadEndpoints();
      if (selectedEndpointId === ep.id) {
        await loadEndpointDetail(ep.id);
      }
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to update endpoint status');
    }
  };

  const handleRotateSecret = async (ep: EndpointRecord) => {
    try {
      const rotated = await api.rotateEndpointSecret(ep.id);
      await loadEndpoints();
      if (selectedEndpointId === ep.id) {
        await loadEndpointDetail(ep.id);
      }
      setSecretModal({
        title: 'Signing Secret Rotated',
        endpointName: rotated.name,
        secret: rotated.signing_secret,
        note: 'All subsequent deliveries to this endpoint will be signed with this new secret.',
      });
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to rotate secret');
    }
  };

  const handleRevealSecret = async (ep: EndpointRecord) => {
    try {
      const res = await api.revealEndpointSecret(ep.id);
      setSecretModal({
        title: 'Endpoint Signing Secret',
        endpointName: ep.name,
        secret: res.signing_secret,
        note: 'Treat this secret as confidential. Rotate immediately if exposed.',
      });
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to reveal secret');
    }
  };

  const handleSendTest = async (ep: EndpointRecord) => {
    setTestingId(ep.id);
    setError(null);
    try {
      const res = await api.sendTestWebhook(ep.id);
      setTestResult({
        endpointName: ep.name,
        delivery: res.delivery,
      });
      await loadEndpoints();
      if (selectedEndpointId === ep.id) {
        await loadEndpointDetail(ep.id);
      }
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to send test webhook');
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteEndpoint(deleteTarget.id);
      const removedId = deleteTarget.id;
      setDeleteTarget(null);
      if (selectedEndpointId === removedId) {
        onSelectEndpoint(null);
      }
      await loadEndpoints();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to delete endpoint');
    } finally {
      setDeleting(false);
    }
  };

  const handleCopySecret = async () => {
    if (!secretModal) return;
    try {
      await navigator.clipboard.writeText(secretModal.secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 1800);
    } catch {
      // Ignore
    }
  };

  // Detail View
  if (selectedEndpointId && detailEndpoint) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onSelectEndpoint(null)}
              className="p-1.5 text-[#8b92a5] hover:text-[#eef0f5] bg-[#13161e] border border-[#222633] rounded-md cursor-pointer"
              aria-label="Back to endpoints"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-[#eef0f5] truncate">
                  {detailEndpoint.name}
                </h1>
                <EnabledStateText enabled={detailEndpoint.enabled} />
              </div>
              <div className="font-mono text-xs text-[#8b92a5] mt-0.5 truncate">
                {detailEndpoint.url}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSendTest(detailEndpoint)}
              disabled={testingId === detailEndpoint.id}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {testingId === detailEndpoint.id ? 'Sending...' : 'Send Test Webhook'}
            </button>
            <button
              type="button"
              onClick={() => openEditModal(detailEndpoint)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#e8eaef] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md whitespace-nowrap cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => void handleToggleEnabled(detailEndpoint)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#e8eaef] bg-[#13161e] hover:bg-[#1a1e29] border border-[#222633] rounded-md whitespace-nowrap cursor-pointer"
            >
              <Power className="w-3.5 h-3.5" />
              {detailEndpoint.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              type="button"
              onClick={() => setDeleteTarget(detailEndpoint)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 bg-[#13161e] hover:bg-rose-500/10 border border-[#222633] rounded-md whitespace-nowrap cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>

        {/* Metadata & Secret Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-3">
            <div className="text-xs font-semibold text-[#c8cddc]">Endpoint Configuration</div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-[#7c8396]">Endpoint ID</dt>
                <dd className="font-mono text-[#e8eaef]">{detailEndpoint.id}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#7c8396]">Created</dt>
                <dd className="font-mono text-[#c8cddc] tabular-nums">
                  {formatTimestamp(detailEndpoint.created_at)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#7c8396]">Last Delivery</dt>
                <dd>
                  <DeliveryStatusText status={detailEndpoint.last_delivery_status} />
                </dd>
              </div>
              <div className="pt-2 border-t border-[#1d2028]">
                <dt className="text-[#7c8396] mb-1">Subscribed Events</dt>
                <dd className="font-mono text-xs text-sky-300 leading-relaxed">
                  {detailEndpoint.subscribed_events.join('  ·  ')}
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-3">
            <div className="text-xs font-semibold text-[#c8cddc]">HMAC-SHA256 Signing Secret</div>
            <p className="text-xs text-[#7c8396] leading-relaxed">
              Used to sign outbound <code className="font-mono text-[#c8cddc]">X-HookRelay-Signature</code> headers.
            </p>
            <div className="px-3 py-2 bg-[#0a0b0e] border border-[#1d2028] rounded font-mono text-xs text-[#c8cddc]">
              {detailEndpoint.secret_preview}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleRevealSecret(detailEndpoint)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#e8eaef] bg-[#161a24] hover:bg-[#1e2330] border border-[#242834] rounded-md cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                Reveal Secret
              </button>
              <button
                type="button"
                onClick={() => void handleRotateSecret(detailEndpoint)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 bg-[#161a24] hover:bg-[#1e2330] border border-[#242834] rounded-md cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Rotate Secret
              </button>
            </div>
          </div>

          <div className="bg-[#111318] border border-[#1d2028] rounded-md p-4 space-y-3">
            <div className="text-xs font-semibold text-[#c8cddc]">Delivery Performance</div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="text-[11px] text-[#7c8396]">Total Deliveries</div>
                <div className="font-mono text-lg font-semibold text-[#eef0f5] tabular-nums mt-0.5">
                  {detailEndpoint.stats?.total_deliveries ?? 0}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7c8396]">Success Rate</div>
                <div className="font-mono text-lg font-semibold text-emerald-400 tabular-nums mt-0.5">
                  {formatPercent(detailEndpoint.stats?.success_rate)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7c8396]">Failed / DLQ</div>
                <div className="font-mono text-lg font-semibold text-rose-400 tabular-nums mt-0.5">
                  {detailEndpoint.stats?.failed_deliveries ?? 0}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7c8396]">Avg Latency</div>
                <div className="font-mono text-lg font-semibold text-[#eef0f5] tabular-nums mt-0.5">
                  {formatDuration(detailEndpoint.stats?.avg_latency_ms)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Endpoint Delivery History */}
        <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[#1d2028] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#eef0f5]">Endpoint Delivery History</h2>
            <button
              type="button"
              onClick={() => void loadEndpointDetail(detailEndpoint.id)}
              className="inline-flex items-center gap-1.5 text-xs text-[#9aa1b4] hover:text-[#eef0f5] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
          {detailLoading ? (
            <div className="p-6 text-xs text-[#7c8396]">Loading delivery history...</div>
          ) : detailDeliveries.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#646b7d]">
              No deliveries have been dispatched to this endpoint yet. Use &quot;Send Test Webhook&quot;
              above to verify connectivity.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1d2028] text-[11px] font-medium text-[#7c8396]">
                    <th className="py-2.5 px-4">Delivery ID</th>
                    <th className="py-2.5 px-3">Event Type</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">HTTP</th>
                    <th className="py-2.5 px-3 text-right">Attempts</th>
                    <th className="py-2.5 px-3 text-right">Latency</th>
                    <th className="py-2.5 px-4 text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181b23] text-xs">
                  {detailDeliveries.map((del) => (
                    <tr
                      key={del.id}
                      onClick={() => onInspectDelivery(del.id)}
                      className="hover:bg-[#151822] transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4 font-mono text-sky-300">{truncateId(del.id)}</td>
                      <td className="py-2.5 px-3 font-mono text-[#e8eaef]">{del.event_type}</td>
                      <td className="py-2.5 px-3">
                        <DeliveryStatusText status={del.status} />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <HttpStatusText status={del.last_http_status} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#9aa1b4]">
                        {del.attempt_count}/{del.max_attempts}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#9aa1b4]">
                        {formatDuration(del.last_latency_ms)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#7c8396]">
                        {formatRelativeTime(del.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modals rendered below in shared block */}
        {renderModals()}
      </div>
    );
  }

  function renderModals() {
    return (
      <>
        <Modal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          title={editingEndpoint ? 'Edit Webhook Endpoint' : 'Register Webhook Endpoint'}
          description="Destination URLs are validated on the server against SSRF and private network ranges."
        >
          <form onSubmit={handleSaveEndpoint} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                Endpoint Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Orders Fulfillment Service"
                className="w-full px-3 py-2 text-xs bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] placeholder-[#525866] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[#c8cddc]">Destination URL</label>
                <button
                  type="button"
                  onClick={() => {
                    setUrl(receiverUrl);
                    if (!name) setName('Local HookRelay Receiver');
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  <Radio className="w-3 h-3" />
                  Use Local Test Receiver URL
                </button>
              </div>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.yourdomain.com/webhooks/hookrelay"
                className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] placeholder-[#525866] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                Subscribed Event Types (comma-separated, supports <code className="font-mono">order.*</code> or <code className="font-mono">*</code>)
              </label>
              <input
                type="text"
                required
                value={eventsText}
                onChange={(e) => setEventsText(e.target.value)}
                placeholder="order.created, payment.succeeded, invoice.*"
                className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] placeholder-[#525866] focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Primary production billing consumer"
                className="w-full px-3 py-2 text-xs bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] placeholder-[#525866] focus:outline-none focus:border-sky-500"
              />
            </div>

            <label className="flex items-center gap-2.5 text-xs text-[#c8cddc] cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-[#2c3140] bg-[#0a0b0e] text-sky-400 focus:ring-sky-500"
              />
              Enable endpoint immediately to receive matching events
            </label>

            {formError && (
              <div className="px-3 py-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-3.5 py-2 text-xs font-medium text-[#9aa1b4] hover:text-[#eef0f5] bg-[#161a24] rounded-md cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md cursor-pointer"
              >
                {saving ? 'Saving...' : editingEndpoint ? 'Save Changes' : 'Create Endpoint'}
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          open={Boolean(secretModal)}
          onClose={() => {
            setSecretModal(null);
            setCopiedSecret(false);
          }}
          title={secretModal?.title || 'Signing Secret'}
          description={secretModal?.endpointName}
        >
          {secretModal && (
            <div className="space-y-4">
              <p className="text-xs text-[#9aa1b4] leading-relaxed">{secretModal.note}</p>
              <div className="flex items-center gap-2 p-3 bg-[#0a0b0e] border border-[#242834] rounded-md">
                <code className="font-mono text-xs text-emerald-300 break-all flex-1">
                  {secretModal.secret}
                </code>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#e8eaef] bg-[#161a24] hover:bg-[#1f2433] rounded cursor-pointer shrink-0"
                >
                  {copiedSecret ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setSecretModal(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </Modal>

        <Modal
          open={Boolean(testResult)}
          onClose={() => setTestResult(null)}
          title="Test Webhook Result"
          description={testResult?.endpointName}
          maxWidthClass="max-w-2xl"
        >
          {testResult?.delivery && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-xs bg-[#0c0d11] border border-[#1d2028] rounded-md p-3">
                <div>
                  <div className="text-[#7c8396]">Delivery Status</div>
                  <div className="mt-1">
                    <DeliveryStatusText status={testResult.delivery.status} />
                  </div>
                </div>
                <div>
                  <div className="text-[#7c8396]">HTTP Status</div>
                  <div className="mt-1">
                    <HttpStatusText status={testResult.delivery.last_http_status} />
                  </div>
                </div>
                <div>
                  <div className="text-[#7c8396]">Latency</div>
                  <div className="mt-1 font-mono text-[#e8eaef] tabular-nums">
                    {formatDuration(testResult.delivery.last_latency_ms)}
                  </div>
                </div>
              </div>

              {testResult.delivery.last_error && (
                <div className="px-3 py-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md font-mono">
                  {testResult.delivery.last_error}
                </div>
              )}

              {testResult.delivery.attempts[0] && (
                <JsonViewer
                  title="Response Body"
                  value={testResult.delivery.attempts[0].response_body}
                  maxHeightClass="max-h-56"
                />
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = testResult.delivery!.id;
                    setTestResult(null);
                    onInspectDelivery(id);
                  }}
                  className="px-3.5 py-2 text-xs font-medium text-sky-300 bg-[#161a24] hover:bg-[#1e2330] border border-[#242834] rounded-md cursor-pointer"
                >
                  Open Delivery Inspector
                </button>
                <button
                  type="button"
                  onClick={() => setTestResult(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </Modal>

        <Modal
          open={Boolean(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          title="Delete Webhook Endpoint"
          description="This permanently removes the endpoint and its associated delivery history."
        >
          {deleteTarget && (
            <div className="space-y-4">
              <p className="text-xs text-[#c8cddc]">
                Are you sure you want to delete{' '}
                <strong className="text-[#eef0f5]">{deleteTarget.name}</strong> (
                <code className="font-mono text-[#9aa1b4]">{deleteTarget.url}</code>)?
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="px-3.5 py-2 text-xs font-medium text-[#9aa1b4] bg-[#161a24] rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-md cursor-pointer"
                >
                  {deleting ? 'Deleting...' : 'Delete Endpoint'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">Endpoints</h1>
          <p className="text-xs text-[#8b92a5] mt-1">
            Register destination URLs, configure event subscriptions, rotate HMAC secrets, and send
            live test webhooks.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md transition-colors whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Endpoint
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
          {error}
        </div>
      )}

      <div className="bg-[#111318] border border-[#1d2028] rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-xs text-[#7c8396]">Loading registered endpoints...</div>
        ) : endpoints.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="text-sm font-medium text-[#e8eaef]">No endpoints registered</div>
            <p className="text-xs text-[#7c8396] max-w-md mx-auto">
              Add your first webhook destination URL and subscribe it to event types such as{' '}
              <code className="font-mono text-[#c8cddc]">order.created</code> or{' '}
              <code className="font-mono text-[#c8cddc]">*</code>.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Register Endpoint
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#1d2028] text-[11px] font-medium text-[#7c8396]">
                  <th className="py-3 px-4">Name & URL</th>
                  <th className="py-3 px-3">Subscribed Events</th>
                  <th className="py-3 px-3">State</th>
                  <th className="py-3 px-3">Last Delivery</th>
                  <th className="py-3 px-3 text-right">Success Rate</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181b23] text-xs">
                {endpoints.map((ep) => (
                  <tr
                    key={ep.id}
                    className="hover:bg-[#151822] transition-colors"
                  >
                    <td
                      onClick={() => onSelectEndpoint(ep.id)}
                      className="py-3 px-4 cursor-pointer"
                    >
                      <div className="font-medium text-[#eef0f5] hover:text-sky-300">
                        {ep.name}
                      </div>
                      <div className="font-mono text-[11px] text-[#7c8396] truncate max-w-[280px] mt-0.5">
                        {ep.url}
                      </div>
                    </td>
                    <td
                      onClick={() => onSelectEndpoint(ep.id)}
                      className="py-3 px-3 font-mono text-[11px] text-[#c8cddc] max-w-[220px] truncate cursor-pointer"
                    >
                      {ep.subscribed_events.join(' · ')}
                    </td>
                    <td className="py-3 px-3">
                      <EnabledStateText enabled={ep.enabled} />
                    </td>
                    <td className="py-3 px-3">
                      <DeliveryStatusText status={ep.last_delivery_status} />
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#c8cddc]">
                      {formatPercent(ep.stats?.success_rate)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleSendTest(ep)}
                          disabled={testingId === ep.id}
                          title="Send Test Webhook"
                          className="px-2 py-1 text-[11px] font-medium text-sky-300 hover:bg-[#1b202e] border border-[#242834] rounded cursor-pointer whitespace-nowrap"
                        >
                          {testingId === ep.id ? 'Sending...' : 'Test'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleEnabled(ep)}
                          title={ep.enabled ? 'Disable endpoint' : 'Enable endpoint'}
                          className="p-1.5 text-[#8b92a5] hover:text-[#eef0f5] hover:bg-[#1b202e] rounded cursor-pointer"
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(ep)}
                          title="Edit endpoint"
                          className="p-1.5 text-[#8b92a5] hover:text-[#eef0f5] hover:bg-[#1b202e] rounded cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(ep)}
                          title="Delete endpoint"
                          className="p-1.5 text-[#8b92a5] hover:text-rose-400 hover:bg-[#1b202e] rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {renderModals()}
    </div>
  );
}
