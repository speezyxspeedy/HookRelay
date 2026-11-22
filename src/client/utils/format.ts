export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatIsoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 5) return diffSec >= 0 ? 'just now' : 'in <5s';
  if (abs < 60) return diffSec >= 0 ? `${abs}s ago` : `in ${abs}s`;
  const min = Math.floor(abs / 60);
  if (min < 60) return diffSec >= 0 ? `${min}m ago` : `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return diffSec >= 0 ? `${hr}h ago` : `in ${hr}h`;
  const days = Math.floor(hr / 24);
  return diffSec >= 0 ? `${days}d ago` : `in ${days}d`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatPercent(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return `${val.toFixed(1)}%`;
}

export function truncateId(id: string, len = 14): string {
  if (!id || id.length <= len) return id;
  return `${id.slice(0, len)}…`;
}
