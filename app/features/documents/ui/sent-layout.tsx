import * as React from "react";
import { Card } from "~/components/ui/card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { cn } from "~/lib/utils";

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const linkedToConversation = () => window.location.hash === "#conversation";

/**
 * Document detail (SPEC 6.8): the document, the status cards beside it and the
 * conversation thread. From tablet landscape up the thread sits in the right
 * column; below that it's a tab, opened by default when something is waiting
 * for the owner or the link ends in #conversation (owner emails).
 */
export function SentDocumentLayout({
  document,
  cards,
  moreCards,
  thread,
  threadCount,
  attention,
}: {
  document: React.ReactNode;
  /** Status cards above the thread: approval, balance, payments. */
  cards: React.ReactNode;
  /** Cards under the thread: link and history. */
  moreCards: React.ReactNode;
  thread: React.ReactNode | null;
  /** Open requests plus unread messages, shown on the tab. */
  threadCount: number;
  attention: boolean;
}) {
  const linked = React.useSyncExternalStore(subscribeHash, linkedToConversation, () => false);
  const [chosen, setTab] = React.useState<"document" | "conversation" | null>(null);
  const tab = chosen ?? (attention || linked ? "conversation" : "document");
  const talking = thread !== null && tab === "conversation";
  return (
    <div className="flex flex-col gap-4 wide:grid wide:grid-cols-[minmax(0,1fr)_24rem] wide:items-start wide:gap-6">
      {thread !== null && (
        <SegmentedControl
          label="Show"
          value={tab}
          onValueChange={setTab}
          className="wide:hidden"
          segments={[
            { value: "document", label: "Document" },
            { value: "conversation", label: "Conversation", count: threadCount || undefined },
          ]}
        />
      )}
      <div className={cn("order-2 min-w-0 wide:order-1", talking && "hidden wide:block")}>{document}</div>
      <div className="order-1 flex min-w-0 flex-col gap-4 wide:order-2">
        <div className={cn("flex flex-col gap-4", talking && "hidden wide:flex")}>{cards}</div>
        {thread !== null && <Card className={cn(!talking && "hidden wide:block")}>{thread}</Card>}
        <div className={cn("flex flex-col gap-4", talking && "hidden wide:flex")}>{moreCards}</div>
      </div>
    </div>
  );
}
