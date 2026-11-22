import {
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
  AlertOctagon,
  Loader2,
  PauseCircle,
} from 'lucide-react';
import type { DeliveryStatus, AttemptOutcome } from '../../shared/types';

export function DeliveryStatusText({ status }: { status: DeliveryStatus | null | undefined }) {
  if (!status) {
    return <span className="text-xs text-[#646b7d]">No deliveries</span>;
  }

  switch (status) {
    case 'succeeded':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Succeeded
        </span>
      );
    case 'retrying':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          Retrying
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Pending
        </span>
      );
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 whitespace-nowrap">
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          Processing
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          Failed
        </span>
      );
    case 'dead_letter':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap">
          <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
          Dead Letter
        </span>
      );
  }
}

export function HttpStatusText({ status }: { status: number | null | undefined }) {
  if (status === null || status === undefined) {
    return <span className="font-mono text-xs text-[#646b7d] tabular-nums">—</span>;
  }
  const color =
    status >= 200 && status < 300
      ? 'text-emerald-400'
      : status >= 400 && status < 500
        ? 'text-amber-400'
        : 'text-rose-400';

  return <span className={`font-mono text-xs font-medium tabular-nums ${color}`}>{status}</span>;
}

export function AttemptOutcomeText({ outcome }: { outcome: AttemptOutcome }) {
  if (outcome === 'succeeded') {
    return <span className="text-xs font-medium text-emerald-400">Succeeded</span>;
  }
  if (outcome === 'retryable_failure') {
    return <span className="text-xs font-medium text-amber-400">Retryable Failure</span>;
  }
  return <span className="text-xs font-medium text-rose-400">Permanent Failure</span>;
}

export function EnabledStateText({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7c8396] whitespace-nowrap">
      <PauseCircle className="w-3.5 h-3.5 shrink-0" />
      Disabled
    </span>
  );
}
