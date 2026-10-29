import { Check, CircleHelp, EyeOff, MessageSquareText, Minus, PencilLine, X } from "lucide-react";
import type * as React from "react";
import { Avatar } from "~/components/ui/avatar";
import {
  CHANGE_KIND_LABEL,
  CHANGE_STATUS_LABEL,
  type ChangeKind,
  type ChangeStatus,
} from "~/domain/change-requests";
import { formatQuantity } from "~/domain/money";
import { formatDateTime } from "~/lib/dates";
import { cn } from "~/lib/utils";

// The pieces of a conversation thread (SPEC 5.14), shared by the app's
// ThreadPanel and the client portal so both sides see the same thread.

export interface ThreadRequestView {
  id: string;
  kind: ChangeKind;
  lineRef: string;
  lineLabel: string | null;
  proposedQtyMilli: number | null;
  status: ChangeStatus;
  resolutionNote: string | null;
  /** App only: set once an accepted request went out in a revision. */
  resolvedInRevisionId?: string | null;
}

export interface ThreadMessageView {
  id: string;
  from: "client" | "team";
  authorName: string;
  body: string;
  createdAt: string;
  hidden: boolean;
  request: ThreadRequestView | null;
}

const KIND_ICON: Record<ChangeKind, typeof Minus> = {
  remove: Minus,
  quantity: PencilLine,
  question: CircleHelp,
  other: MessageSquareText,
};

/** Status colours always come with the word (DS-COL rules, WCAG). */
const STATUS_TONE: Record<ChangeStatus, string> = {
  open: "bg-saffron-tint text-saffron-ink",
  accepted: "bg-sage-tint text-sage-ink",
  declined: "bg-surface-3 text-primary",
  answered: "bg-ocean-tint text-ocean-ink",
};

const STATUS_ICON: Record<ChangeStatus, typeof Check | null> = {
  open: null,
  accepted: Check,
  declined: X,
  answered: Check,
};

export function RequestStatusChip({ status, className }: { status: ChangeStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-micro font-semibold",
        STATUS_TONE[status],
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {CHANGE_STATUS_LABEL[status]}
    </span>
  );
}

/** What was asked: "Change quantity · Cushions → 1". */
export function requestSummary(r: ThreadRequestView, noun: "quote" | "invoice") {
  const line = r.lineRef === "document" ? `The whole ${noun}` : (r.lineLabel ?? "A line");
  const qty = r.kind === "quantity" && r.proposedQtyMilli ? ` → ${formatQuantity(r.proposedQtyMilli)}` : "";
  return { kind: CHANGE_KIND_LABEL[r.kind], line: `${line}${qty}` };
}

/**
 * ChangeRequestCard (SPEC 6.8 Inbox): Saffron while open, the outcome on the
 * card once resolved. `actions` holds Accept / Decline / Reply in the app.
 */
export function ChangeRequestCard({
  request,
  noun,
  body,
  actions,
  className,
}: {
  request: ThreadRequestView;
  noun: "quote" | "invoice";
  body?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const Icon = KIND_ICON[request.kind];
  const summary = requestSummary(request, noun);
  return (
    <div
      className={cn(
        "rounded-card border bg-surface p-3.5",
        request.status === "open" ? "border-saffron-base shadow-card" : "border-border",
        className,
      )}
      data-testid="change-request"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-control",
            request.status === "open" ? "bg-saffron-tint text-saffron-ink" : "bg-surface-2 text-secondary",
          )}
          aria-hidden
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-micro font-semibold tracking-[0.08em] text-secondary uppercase">
              {summary.kind}
            </p>
            <RequestStatusChip status={request.status} />
          </div>
          <p className="mt-0.5 font-semibold">{summary.line}</p>
          {body && <p className="mt-1 whitespace-pre-line text-secondary">{body}</p>}
          {request.resolutionNote && request.status !== "open" && (
            <p className="mt-2 rounded-control bg-surface-2 px-3 py-2 text-label">
              <span className="font-semibold">{request.status === "declined" ? "Reason: " : "Reply: "}</span>
              {request.resolutionNote}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">{actions}</div>}
    </div>
  );
}

/** One entry in the thread: the client on the left with their avatar, the team on the right. */
export function MessageItem({
  message,
  noun,
  teamName,
  highlight,
  actions,
  requestActions,
}: {
  message: ThreadMessageView;
  noun: "quote" | "invoice";
  /** How the team signs in this view: the business name in the portal. */
  teamName?: string;
  /** New since the owner last looked. */
  highlight?: boolean;
  actions?: React.ReactNode;
  requestActions?: React.ReactNode;
}) {
  const mine = message.from === "team";
  const name = mine ? (teamName ?? message.authorName) : message.authorName;
  return (
    <li className={cn("flex gap-2.5", mine && "flex-row-reverse")} data-testid="thread-message">
      <Avatar name={name} size="sm" className="mt-1" />
      <div className={cn("flex max-w-[min(34rem,88%)] min-w-0 flex-col gap-1", mine && "items-end")}>
        <p className="flex flex-wrap items-baseline gap-x-2 text-micro text-secondary">
          <span className="font-semibold text-primary">{name}</span>
          <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
          {highlight && (
            <span className="rounded-full bg-ocean-tint px-1.5 font-semibold text-ocean-ink">New</span>
          )}
        </p>
        {message.hidden ? (
          <p className="inline-flex items-center gap-2 rounded-card border border-dashed border-border px-3 py-2 text-label text-secondary">
            <EyeOff className="size-4" aria-hidden />
            Hidden from the client
          </p>
        ) : message.request ? (
          <ChangeRequestCard
            request={message.request}
            noun={noun}
            body={message.body}
            actions={requestActions}
            className="w-full"
          />
        ) : (
          <p
            className={cn(
              "rounded-card px-3.5 py-2.5 [overflow-wrap:anywhere] whitespace-pre-line",
              mine ? "bg-accent-tint text-primary" : "border border-border bg-surface",
            )}
          >
            {message.body}
          </p>
        )}
        {message.hidden && message.body && (
          <details className="text-label text-secondary">
            <summary className="inline-flex min-h-11 cursor-pointer items-center">Show what it said</summary>
            <p className="whitespace-pre-line">{message.body}</p>
          </details>
        )}
        {actions}
      </div>
    </li>
  );
}
