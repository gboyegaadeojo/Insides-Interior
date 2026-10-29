import { Plus, Send } from "lucide-react";
import * as React from "react";
import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { TextField, Textarea } from "~/components/ui/field";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { formatCents } from "~/domain/money";
import { type MergeValues, renderMergeFields } from "~/lib/merge-fields";

/**
 * FR-QT-08 / FR-INV-05: send with the PDF attached and the portal link; CC/BCC;
 * a preview of the email in the owner's wording before it goes. The button
 * waits for autosave so the server sends exactly what's on screen, and is
 * disabled while sending. Posts intent=send with the draft version.
 */
export function SendSheet({
  open,
  onOpenChange,
  noun,
  revision,
  number,
  nextNumber,
  wording,
  values,
  revisedSubject,
  client,
  totalCents,
  version,
  saving,
  blocked,
  error,
  openRequests = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noun: "quote" | "invoice";
  /** 1 for a first send, N+1 when sending a revision. */
  revision: number;
  /** The existing number of a revision, else null. */
  number: string | null;
  nextNumber: string | null;
  wording?: { subject: string; body: string };
  values: MergeValues;
  revisedSubject: string;
  /** The client as last loaded, when it's the one on the draft. */
  client: { id: string; name: string; email: string | null; emailBounced: boolean } | null;
  totalCents: number;
  version: number;
  saving: boolean;
  blocked: string | null;
  error: { error: string | null; field: string | null } | null;
  /** Change requests still open on a revision being sent (FR-MSG-05/07). */
  openRequests?: number;
}) {
  const navigation = useNavigation();
  const sendingNow = navigation.state !== "idle" && navigation.formData?.get("intent") === "send";
  const [copies, setCopies] = React.useState(false);
  const formId = React.useId();
  const shown = number ?? nextNumber ?? "your next number";
  const subject = revision > 1 ? revisedSubject : wording ? renderMergeFields(wording.subject, values) : "";
  const fieldError = (name: string) => (error?.field === name ? (error.error ?? undefined) : undefined);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={revision > 1 ? `Send revision ${revision}` : `Send ${noun}`}
        description={
          number
            ? `${number} goes out with its PDF and a link to view${noun === "quote" ? " and approve" : " and pay"}.`
            : `It gets its number when it's sent, most likely ${shown}.`
        }
        footer={
          <div className="flex flex-col gap-2">
            {(blocked || saving) && (
              <p className="text-label font-semibold text-secondary" role="status">
                {blocked ?? "Saving your latest changes…"}
              </p>
            )}
            <Button
              type="submit"
              form={formId}
              size="lg"
              className="w-full"
              loading={sendingNow}
              disabled={!!blocked || saving}
            >
              <Send aria-hidden />
              Send {formatCents(totalCents)}
            </Button>
          </div>
        }
      >
        <Form method="post" id={formId} className="flex flex-col gap-5">
          <input type="hidden" name="intent" value="send" />
          <input type="hidden" name="version" value={version} />
          {error?.error && !["to", "cc", "bcc"].includes(error.field ?? "") && (
            <p
              role="alert"
              className="rounded-card border border-danger-base bg-danger-tint p-3 font-semibold text-danger-ink"
            >
              {error.error}
            </p>
          )}
          {client?.emailBounced && (
            <p
              role="alert"
              className="rounded-card border border-saffron-base bg-saffron-tint p-3 text-saffron-ink"
            >
              <span className="font-semibold">The last email to {client.email} bounced.</span> Check the
              address before sending.
            </p>
          )}
          <TextField
            key={client?.id ?? "other"}
            label="To"
            name="to"
            type="email"
            required
            autoComplete="off"
            defaultValue={client?.email ?? ""}
            error={fieldError("to")}
            hint={client && !client.email ? "This client has no email saved yet" : undefined}
          />
          {copies ? (
            <>
              <TextField
                label="CC"
                name="cc"
                autoComplete="off"
                hint="Separate addresses with commas"
                error={fieldError("cc")}
              />
              <TextField
                label="BCC"
                name="bcc"
                autoComplete="off"
                hint="Separate addresses with commas"
                error={fieldError("bcc")}
              />
            </>
          ) : (
            <Button type="button" variant="ghost" className="self-start" onClick={() => setCopies(true)}>
              <Plus aria-hidden />
              Add CC or BCC
            </Button>
          )}
          <Textarea
            label="Personal note (optional)"
            name="note"
            maxLength={2000}
            hint={`Shown in the email above the ${noun} details`}
          />
          {openRequests > 0 && (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-saffron-base bg-saffron-tint p-3 text-saffron-ink">
              <input
                type="checkbox"
                name="resolveOpen"
                defaultChecked
                className="mt-0.5 size-6 shrink-0 accent-[var(--accent)]"
              />
              <span>
                <span className="font-semibold">
                  This revision deals with the {openRequests} open request{openRequests === 1 ? "" : "s"}
                </span>
                <span className="block text-label">
                  Untick to keep {openRequests === 1 ? "it" : "them"} open: the {noun} then stays in Changes
                  requested{noun === "quote" ? " and can't be approved" : ""}.
                </span>
              </span>
            </label>
          )}
          {wording && (
            <section
              aria-label="Email preview"
              className="rounded-card border border-border bg-surface-2 p-4"
            >
              <p className="text-micro font-semibold tracking-[0.08em] text-secondary uppercase">
                Email preview
              </p>
              <p className="mt-2 font-semibold">{subject}</p>
              <div className="mt-2 flex flex-col gap-2 text-label text-secondary">
                {renderMergeFields(wording.body, values)
                  .split(/\n\s*\n/)
                  .filter(Boolean)
                  .map((p) => (
                    <p key={p} className="whitespace-pre-line">
                      {p}
                    </p>
                  ))}
              </div>
              <p className="mt-3 text-micro text-secondary">
                Change this wording in Settings → Email. The PDF is attached.
              </p>
            </section>
          )}
        </Form>
      </SheetContent>
    </Sheet>
  );
}
