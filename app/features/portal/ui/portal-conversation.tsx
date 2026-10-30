import { ArrowRight, History, MessageSquareText, Send } from "lucide-react";
import * as React from "react";
import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Select, TextField, Textarea } from "~/components/ui/field";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { CHANGE_KIND_LABEL, type ChangeKind, kindsFor, WHOLE_DOCUMENT } from "~/domain/change-requests";
import { formatCents, formatQuantity } from "~/domain/money";
import { MessageItem, type ThreadMessageView } from "~/features/conversations/ui/thread-parts";
import { cn } from "~/lib/utils";

// The conversation under a portal document (SPEC 6.8, FR-MSG-01…03): the
// thread, a message box, "Request a change" on a line, and the What changed
// summary of a revision (FR-MSG-06). Phone first; the name is asked once and
// remembered on this device (FR-MSG-02).

export interface PortalResult {
  ok: boolean;
  intent: string;
  fieldErrors: Record<string, string>;
  error: string | null;
  code: string | null;
}

const NAME_KEY = "insides.portal.name";
const NAME_EVENT = "insides:portal-name";

function readName() {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

function subscribeName(onChange: () => void) {
  window.addEventListener(NAME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(NAME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function rememberName(form: HTMLFormElement) {
  const name = String(new FormData(form).get("name") ?? "").trim();
  if (name.length < 2) return;
  try {
    localStorage.setItem(NAME_KEY, name);
    window.dispatchEvent(new Event(NAME_EVENT));
  } catch {
    // Private browsing: nothing to remember.
  }
}

/** "Sending as Amaka · Change", or a name field the first time. */
function NameField({ fallback, error }: { fallback: string; error?: string }) {
  const remembered = React.useSyncExternalStore(subscribeName, readName, () => null);
  const [editing, setEditing] = React.useState(false);
  if (remembered && !editing && !error) {
    return (
      <p className="flex min-h-11 flex-wrap items-center gap-x-2 text-label text-secondary">
        <input type="hidden" name="name" value={remembered} />
        Sending as <span className="font-semibold text-primary">{remembered}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-11 items-center font-semibold text-primary underline"
        >
          Change
        </button>
      </p>
    );
  }
  return (
    <TextField
      label="Your name"
      name="name"
      autoComplete="name"
      required
      minLength={2}
      maxLength={120}
      defaultValue={remembered || fallback}
      error={error}
    />
  );
}

export function PortalThread({
  noun,
  businessName,
  clientName,
  messages,
  revisionId,
  canMessage,
  closedReason,
  result,
  composerRef,
}: {
  noun: "quote" | "invoice";
  businessName: string;
  clientName: string;
  messages: ThreadMessageView[];
  revisionId: string;
  canMessage: boolean;
  closedReason?: string;
  result?: PortalResult;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const navigation = useNavigation();
  const sending = navigation.state !== "idle" && navigation.formData?.get("intent") === "message";
  const formRef = React.useRef<HTMLFormElement>(null);
  const error = result && !result.ok && result.intent === "message" ? result : undefined;
  React.useEffect(() => {
    if (result?.ok && result.intent === "message") formRef.current?.reset();
  }, [result]);
  return (
    <section
      id="conversation"
      aria-labelledby="conversation-heading"
      className="mt-6 scroll-mt-4 rounded-card border border-border bg-surface p-4 shadow-card tablet:p-6"
    >
      <h2 id="conversation-heading" className="flex items-center gap-2 font-display text-title">
        <MessageSquareText className="size-5 text-secondary" aria-hidden />
        Messages
      </h2>
      <p className="mt-1 text-label text-secondary">
        Questions or changes go straight to {businessName}. Replies also come by email.
      </p>
      {messages.length > 0 && (
        <ol className="mt-5 flex flex-col gap-4" aria-label="Messages">
          {messages.map((message) => (
            <MessageItem key={message.id} message={message} noun={noun} teamName={businessName} />
          ))}
        </ol>
      )}
      {canMessage ? (
        <Form
          method="post"
          ref={formRef}
          preventScrollReset
          className="mt-5 flex flex-col gap-3 border-t border-border pt-5"
          onSubmit={(e) => rememberName(e.currentTarget)}
        >
          <input type="hidden" name="intent" value="message" />
          <input type="hidden" name="revisionId" value={revisionId} />
          {error?.error && (
            <p
              role="alert"
              className="rounded-card border border-danger-base bg-danger-tint p-3 font-semibold text-danger-ink"
            >
              {error.error}
            </p>
          )}
          <Textarea
            ref={composerRef}
            label={messages.length > 0 ? "Reply" : "Write a message"}
            name="message"
            required
            maxLength={2000}
            className="min-h-28"
            error={error?.fieldErrors.message}
          />
          <NameField fallback={clientName} error={error?.fieldErrors.name} />
          <Button type="submit" size="lg" className="tablet:self-end" loading={sending}>
            <Send aria-hidden />
            Send message
          </Button>
        </Form>
      ) : (
        closedReason && <p className="mt-4 text-label text-secondary">{closedReason}</p>
      )}
    </section>
  );
}

export interface RequestableLine {
  id: string;
  description: string;
  room: string;
  qtyMilli: number;
  unit: string;
  locked?: boolean;
}

/**
 * "Request a change" (FR-MSG-03): which line (or the whole document), what
 * kind of change, and a note. Nothing changes until the business sends a
 * revision, and the sheet says so.
 */
export function ChangeRequestSheet({
  open,
  onOpenChange,
  noun,
  businessName,
  clientName,
  lines,
  lineRef,
  onLineRef,
  revisionId,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noun: "quote" | "invoice";
  businessName: string;
  clientName: string;
  lines: RequestableLine[];
  lineRef: string;
  onLineRef: (lineRef: string) => void;
  revisionId: string;
  result?: PortalResult;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle" && navigation.formData?.get("intent") === "change_request";
  const formId = React.useId();
  const line = lines.find((l) => l.id === lineRef) ?? null;
  const kinds = kindsFor(line);
  // The choice belongs to a line: picking another line starts from its first option.
  const [pick, setPick] = React.useState<{ lineRef: string; kind: ChangeKind } | null>(null);
  const chosen = pick && pick.lineRef === lineRef && kinds.includes(pick.kind) ? pick.kind : kinds[0]!;
  const setKind = (kind: ChangeKind) => setPick({ lineRef, kind });
  const error = result && !result.ok && result.intent === "change_request" ? result : undefined;
  const rooms = [...new Set(lines.map((l) => l.room))];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Request a change"
        description={`${businessName} replies by email. Nothing on the ${noun} changes until they send a revised one.`}
        footer={
          <Button type="submit" form={formId} size="lg" className="w-full" loading={submitting}>
            Send request
          </Button>
        }
      >
        <Form
          method="post"
          id={formId}
          className="flex flex-col gap-5"
          preventScrollReset
          onSubmit={(e) => rememberName(e.currentTarget)}
        >
          <input type="hidden" name="intent" value="change_request" />
          <input type="hidden" name="revisionId" value={revisionId} />
          {error?.error && (
            <div
              role="alert"
              className="rounded-card border border-danger-base bg-danger-tint p-3 font-semibold text-danger-ink"
            >
              {error.error}
              {error.code === "stale" && (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2 w-full"
                  onClick={() => window.location.reload()}
                >
                  See the latest version
                </Button>
              )}
            </div>
          )}
          <Select
            label="Which item?"
            name="lineRef"
            value={lineRef}
            onChange={(e) => onLineRef(e.target.value)}
            error={error?.fieldErrors.lineRef}
          >
            <option value={WHOLE_DOCUMENT}>The whole {noun}</option>
            {rooms.map((room) => (
              <optgroup key={room} label={room || "Items"}>
                {lines
                  .filter((l) => l.room === room)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.description || "Untitled line"}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-label font-semibold">What would you like?</legend>
            {kinds.map((k) => (
              <label
                key={k}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-control border px-3.5 transition-colors duration-fast",
                  chosen === k ? "border-accent bg-accent-tint" : "border-border hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={chosen === k}
                  onChange={() => setKind(k)}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                />
                <span className="font-semibold">{CHANGE_KIND_LABEL[k]}</span>
              </label>
            ))}
            {error?.fieldErrors.kind && (
              <p role="alert" className="text-label font-semibold text-danger-ink">
                {error.fieldErrors.kind}
              </p>
            )}
          </fieldset>

          {chosen === "quantity" && line && (
            <TextField
              label={`New quantity (now ${formatQuantity(line.qtyMilli)})`}
              name="quantity"
              inputMode="decimal"
              required
              autoComplete="off"
              className="tabular"
              fieldClassName="max-w-64"
              error={error?.fieldErrors.quantity}
            />
          )}
          <Textarea
            label={
              chosen === "question"
                ? "Your question"
                : chosen === "other"
                  ? "What would you like to change?"
                  : "Anything to add? (optional)"
            }
            name="note"
            required={chosen === "question" || chosen === "other"}
            maxLength={2000}
            className="min-h-28"
            hint={chosen === "other" ? "For example: a different fabric for the curtains" : undefined}
            error={error?.fieldErrors.note}
          />
          <NameField fallback={clientName} error={error?.fieldErrors.name} />
        </Form>
      </SheetContent>
    </Sheet>
  );
}

export interface WhatChangedData {
  previousRevisionNo: number;
  lines: string[];
  totalBeforeCents: number;
  totalAfterCents: number;
}

/** FR-MSG-06: the latest revision's changes and the total before and after. */
export function WhatChanged({ data, revisionNo }: { data: WhatChangedData; revisionNo: number }) {
  return (
    <section
      aria-labelledby="what-changed-heading"
      className="mt-6 rounded-card border border-indigo-base bg-surface p-4 shadow-card tablet:p-5"
      data-testid="what-changed"
    >
      <h2 id="what-changed-heading" className="flex items-center gap-2 font-display text-title">
        <History className="size-5 text-indigo-ink" aria-hidden />
        What changed in rev {revisionNo}
      </h2>
      {data.lines.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.lines.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-indigo-base" />
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-secondary">Dates and details only; the lines are the same.</p>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="text-secondary">Total</span>
        <span className="text-secondary tabular line-through decoration-1">
          {formatCents(data.totalBeforeCents)}
        </span>
        <ArrowRight className="size-4 text-secondary" aria-label="now" />
        <span className="font-semibold tabular">{formatCents(data.totalAfterCents)}</span>
        <span className="sr-only">(rev {data.previousRevisionNo} total, then this revision's total)</span>
      </p>
    </section>
  );
}

/** The quiet "Request a change" under each line of the portal document. */
export function lineActionFor(onRequest: (lineId: string) => void, enabled: boolean) {
  if (!enabled) return undefined;
  return function LineAction(line: { id: string; description: string }) {
    return (
      <button
        type="button"
        className="doc-line-action"
        onClick={() => onRequest(line.id)}
        aria-label={`Request a change to ${line.description || "this line"}`}
      >
        Request a change
      </button>
    );
  };
}
