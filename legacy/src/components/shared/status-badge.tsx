import React from 'react';
import { InvoiceStatus, QuoteStatus } from '../../types';
import { cn } from '../../lib/utils';
import { 
  FileEdit, 
  Send, 
  MessageSquare, 
  CheckCircle2, 
  Clock, 
  CheckCheck, 
  AlertCircle, 
  XCircle,
  ArrowRightCircle
} from 'lucide-react';

export type StatusType = InvoiceStatus | QuoteStatus;

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const STATUS_CONFIG: Record<StatusType, { label: string; bg: string; text: string; border: string; icon: React.ElementType }> = {
  draft: {
    label: 'Draft',
    bg: 'bg-zinc-100',
    text: 'text-zinc-700',
    border: 'border-zinc-200',
    icon: FileEdit,
  },
  sent_for_approval: {
    label: 'Sent for Approval',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    icon: Send,
  },
  changes_requested: {
    label: 'Changes Requested',
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    icon: MessageSquare,
  },
  approved: {
    label: 'Approved',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    icon: CheckCircle2,
  },
  rejected: {
    label: 'Rejected',
    bg: 'bg-rose-100',
    text: 'text-rose-900',
    border: 'border-rose-300',
    icon: XCircle,
  },
  converted: {
    label: 'Converted to Invoice',
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    border: 'border-indigo-200',
    icon: ArrowRightCircle,
  },
  pending: {
    label: 'Pending Payment',
    bg: 'bg-blue-50',
    text: 'text-blue-800',
    border: 'border-blue-200',
    icon: Clock,
  },
  partially_paid: {
    label: 'Partial Payment',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    icon: Clock,
  },
  paid: {
    label: 'Paid',
    bg: 'bg-teal-50',
    text: 'text-teal-800',
    border: 'border-teal-200',
    icon: CheckCheck,
  },
  overdue: {
    label: 'Overdue',
    bg: 'bg-red-50',
    text: 'text-red-800',
    border: 'border-red-200',
    icon: AlertCircle,
  },
  void: {
    label: 'Void',
    bg: 'bg-zinc-100',
    text: 'text-zinc-500',
    border: 'border-zinc-200',
    icon: XCircle,
  },
};

export function StatusBadge({ status, className, size = 'md' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5 font-medium',
    lg: 'px-3 py-1.5 text-sm gap-2 font-medium',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border transition-colors whitespace-nowrap',
        config.bg,
        config.text,
        config.border,
        sizeClasses[size],
        className
      )}
    >
      <Icon className={cn(size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5')} />
      <span>{config.label}</span>
    </span>
  );
}
