import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Copy, Check, RefreshCw, Webhook } from 'lucide-react';
import { api, ClientApiError, setAuthToken } from '../services/api';
import type { AuthStatus } from '../../shared/types';

interface AuthGateProps {
  authStatus: AuthStatus;
  onAuthenticated: () => void;
}

function generateSuggestedKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `hr_live_${hex}`;
}

export function AuthGate({ authStatus, onAuthenticated }: AuthGateProps) {
  const isSetup = authStatus.setup_required;
  const [apiKey, setApiKey] = useState(() => (isSetup ? generateSuggestedKey() : ''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = apiKey.trim();
    if (trimmed.length < 8) {
      setError('Admin API key must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = isSetup
        ? await api.setupAdminKey(trimmed)
        : await api.loginAdminKey(trimmed);
      setAuthToken(res.token);
      onAuthenticated();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(err.message);
      } else {
        setError('Unable to authenticate with HookRelay server.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-[#e8eaef] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-[#111318] border border-[#1d2028] rounded-lg p-7">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-md bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Webhook className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#eef0f5]">HookRelay</h1>
            <p className="text-xs text-[#8b92a5]">Webhook Delivery & Reliability Platform</p>
          </div>
        </div>

        {isSetup ? (
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-[#eef0f5]">Initialize Workspace Admin Key</h2>
            <p className="text-xs text-[#8b92a5] mt-1.5 leading-relaxed">
              No <code className="font-mono text-[#c8cddc]">HOOKRELAY_API_KEY</code> environment
              variable is configured yet. Claim your initial admin API key below. It is hashed with{' '}
              <code className="font-mono text-[#c8cddc]">scrypt</code> on the server and used to
              authenticate both this dashboard and REST API calls via{' '}
              <code className="font-mono text-[#c8cddc]">X-API-Key</code>.
            </p>
          </div>
        ) : (
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-[#eef0f5]">Sign In to HookRelay</h2>
            <p className="text-xs text-[#8b92a5] mt-1.5 leading-relaxed">
              {authStatus.env_key_configured
                ? 'Enter the HOOKRELAY_API_KEY configured in your server environment to open a session.'
                : 'Enter your claimed workspace admin API key to open an authenticated session.'}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="admin-api-key" className="text-xs font-medium text-[#c8cddc]">
                {isSetup ? 'Admin API Key (copy & save securely)' : 'Admin API Key'}
              </label>
              {isSetup && (
                <button
                  type="button"
                  onClick={() => setApiKey(generateSuggestedKey())}
                  className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Regenerate
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <KeyRound className="w-4 h-4 text-[#646b7d] absolute left-3 pointer-events-none" />
              <input
                id="admin-api-key"
                type={isSetup ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="hr_live_..."
                autoComplete="off"
                className="w-full pl-9 pr-10 py-2.5 text-xs font-mono bg-[#0a0b0e] border border-[#242834] rounded-md text-[#eef0f5] placeholder-[#525866] focus:outline-none focus:border-sky-500"
              />
              {isSetup && (
                <button
                  type="button"
                  onClick={handleCopy}
                  title="Copy API key"
                  className="absolute right-2.5 p-1 text-[#8b92a5] hover:text-[#eef0f5] cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-md">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 text-xs font-semibold text-[#061018] bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            {submitting
              ? 'Verifying...'
              : isSetup
                ? 'Claim Key & Launch Console'
                : 'Authenticate Session'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-[#1d2028] text-[11px] text-[#7c8396] space-y-1">
          <p>
            Session tokens are kept strictly in memory and never persisted to browser storage.
          </p>
          <p>
            Production deployments should set{' '}
            <code className="font-mono text-[#9aa1b4]">HOOKRELAY_API_KEY</code> in server
            environment variables.
          </p>
        </div>
      </div>
    </div>
  );
}
