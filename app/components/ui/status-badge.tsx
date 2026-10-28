import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Eye,
  type LucideIcon,
  MessageSquareText,
  Pencil,
  Send,
  XCircle,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { TONE, type ToneName } from "./hue";

// Refactored from legacy/src/components/shared/status-badge.tsx (SPEC 2.5): the
// config-map pattern is kept; statuses are those of SPEC 5.13 plus the "due
// soon" display state, labels follow SPEC 0.2 and styles follow SPEC 6.3.

export const STATUSES = [
  "draft",
  "sent",
  "viewed",
  "changes_requested",
  "approved",
  "partially_paid",
  "paid",
  "due_soon",
  "overdue",
  "declined",
  "expired",
  "void",
] as const;
export type Status = (typeof STATUSES)[number];

type Style = "outline" | "tinted" | "solid";

export const STATUS_CONFIG: Record<
  Status,
  { label: string; tone: ToneName | "neutral"; style: Style; icon?: LucideIcon }
> = {
  draft: { label: "Draft", tone: "slate", style: "outline", icon: Pencil },
  sent: { label: "Sent", tone: "indigo", style: "tinted", icon: Send },
  viewed: { label: "Viewed", tone: "ocean", style: "tinted", icon: Eye },
  changes_requested: {
    label: "Changes requested",
    tone: "saffron",
    style: "tinted",
    icon: MessageSquareText,
  },
  approved: { label: "Approved", tone: "sage", style: "solid", icon: Check },
  partially_paid: { label: "Partially paid", tone: "teal", style: "tinted" },
  paid: { label: "Paid", tone: "sage", style: "solid", icon: CheckCheck },
  due_soon: { label: "Due soon", tone: "saffron", style: "tinted", icon: Clock },
  overdue: { label: "Overdue", tone: "danger", style: "solid", icon: AlertCircle },
  declined: { label: "Declined", tone: "roseclay", style: "tinted", icon: XCircle },
  expired: { label: "Expired", tone: "roseclay", style: "tinted", icon: Clock },
  void: { label: "Void", tone: "neutral", style: "outline" },
};

export interface StatusBadgeProps {
  status: Status;
  /** 0–100, shown as a progress ring for partially paid (SPEC 6.3). */
  percentPaid?: number;
  /** Revision number; a sent document with rev ≥ 2 reads "Revised (rev N)". */
  revision?: number;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({ status, percentPaid, revision, size = "md", className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const label = revision && revision > 1 && status === "sent" ? `Revised (rev ${revision})` : config.label;
  const tone = config.tone === "neutral" ? null : TONE[config.tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap",
        size === "md" ? "h-7 px-2.5 text-micro" : "h-6 px-2 text-micro",
        config.style === "outline" && "border-current bg-surface",
        config.style === "outline" && (tone ? tone.ink : "text-secondary"),
        config.style === "tinted" && tone && cn(tone.soft, "border-transparent"),
        config.style === "solid" && tone && cn(tone.solid, "border-transparent"),
        className,
      )}
    >
      {status === "partially_paid" ? (
        <ProgressRing percent={percentPaid ?? 0} />
      ) : (
        Icon && <Icon className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className={cn(status === "void" && "line-through")}>{label}</span>
      {status === "partially_paid" && percentPaid !== undefined && (
        <span className="sr-only">, {Math.round(percentPaid)}% paid</span>
      )}
    </span>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const circumference = 2 * Math.PI * 5;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0 -rotate-90" aria-hidden>
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        strokeLinecap="round"
      />
    </svg>
  );
}
