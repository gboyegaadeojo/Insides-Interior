import { Check, MessageSquareText } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { requestSummary } from "./thread-parts";
import { ThreadPanel, type ThreadPanelData } from "./thread-panel";

// The conversation while a revision is being edited: what was accepted into
// it, and the thread in a sheet so the builder stays put.

/** "Accepted into this revision" under the revising banner (FR-MSG-05). */
export function RevisionRequests({
  thread,
  noun,
}: {
  thread: ThreadPanelData | null;
  noun: "quote" | "invoice";
}) {
  const accepted = (thread?.messages ?? []).flatMap((m) =>
    m.request?.status === "accepted" && !m.request.resolvedInRevisionId ? [m.request] : [],
  );
  const open = thread?.openRequests ?? 0;
  if (accepted.length === 0 && open === 0) return null;
  return (
    <div className="mt-2">
      {open > 0 && (
        <p>
          {open} request{open === 1 ? " is" : "s are"} still open. Make the change here, then tick “This
          revision deals with…” when you send, or resolve {open === 1 ? "it" : "them"} in the conversation.
        </p>
      )}
      {accepted.length > 0 && <p className="font-semibold">Accepted into this revision:</p>}
      <ul
        hidden={accepted.length === 0}
        className="mt-1 flex flex-col gap-0.5"
        data-testid="accepted-requests"
      >
        {accepted.map((r) => {
          const s = requestSummary(r, noun);
          return (
            <li key={r.id} className="flex items-start gap-1.5">
              <Check className="mt-1 size-4 shrink-0" aria-hidden />
              <span>
                {s.kind}: {s.line}
                {r.kind === "other" && " (make this change yourself)"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ConversationButton({ thread, onOpen }: { thread: ThreadPanelData; onOpen: () => void }) {
  const waiting = thread.openRequests + thread.unreadBefore;
  return (
    <Button type="button" variant="secondary" onClick={onOpen} className="shrink-0">
      <MessageSquareText aria-hidden />
      Conversation
      {waiting > 0 && (
        <span className="rounded-full bg-saffron-tint px-1.5 text-micro font-bold text-saffron-ink">
          {waiting}
        </span>
      )}
    </Button>
  );
}

export function ConversationSheet({
  open,
  onOpenChange,
  entity,
  entityId,
  thread,
  clientName,
  canHide,
  hasPayments,
  dirty,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: "quote" | "invoice";
  entityId: string;
  thread: ThreadPanelData;
  clientName: string | null;
  canHide: boolean;
  hasPayments?: boolean;
  /** Unsaved edits: accepting more requests waits until they're saved. */
  dirty: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Conversation" description={clientName ? `With ${clientName}` : undefined}>
        <ThreadPanel
          entity={entity}
          entityId={entityId}
          thread={thread}
          clientName={clientName}
          canReply
          canHide={canHide}
          hasPayments={hasPayments}
          resolveBlocked={
            dirty ? "Your latest edits are still saving; accept more once they're saved." : undefined
          }
        />
      </SheetContent>
    </Sheet>
  );
}
