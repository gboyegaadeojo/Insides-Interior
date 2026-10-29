import { ClipboardCopy, Mail, RefreshCw, Share2 } from "lucide-react";
import * as React from "react";
import { Form } from "react-router";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { TextField } from "~/components/ui/field";
import { toast } from "~/components/ui/toast";
import { activityLabel, relativeTime } from "~/lib/activity-label";
import { cn } from "~/lib/utils";

// Cards beside a sent quote or invoice: the client's link and the history of
// emails and activity (SPEC 6.8, FR-QT-08, FR-INV-05).

const noSubscribe = () => () => {};

/** The portal link to copy or share (WhatsApp), and New link to revoke it (SPEC 8.4). */
export function ClientLinkCard({
  url,
  busy,
  noun,
}: {
  url: string;
  busy: boolean;
  noun: "quote" | "invoice";
}) {
  const [confirm, setConfirm] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const canShare = React.useSyncExternalStore(
    noSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", { tone: "success" });
    } catch {
      toast("Couldn't copy; select the link and copy it", { tone: "error" });
    }
  }
  return (
    <Card>
      <h2 className="font-display text-title">Client link</h2>
      <p className="mt-1 text-label text-secondary">
        Anyone with this link can view{" "}
        {noun === "quote" ? "and approve the quote" : "the invoice and how to pay"}. Share it by WhatsApp or
        text if email is slow.
      </p>
      <TextField
        label="Link"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        fieldClassName="mt-3"
        className="text-label"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={copy}>
          <ClipboardCopy aria-hidden />
          Copy link
        </Button>
        {canShare && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigator.share({ url }).catch(() => {})}
          >
            <Share2 aria-hidden />
            Share
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => setConfirm(true)} loading={busy}>
          <RefreshCw aria-hidden />
          New link
        </Button>
      </div>
      <Form method="post" ref={formRef} className="hidden">
        <input type="hidden" name="intent" value="rotate_link" />
      </Form>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Make a new link?"
        description="The current link stops working at once. Use this if the link went to the wrong person."
        confirmLabel="Make a new link"
        destructive
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </Card>
  );
}

const EMAIL_LABEL: Record<string, string> = {
  quote_sent: "Quote sent",
  quote_revised: "Revision sent",
  quote_approved_client: "Approval receipt to client",
  quote_approved_owner: "Approval notice",
  quote_changes_requested_owner: "Change request notice",
  invoice_sent: "Invoice sent",
  invoice_revised: "Revision sent",
  invoice_changes_requested_owner: "Change request notice",
  payment_receipt: "Payment receipt",
};

const EMAIL_STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Sending", tone: "text-secondary" },
  sent: { label: "Sent", tone: "text-indigo-ink" },
  delivered: { label: "Delivered", tone: "text-teal-ink" },
  opened: { label: "Opened", tone: "text-sage-ink" },
  bounced: { label: "Bounced", tone: "text-danger-ink" },
  complained: { label: "Marked as spam", tone: "text-danger-ink" },
  failed: { label: "Failed", tone: "text-danger-ink" },
};

export interface HistoryData {
  events: { id: string; action: string; data: Record<string, unknown> | null; at: string }[];
  emails: {
    id: string;
    template: string;
    to: string;
    status: string;
    error: string | null;
    stuck: boolean;
  }[];
}

/** Emails with delivery status (Retry when stuck) and the activity log. */
export function HistoryCard({ history, retrying }: { history: HistoryData; retrying: boolean }) {
  const latest = history.emails.find((e) => /_(sent|revised)$/.test(e.template));
  return (
    <Card>
      <h2 className="font-display text-title">History</h2>
      {history.emails.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Emails">
          {history.emails.map((email) => {
            const s = EMAIL_STATUS[email.status] ?? EMAIL_STATUS.queued!;
            return (
              <li key={email.id} className="flex items-start gap-3 rounded-control bg-surface-2 p-3">
                <Mail className="mt-0.5 size-4.5 shrink-0 text-secondary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{EMAIL_LABEL[email.template] ?? email.template}</p>
                  <p className="truncate text-label text-secondary">to {email.to}</p>
                  {email.error && <p className="text-label text-danger-ink">{email.error}</p>}
                </div>
                <span className={cn("text-label font-semibold", s.tone)}>{s.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {latest?.stuck && (
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="retry_email" />
          <Button type="submit" variant="secondary" className="w-full" loading={retrying}>
            <RefreshCw aria-hidden />
            Retry the email
          </Button>
        </Form>
      )}
      <ol className="mt-4 flex flex-col gap-2 border-t border-border pt-4" aria-label="Activity">
        {history.events.map((event) => (
          <li key={event.id} className="flex items-baseline justify-between gap-3 text-label">
            <span>{activityLabel(event.action, event.data)}</span>
            <time dateTime={event.at} className="shrink-0 text-secondary">
              {relativeTime(event.at)}
            </time>
          </li>
        ))}
      </ol>
    </Card>
  );
}
