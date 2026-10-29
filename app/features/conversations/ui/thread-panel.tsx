import { Check, Eye, EyeOff, MessageSquareText, Reply, Send, X } from "lucide-react";
import * as React from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Textarea } from "~/components/ui/field";
import { toast } from "~/components/ui/toast";
import { resolutionsFor } from "~/domain/change-requests";
import { cn } from "~/lib/utils";
import { MessageItem, requestSummary, type ThreadMessageView, type ThreadRequestView } from "./thread-parts";

// ThreadPanel (SPEC 6.8 document detail and Inbox): the conversation beside a
// quote or invoice. Change-request cards offer Accept / Decline / Reply (Mark
// answered for questions); accepting makes the draft revision and opens it.
// Every button is disabled while its request is in flight (CLAUDE.md).

export interface ThreadPanelData {
  conversationId: string | null;
  messages: ThreadMessageView[];
  unreadBefore: number;
  openRequests: number;
}

interface ActionResult {
  ok: boolean;
  error: string | null;
  field: string | null;
  message: string | null;
}

export interface ThreadPanelProps {
  entity: "quote" | "invoice";
  entityId: string;
  thread: ThreadPanelData;
  clientName: string | null;
  /** Sent documents only: drafts have no thread yet. */
  canReply: boolean;
  /** Owners may hide client messages (FR-MSG-10). */
  canHide: boolean;
  /** An invoice with payments: accepting means void and reissue (FR-MSG-06). */
  hasPayments?: boolean;
  /** Shows the heading (off when a tab already names it). */
  heading?: boolean;
  /** Why requests can't be resolved right now (unsaved edits in the builder). */
  resolveBlocked?: string;
  className?: string;
}

/** Toasts a fetcher's success once, when it arrives. */
function useResultToast(data: ActionResult | undefined) {
  React.useEffect(() => {
    if (data?.ok && data.message) toast(data.message, { tone: "success" });
  }, [data]);
}

export function ThreadPanel(props: ThreadPanelProps) {
  const { entity, entityId, thread } = props;
  const action = `/api/threads/${entity}/${entityId}`;
  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const open = thread.messages.filter((m) => m.request?.status === "open").map((m) => m.request!);
  const acceptable = open.filter((r) => resolutionsFor(r.kind).includes("accept"));
  // The last `unreadBefore` client messages arrived since the owner last looked.
  const fresh = new Set(
    thread.messages
      .filter((m) => m.from === "client")
      .slice(thread.unreadBefore > 0 ? -thread.unreadBefore : thread.messages.length)
      .map((m) => m.id),
  );

  return (
    <section
      id="conversation"
      aria-labelledby="conversation-heading"
      className={cn("flex flex-col gap-4", props.className)}
    >
      <div className={cn("flex flex-wrap items-center gap-2", !props.heading && "sr-only")}>
        <h2 id="conversation-heading" className="font-display text-title">
          Conversation
        </h2>
        {thread.openRequests > 0 && (
          <span className="rounded-full bg-saffron-tint px-2.5 py-0.5 text-micro font-semibold text-saffron-ink">
            {thread.openRequests} open request{thread.openRequests === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {props.resolveBlocked && open.length > 0 && (
        <p role="status" className="rounded-card bg-surface-2 p-3 text-label text-secondary">
          {props.resolveBlocked}
        </p>
      )}

      {acceptable.length > 1 && !props.resolveBlocked && (
        <AcceptAll action={action} requests={acceptable} entity={entity} hasPayments={props.hasPayments} />
      )}

      {thread.messages.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border px-4 py-8 text-center">
          <MessageSquareText className="size-6 text-tertiary" aria-hidden />
          <p className="font-semibold">No messages yet</p>
          <p className="max-w-xs text-label text-secondary">
            When {props.clientName ?? "the client"} writes or asks for a change from their link, it shows
            here.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-4" aria-label="Messages">
          {thread.messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              noun={entity}
              highlight={fresh.has(message.id)}
              actions={
                props.canHide && message.from === "client" ? (
                  <HideButton action={action} messageId={message.id} hidden={message.hidden} />
                ) : undefined
              }
              requestActions={
                message.request?.status === "open" && props.resolveBlocked ? (
                  <Button type="button" variant="ghost" onClick={() => composerRef.current?.focus()}>
                    <Reply aria-hidden />
                    Reply
                  </Button>
                ) : message.request?.status === "open" ? (
                  <RequestActions
                    action={action}
                    request={message.request}
                    entity={entity}
                    hasPayments={props.hasPayments}
                    onReply={() => composerRef.current?.focus()}
                  />
                ) : undefined
              }
            />
          ))}
        </ol>
      )}

      {props.canReply ? (
        <Composer action={action} clientName={props.clientName} textareaRef={composerRef} />
      ) : (
        <p className="text-label text-secondary">The conversation starts once the {entity} is sent.</p>
      )}
    </section>
  );
}

function Composer({
  action,
  clientName,
  textareaRef,
}: {
  action: string;
  clientName: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const fetcher = useFetcher<ActionResult>();
  const formRef = React.useRef<HTMLFormElement>(null);
  const sending = fetcher.state !== "idle";
  useResultToast(fetcher.data);
  // Clear the box once the reply is in.
  React.useEffect(() => {
    if (fetcher.data?.ok) formRef.current?.reset();
  }, [fetcher.data]);
  return (
    <fetcher.Form method="post" action={action} ref={formRef} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="reply" />
      <Textarea
        ref={textareaRef}
        label={clientName ? `Reply to ${clientName}` : "Reply"}
        name="body"
        required
        maxLength={2000}
        className="min-h-24"
        hint="They get it by email with a link back here."
        error={fetcher.data && !fetcher.data.ok ? (fetcher.data.error ?? undefined) : undefined}
      />
      <Button type="submit" size="lg" className="self-end" loading={sending}>
        <Send aria-hidden />
        Send reply
      </Button>
    </fetcher.Form>
  );
}

function RequestActions({
  action,
  request,
  entity,
  hasPayments,
  onReply,
}: {
  action: string;
  request: ThreadRequestView;
  entity: "quote" | "invoice";
  hasPayments?: boolean;
  onReply: () => void;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [mode, setMode] = React.useState<null | "decline" | "answer">(null);
  const [reissue, setReissue] = React.useState(false);
  const busy = fetcher.state !== "idle";
  const pending = fetcher.formData?.get("decision");
  useResultToast(fetcher.data);
  const options = resolutionsFor(request.kind);
  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  const formRef = React.useRef<HTMLFormElement>(null);
  const summary = requestSummary(request, entity);

  if (mode) {
    return (
      <fetcher.Form method="post" action={action} className="flex w-full flex-col gap-2">
        <input type="hidden" name="intent" value="resolve" />
        <input type="hidden" name="decision" value={mode} />
        <input type="hidden" name="requestId" value={request.id} />
        <Textarea
          label={mode === "decline" ? "Reason for the client" : "Answer (optional)"}
          name="note"
          required={mode === "decline"}
          minLength={mode === "decline" ? 2 : undefined}
          maxLength={2000}
          className="min-h-20"
          error={error ?? undefined}
          autoFocus
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setMode(null)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {mode === "decline" ? "Decline request" : "Mark answered"}
          </Button>
        </div>
      </fetcher.Form>
    );
  }

  return (
    <>
      {options.includes("accept") && (
        <fetcher.Form method="post" action={action} ref={formRef}>
          <input type="hidden" name="intent" value="resolve" />
          <input type="hidden" name="decision" value="accept" />
          <input type="hidden" name="requestId" value={request.id} />
          {hasPayments && <input type="hidden" name="reissue" value="on" />}
          <Button
            type={hasPayments ? "button" : "submit"}
            onClick={hasPayments ? () => setReissue(true) : undefined}
            loading={busy && pending === "accept"}
            disabled={busy}
          >
            <Check aria-hidden />
            Accept
          </Button>
        </fetcher.Form>
      )}
      {options.includes("decline") && (
        <Button type="button" variant="secondary" onClick={() => setMode("decline")} disabled={busy}>
          <X aria-hidden />
          Decline
        </Button>
      )}
      {options.includes("answer") && (
        <Button type="button" variant="secondary" onClick={() => setMode("answer")} disabled={busy}>
          <Check aria-hidden />
          Mark answered
        </Button>
      )}
      <Button type="button" variant="ghost" onClick={onReply} disabled={busy}>
        <Reply aria-hidden />
        Reply
      </Button>
      {error && (
        <p role="alert" className="basis-full text-label font-semibold text-danger-ink">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={reissue}
        onOpenChange={setReissue}
        title="Void and reissue?"
        description={`This invoice has payments, so it can't be revised in place. It's marked VOID and a corrected draft with "${summary.line}" changed takes over its payments, ready to check and send.`}
        confirmLabel="Void and reissue"
        destructive
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </>
  );
}

function AcceptAll({
  action,
  requests,
  entity,
  hasPayments,
}: {
  action: string;
  requests: ThreadRequestView[];
  entity: "quote" | "invoice";
  hasPayments?: boolean;
}) {
  const fetcher = useFetcher<ActionResult>();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [confirm, setConfirm] = React.useState(false);
  useResultToast(fetcher.data);
  return (
    <fetcher.Form
      method="post"
      action={action}
      ref={formRef}
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-saffron-base bg-saffron-tint p-3 text-saffron-ink"
    >
      <input type="hidden" name="intent" value="resolve" />
      <input type="hidden" name="decision" value="accept" />
      {hasPayments && <input type="hidden" name="reissue" value="on" />}
      {requests.map((r) => (
        <input key={r.id} type="hidden" name="requestId" value={r.id} />
      ))}
      <p className="text-label font-semibold">
        {requests.length} changes asked for. Accepting them together makes one revised {entity}.
      </p>
      <Button type="button" loading={fetcher.state !== "idle"} onClick={() => setConfirm(true)}>
        <Check aria-hidden />
        Accept all {requests.length}
      </Button>
      {fetcher.data && !fetcher.data.ok && (
        <p role="alert" className="basis-full text-label font-semibold text-danger-ink">
          {fetcher.data.error}
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={hasPayments ? "Void and reissue with these changes?" : `Accept all ${requests.length}?`}
        description={
          hasPayments
            ? "This invoice has payments: it's marked VOID and one corrected draft with every change takes over its payments."
            : `One draft revision opens with every change applied and totals recalculated. Nothing reaches the client until you send it.`
        }
        confirmLabel={hasPayments ? "Void and reissue" : "Accept all"}
        destructive={hasPayments}
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </fetcher.Form>
  );
}

function HideButton({ action, messageId, hidden }: { action: string; messageId: string; hidden: boolean }) {
  const fetcher = useFetcher<ActionResult>();
  useResultToast(fetcher.data);
  return (
    <fetcher.Form method="post" action={action}>
      <input type="hidden" name="intent" value={hidden ? "unhide" : "hide"} />
      <input type="hidden" name="messageId" value={messageId} />
      <Button
        type="submit"
        variant="ghost"
        size="md"
        className="text-label text-secondary"
        loading={fetcher.state !== "idle"}
      >
        {hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
        {hidden ? "Show to client" : "Hide"}
      </Button>
    </fetcher.Form>
  );
}
