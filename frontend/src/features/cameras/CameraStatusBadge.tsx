import { CheckCircle2, AlertTriangle, RefreshCw, CircleOff, XCircle, PauseCircle } from 'lucide-react';
import clsx from 'clsx';
import type { CameraStatus } from '@/types';

export const STATUS_META: Record<CameraStatus, { label: string; icon: typeof CheckCircle2; tone: string; dot: string }> = {
  ONLINE: { label: 'Online', icon: CheckCircle2, tone: 'text-status-online', dot: 'bg-status-online' },
  DEGRADED: { label: 'Degraded', icon: AlertTriangle, tone: 'text-status-degraded', dot: 'bg-status-degraded' },
  RECONNECTING: { label: 'Reconnecting', icon: RefreshCw, tone: 'text-status-reconnecting', dot: 'bg-status-reconnecting' },
  OFFLINE: { label: 'Offline', icon: CircleOff, tone: 'text-status-offline', dot: 'bg-status-offline' },
  MISCONFIGURED: { label: 'Misconfigured', icon: XCircle, tone: 'text-status-misconfigured', dot: 'bg-status-misconfigured' },
  DISABLED: { label: 'Disabled', icon: PauseCircle, tone: 'text-status-disabled', dot: 'bg-status-disabled' },
};

interface Props {
  status: CameraStatus;
  variant?: 'dot' | 'chip' | 'icon-label';
  className?: string;
}

export function CameraStatusBadge({ status, variant = 'chip', className }: Props): React.JSX.Element {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  if (variant === 'dot') {
    return (
      <span
        className={clsx('inline-block h-2 w-2 rounded-full', meta.dot, status === 'RECONNECTING' && 'animate-pulse', className)}
        role="img"
        aria-label={meta.label}
        title={meta.label}
      />
    );
  }

  if (variant === 'icon-label') {
    return (
      <span className={clsx('inline-flex items-center gap-1', meta.tone, className)}>
        <Icon className={clsx('h-3.5 w-3.5', status === 'RECONNECTING' && 'animate-spin')} aria-hidden="true" />
        <span className="text-xs">{meta.label}</span>
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border border-current/25 bg-current/10 px-1.5 py-0.5 text-[10px] font-medium',
        meta.tone,
        className,
      )}
    >
      <Icon className={clsx('h-3 w-3', status === 'RECONNECTING' && 'animate-spin')} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
