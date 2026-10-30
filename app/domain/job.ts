// Job steps (owner request, mockup approved 2026-10-30): every quote is a job
// that moves through seven steps, so the owner always sees where it is and the
// one thing to do next. Pure: the quote page, the Quotes list and Home share it.
//
//   1 Prepare quote → 2 Client approval → 3 Deposit invoice → 4 Deposit paid
//   → 5 Final invoice → 6 Final payment → 7 Complete
//
// Steps 3–4 are skipped when the quote asks for no deposit and none was sent.
// Progress invoices belong to step 5 (the work is under way).

import type { InvoiceStatus, QuoteStatus } from "./lifecycle";

export const JOB_STEPS = [
  { key: "prepare", label: "Prepare quote" },
  { key: "approval", label: "Client approval" },
  { key: "deposit_invoice", label: "Deposit invoice" },
  { key: "deposit_paid", label: "Deposit paid" },
  { key: "final_invoice", label: "Final invoice" },
  { key: "final_payment", label: "Final payment" },
  { key: "complete", label: "Complete" },
] as const;

export type JobStepKey = (typeof JOB_STEPS)[number]["key"];

export interface JobInvoice {
  id: string;
  kind: "standard" | "deposit" | "progress" | "final";
  status: InvoiceStatus;
  issueDate: string | null;
  balanceCents: number;
}

export interface JobInput {
  quoteStatus: QuoteStatus;
  /** Valid-until date has passed (the stored status may still say sent). */
  pastValidUntil: boolean;
  /** The quote asks for a deposit. */
  hasDeposit: boolean;
  sentOn: string | null;
  approvedOn: string | null;
  /** Every invoice made from the quote, void ones included. */
  invoices: JobInvoice[];
}

/** What the big button does. The screens turn it into a link or a form. */
export type JobAction =
  | { kind: "continue_quote" }
  | { kind: "review_changes" }
  | { kind: "extend_quote" }
  | { kind: "create_invoice"; invoiceKind: "deposit" | "final" | "full" }
  | { kind: "open_invoice"; invoiceId: string }
  | { kind: "record_payment"; invoiceId: string };

/** Where a job sits on Home and in the Quotes list. */
export type JobGroup = "now" | "money" | "finish" | "waiting" | "complete" | "closed";

export interface JobStage {
  /** 1–7, the current step (7 once complete). */
  step: number;
  key: JobStepKey;
  steps: {
    key: JobStepKey;
    label: string;
    state: "done" | "current" | "upcoming" | "skipped";
    date: string | null;
  }[];
  /** Short line for lists: "Send the deposit invoice". */
  headline: string;
  group: JobGroup;
  /** Button label; null when the job is waiting on the client or done. */
  actionLabel: string | null;
  action: JobAction | null;
  /** The invoice the current step is about, if any. */
  invoiceId: string | null;
}

const sent = (i: JobInvoice) => i.status !== "draft" && i.status !== "void";
const live = (i: JobInvoice) => i.status !== "void";

export function jobStage(input: JobInput): JobStage {
  const invoices = input.invoices.filter(live);
  const deposits = invoices.filter((i) => i.kind === "deposit");
  const finals = invoices.filter((i) => i.kind === "final" || i.kind === "standard");
  const sentDeposits = deposits.filter(sent);
  const sentFinals = finals.filter(sent);
  const usesDeposit = input.hasDeposit || deposits.length > 0;
  const approved = input.quoteStatus === "approved";

  const done: Record<JobStepKey, boolean> = {
    prepare: input.quoteStatus !== "draft" || !!input.sentOn,
    approval: approved,
    deposit_invoice: approved && (!usesDeposit || sentDeposits.length > 0),
    deposit_paid:
      approved &&
      (!usesDeposit || (sentDeposits.length > 0 && sentDeposits.every((i) => i.status === "paid"))),
    final_invoice: approved && sentFinals.length > 0,
    final_payment: false,
    complete: false,
  };
  done.final_payment =
    done.final_invoice && done.deposit_paid && invoices.filter(sent).every((i) => i.status === "paid");
  done.complete = done.final_payment;

  const dates: Record<JobStepKey, string | null> = {
    prepare: input.sentOn,
    approval: input.approvedOn,
    deposit_invoice: sentDeposits[0]?.issueDate ?? null,
    deposit_paid: null,
    final_invoice: sentFinals[0]?.issueDate ?? null,
    final_payment: null,
    complete: null,
  };

  const order = JOB_STEPS.map((s) => s.key);
  const currentIndex = done.complete ? order.length - 1 : order.findIndex((k) => !done[k]);
  const key = order[currentIndex]!;
  const skipped = (k: JobStepKey) => !usesDeposit && (k === "deposit_invoice" || k === "deposit_paid");
  const steps = JOB_STEPS.map((s, index) => ({
    key: s.key,
    label: s.label,
    state: skipped(s.key)
      ? ("skipped" as const)
      : index < currentIndex || (done.complete && index === currentIndex)
        ? ("done" as const)
        : index === currentIndex
          ? ("current" as const)
          : ("upcoming" as const),
    date: dates[s.key],
  }));

  const next = nextAction(key, input, { deposits, finals, invoices, usesDeposit });
  return { step: currentIndex + 1, key, steps, ...next };
}

function nextAction(
  key: JobStepKey,
  input: JobInput,
  ctx: { deposits: JobInvoice[]; finals: JobInvoice[]; invoices: JobInvoice[]; usesDeposit: boolean },
): Pick<JobStage, "headline" | "group" | "actionLabel" | "action" | "invoiceId"> {
  const unpaid = (list: JobInvoice[]) => list.find((i) => sent(i) && i.status !== "paid");
  const draft = (list: JobInvoice[]) => list.find((i) => i.status === "draft");
  switch (key) {
    case "prepare":
      return {
        headline: "Finish and send the quote",
        group: "now",
        actionLabel: "Continue the quote",
        action: { kind: "continue_quote" },
        invoiceId: null,
      };
    case "approval":
      if (input.quoteStatus === "declined")
        return {
          headline: "The client declined",
          group: "closed",
          actionLabel: null,
          action: null,
          invoiceId: null,
        };
      if (input.quoteStatus === "changes_requested")
        return {
          headline: "The client asked for changes",
          group: "now",
          actionLabel: "Review the changes",
          action: { kind: "review_changes" },
          invoiceId: null,
        };
      if (input.quoteStatus === "expired" || input.pastValidUntil)
        return {
          headline: "The quote has expired",
          group: "now",
          actionLabel: "Extend the quote",
          action: { kind: "extend_quote" },
          invoiceId: null,
        };
      return {
        headline: "Waiting for approval",
        group: "waiting",
        actionLabel: null,
        action: null,
        invoiceId: null,
      };
    case "deposit_invoice": {
      const d = draft(ctx.deposits);
      return d
        ? {
            headline: "Send the deposit invoice",
            group: "now",
            actionLabel: "Check and send deposit invoice",
            action: { kind: "open_invoice", invoiceId: d.id },
            invoiceId: d.id,
          }
        : {
            headline: "Send the deposit invoice",
            group: "now",
            actionLabel: "Make the deposit invoice",
            action: { kind: "create_invoice", invoiceKind: "deposit" },
            invoiceId: null,
          };
    }
    case "deposit_paid": {
      const d = unpaid(ctx.deposits)!;
      return {
        headline: "Waiting for the deposit",
        group: "money",
        actionLabel: "Record payment",
        action: { kind: "record_payment", invoiceId: d.id },
        invoiceId: d.id,
      };
    }
    case "final_invoice": {
      const d = draft(ctx.finals);
      if (d)
        return {
          headline: "Send the final invoice",
          group: "now",
          actionLabel: "Check and send final invoice",
          action: { kind: "open_invoice", invoiceId: d.id },
          invoiceId: d.id,
        };
      return ctx.usesDeposit
        ? {
            headline: "Work in progress",
            group: "finish",
            actionLabel: "Job finished: final invoice",
            action: { kind: "create_invoice", invoiceKind: "final" },
            invoiceId: null,
          }
        : {
            headline: "Send the invoice",
            group: "now",
            actionLabel: "Make the invoice",
            action: { kind: "create_invoice", invoiceKind: "full" },
            invoiceId: null,
          };
    }
    case "final_payment": {
      const d = unpaid(ctx.invoices)!;
      return {
        headline: "Waiting for the final payment",
        group: "money",
        actionLabel: "Record payment",
        action: { kind: "record_payment", invoiceId: d.id },
        invoiceId: d.id,
      };
    }
    case "complete":
      return {
        headline: "Complete, fully paid",
        group: "complete",
        actionLabel: null,
        action: null,
        invoiceId: null,
      };
  }
}

/** Plain-English sentence for the Next step card. */
export function jobSentence(
  stage: JobStage,
  facts: {
    clientFirstName: string;
    depositAmount?: string;
    balance?: string;
    sentOn?: string;
    approvedOn?: string;
  },
): string {
  const who = facts.clientFirstName || "The client";
  switch (stage.key) {
    case "prepare":
      return "Add the rooms and items, then send it to the client. Nothing reaches them until you press Send.";
    case "approval":
      if (stage.group === "closed") return `${who} declined this quote. Duplicate it to start again.`;
      if (stage.action?.kind === "review_changes")
        return `${who} asked for changes. Read them, then send a revised quote.`;
      if (stage.action?.kind === "extend_quote")
        return `The quote is past its valid-until date, so ${who} can't approve it. Extend it to give more time.`;
      return `Sent to ${facts.clientFirstName || "the client"}${facts.sentOn ? ` on ${facts.sentOn}` : ""}. Follow-up emails go automatically; you'll get an email the moment it's approved.`;
    case "deposit_invoice":
      return `${who} approved${facts.approvedOn ? ` on ${facts.approvedOn}` : ""}. Ask for the deposit${facts.depositAmount ? ` of ${facts.depositAmount}` : ""} before work starts.`;
    case "deposit_paid":
      return `The deposit invoice is with ${who}. When the money arrives, record it here.`;
    case "final_invoice":
      return stage.group === "finish"
        ? `The deposit is paid. When the work is finished, make the final invoice${facts.balance ? ` for the remaining ${facts.balance}` : ""}.`
        : "Check the invoice, then send it to the client.";
    case "final_payment":
      return `The final invoice is with ${who}. When the money arrives, record it here.`;
    case "complete":
      return "Every invoice is paid. Nothing more to do on this job.";
  }
}
