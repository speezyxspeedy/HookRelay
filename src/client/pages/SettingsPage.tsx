import React, { useCallback, useEffect, useState } from 'react';
import { Save, Shield } from 'lucide-react';
import { api, ClientApiError } from '../services/api';
import type { RetrySettings } from '../../shared/types';

interface SettingsPageProps {
  onSettingsUpdated: (settings: RetrySettings) => void;
}

export function SettingsPage({ onSettingsUpdated }: SettingsPageProps) {
  const [form, setForm] = useState<RetrySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getSettings();
      setForm(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const updated = await api.updateSettings(form);
      setForm(updated);
      onSettingsUpdated(updated);
      setSavedNotice('Settings saved persistently to SQLite.');
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return <div className="p-8 text-xs text-[#7c8396]">Loading platform settings...</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[#eef0f5]">Settings</h1>
        <p className="text-xs text-[#8b92a5] mt-1">
          Configure retry backoff limits, HTTP timeouts, SSRF protections, and workspace metadata.
          All values persist in SQLite.
        </p>
      </div>

      {savedNotice && (
        <div className="px-4 py-3 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md">
          {savedNotice}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Workspace */}
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-5 space-y-4">
          <h2 className="text-sm font-semibold text-[#eef0f5]">Workspace</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                Workspace Name
              </label>
              <input
                type="text"
                required
                value={form.workspace_name}
                onChange={(e) => setForm({ ...form, workspace_name: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                Environment Label
              </label>
              <input
                type="text"
                required
                value={form.environment_label}
                onChange={(e) => setForm({ ...form, environment_label: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        {/* Retry Engine */}
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[#eef0f5]">Retry Engine Policy</h2>
            <p className="text-xs text-[#7c8396] mt-0.5">
              Exponential backoff: <code className="font-mono">min(initialDelay * 2^(attempt - 1), maxDelay)</code>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                Maximum Delivery Attempts
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={form.max_attempts}
                onChange={(e) => setForm({ ...form, max_attempts: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                HTTP Request Timeout (ms)
              </label>
              <input
                type="number"
                min={500}
                max={60000}
                step={500}
                value={form.request_timeout_ms}
                onChange={(e) => setForm({ ...form, request_timeout_ms: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                Initial Retry Delay (ms)
              </label>
              <input
                type="number"
                min={200}
                max={300000}
                step={500}
                value={form.initial_delay_ms}
                onChange={(e) => setForm({ ...form, initial_delay_ms: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
                Maximum Retry Delay (ms)
              </label>
              <input
                type="number"
                min={1000}
                max={3600000}
                step={1000}
                value={form.max_delay_ms}
                onChange={(e) => setForm({ ...form, max_delay_ms: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5]"
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-[#1d2028]">
            <label className="flex items-center gap-2.5 text-xs text-[#c8cddc] cursor-pointer">
              <input
                type="checkbox"
                checked={form.retry_on_408}
                onChange={(e) => setForm({ ...form, retry_on_408: e.target.checked })}
                className="rounded border-[#2c3140] bg-[#0a0b0e] text-sky-400"
              />
              Retry HTTP 408 (Request Timeout) responses
            </label>
            <label className="flex items-center gap-2.5 text-xs text-[#c8cddc] cursor-pointer">
              <input
                type="checkbox"
                checked={form.retry_on_429}
                onChange={(e) => setForm({ ...form, retry_on_429: e.target.checked })}
                className="rounded border-[#2c3140] bg-[#0a0b0e] text-sky-400"
              />
              Retry HTTP 429 (Too Many Requests) responses and honor Retry-After headers
            </label>
          </div>
        </div>

        {/* Security */}
        <div className="bg-[#111318] border border-[#1d2028] rounded-md p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-[#eef0f5]">
              Security & Outbound Network Policy
            </h2>
          </div>

          <div className="max-w-xs">
            <label className="block text-xs font-medium text-[#c8cddc] mb-1.5">
              Signature Verification Tolerance (seconds)
            </label>
            <input
              type="number"
              min={30}
              max={3600}
              value={form.signature_tolerance_seconds}
              onChange={(e) =>
                setForm({ ...form, signature_tolerance_seconds: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5]"
            />
          </div>

          <label className="flex items-start gap-2.5 text-xs text-[#c8cddc] cursor-pointer">
            <input
              type="checkbox"
              checked={form.allow_localhost_webhooks}
              onChange={(e) =>
                setForm({ ...form, allow_localhost_webhooks: e.target.checked })
              }
              className="mt-0.5 rounded border-[#2c3140] bg-[#0a0b0e] text-sky-400"
            />
            <span>
              Allow webhook delivery to <code className="font-mono">localhost</code> /{' '}
              <code className="font-mono">127.0.0.1</code> (Development testing mode only; private
              LAN and cloud metadata IPs like <code className="font-mono">169.254.169.254</code>{' '}
              remain strictly blocked).
            </span>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
