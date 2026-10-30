import { describe, expect, it } from "vitest";
import { type JobInput, type JobInvoice, jobSentence, jobStage } from "~/domain/job";

const base: JobInput = {
  quoteStatus: "approved",
  pastValidUntil: false,
  hasDeposit: true,
  sentOn: "2026-10-27",
  approvedOn: "2026-10-29",
  invoices: [],
};

const inv = (
  kind: JobInvoice["kind"],
  status: JobInvoice["status"],
  id = `${kind}-${status}`,
): JobInvoice => ({
  id,
  kind,
  status,
  issueDate: status === "draft" ? null : "2026-10-30",
  balanceCents: status === "paid" ? 0 : 100,
});

describe("job steps (owner request: one step at a time)", () => {
  it("starts at Prepare quote with Continue the quote", () => {
    const s = jobStage({ ...base, quoteStatus: "draft", sentOn: null, approvedOn: null });
    expect(s).toMatchObject({ step: 1, key: "prepare", group: "now", actionLabel: "Continue the quote" });
    expect(s.steps.map((x) => x.state)).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("waits on the client after sending; changes or expiry need the owner", () => {
    expect(jobStage({ ...base, quoteStatus: "viewed", approvedOn: null })).toMatchObject({
      step: 2,
      group: "waiting",
      action: null,
    });
    expect(jobStage({ ...base, quoteStatus: "changes_requested" }).action).toEqual({
      kind: "review_changes",
    });
    expect(jobStage({ ...base, quoteStatus: "sent", pastValidUntil: true }).action).toEqual({
      kind: "extend_quote",
    });
    expect(jobStage({ ...base, quoteStatus: "declined" }).group).toBe("closed");
  });

  it("asks to check and send the deposit invoice drafted on approval", () => {
    const s = jobStage({ ...base, invoices: [inv("deposit", "draft", "inv_d")] });
    expect(s).toMatchObject({ step: 3, group: "now", action: { kind: "open_invoice", invoiceId: "inv_d" } });
    expect(jobStage(base).action).toEqual({ kind: "create_invoice", invoiceKind: "deposit" });
  });

  it("moves to Deposit paid, then the final invoice once the deposit is paid", () => {
    expect(jobStage({ ...base, invoices: [inv("deposit", "viewed", "inv_d")] })).toMatchObject({
      step: 4,
      group: "money",
      action: { kind: "record_payment", invoiceId: "inv_d" },
    });
    const working = jobStage({ ...base, invoices: [inv("deposit", "paid")] });
    expect(working).toMatchObject({
      step: 5,
      group: "finish",
      actionLabel: "Job finished: final invoice",
      action: { kind: "create_invoice", invoiceKind: "final" },
    });
    expect(working.steps.slice(0, 4).every((x) => x.state === "done")).toBe(true);
  });

  it("collects the final payment, then completes", () => {
    const owing = jobStage({
      ...base,
      invoices: [inv("deposit", "paid"), inv("final", "partially_paid", "inv_f")],
    });
    expect(owing).toMatchObject({
      step: 6,
      group: "money",
      action: { kind: "record_payment", invoiceId: "inv_f" },
    });
    const done = jobStage({ ...base, invoices: [inv("deposit", "paid"), inv("final", "paid")] });
    expect(done).toMatchObject({ step: 7, key: "complete", group: "complete", action: null });
    expect(done.steps.every((x) => x.state === "done")).toBe(true);
  });

  it("skips the deposit steps when the quote asks for none", () => {
    const s = jobStage({ ...base, hasDeposit: false });
    expect(s).toMatchObject({ step: 5, action: { kind: "create_invoice", invoiceKind: "full" } });
    expect(s.steps[2]!.state).toBe("skipped");
    expect(s.steps[3]!.state).toBe("skipped");
  });

  it("ignores void invoices (a reissue takes their place)", () => {
    const s = jobStage({ ...base, invoices: [inv("deposit", "void"), inv("deposit", "draft", "inv_new")] });
    expect(s.action).toEqual({ kind: "open_invoice", invoiceId: "inv_new" });
  });

  it("explains the step in plain English", () => {
    const s = jobStage({ ...base, invoices: [inv("deposit", "draft")] });
    expect(
      jobSentence(s, {
        clientFirstName: "Gboyega",
        depositAmount: "₦1,250,645.80",
        approvedOn: "29 Oct 2026",
      }),
    ).toBe("Gboyega approved on 29 Oct 2026. Ask for the deposit of ₦1,250,645.80 before work starts.");
  });

  it("has a sentence and the right button for every situation", () => {
    const facts = {
      clientFirstName: "Ada",
      depositAmount: "₦100",
      balance: "₦50",
      sentOn: "27 Oct",
      approvedOn: "29 Oct",
    };
    const cases: [JobInput, string, string | null][] = [
      [{ ...base, quoteStatus: "draft", sentOn: null }, "Add the rooms", "Continue the quote"],
      [{ ...base, quoteStatus: "sent" }, "Sent to Ada on 27 Oct", null],
      [{ ...base, quoteStatus: "declined" }, "Ada declined", null],
      [{ ...base, quoteStatus: "changes_requested" }, "Ada asked for changes", "Review the changes"],
      [{ ...base, quoteStatus: "expired" }, "past its valid-until date", "Extend the quote"],
      [base, "Ada approved on 29 Oct", "Make the deposit invoice"],
      [{ ...base, invoices: [inv("deposit", "sent")] }, "deposit invoice is with Ada", "Record payment"],
      [
        { ...base, invoices: [inv("deposit", "paid")] },
        "for the remaining ₦50",
        "Job finished: final invoice",
      ],
      [
        { ...base, invoices: [inv("deposit", "paid"), inv("final", "draft", "inv_f")] },
        "Check the invoice",
        "Check and send final invoice",
      ],
      [
        { ...base, invoices: [inv("deposit", "paid"), inv("final", "sent")] },
        "final invoice is with Ada",
        "Record payment",
      ],
      [{ ...base, invoices: [inv("deposit", "paid"), inv("final", "paid")] }, "Every invoice is paid", null],
      [{ ...base, hasDeposit: false }, "Check the invoice", "Make the invoice"],
    ];
    for (const [input, phrase, label] of cases) {
      const stage = jobStage(input);
      expect(jobSentence(stage, facts)).toContain(phrase);
      expect(stage.actionLabel).toBe(label);
    }
    expect(jobSentence(jobStage({ ...base, quoteStatus: "sent" }), { clientFirstName: "" })).toBe(
      "Sent to the client. Follow-up emails go automatically; you'll get an email the moment it's approved.",
    );
    expect(jobSentence(jobStage(base), { clientFirstName: "Ada" })).toBe(
      "Ada approved. Ask for the deposit before work starts.",
    );
    expect(
      jobSentence(jobStage({ ...base, invoices: [inv("deposit", "paid")] }), { clientFirstName: "Ada" }),
    ).toBe("The deposit is paid. When the work is finished, make the final invoice.");
  });
});
