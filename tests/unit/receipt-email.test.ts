import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATE_DEFAULTS } from "~/lib/merge-fields";
import { paymentReceiptEmail } from "~/server/email/templates";

const brand = { name: "Insides Interior", brandColor: "#5A7A10" };
const defaults = EMAIL_TEMPLATE_DEFAULTS.payment_receipt!;
const base = {
  clientName: "Gboyega Adeojo",
  number: "INV-1003",
  amount: "₦4,411,500.00",
  method: "Cash",
  receivedOn: "30 Oct 2026",
  balance: "₦0.00",
  paidInFull: true,
  url: "https://example.ng/i/x",
  defaults: { subject: defaults.subject, body: defaults.body },
};

describe("payment receipt (owner request: deposits are not paid in full)", () => {
  it("says a settled 85% deposit leaves the 15% balance on the quote", () => {
    const email = paymentReceiptEmail(brand, {
      ...base,
      job: {
        part: "Deposit",
        quoteNumber: "Q-1003",
        total: "₦5,190,000.00",
        paid: "₦4,411,500.00",
        remaining: "₦778,500.00",
        settled: false,
      },
    });
    expect(email.html).toContain("Deposit received, thank you");
    expect(email.html).not.toContain("Paid in full");
    expect(email.text).toContain("Balance remaining: ₦778,500.00");
    expect(email.text).toContain("still to be paid");
    expect(email.text).toContain("Q-1003 total");
    expect(email.text).not.toContain("₦0.00");
  });

  it("says paid in full once the whole job is paid", () => {
    const email = paymentReceiptEmail(brand, {
      ...base,
      job: {
        part: "Progress payment",
        quoteNumber: "Q-1003",
        total: "₦5,190,000.00",
        paid: "₦5,190,000.00",
        remaining: "₦0.00",
        settled: true,
      },
    });
    expect(email.html).toContain("Paid in full, thank you");
  });

  it("keeps the plain receipt for an ordinary invoice", () => {
    const email = paymentReceiptEmail(brand, base);
    expect(email.html).toContain("Paid in full, thank you");
    expect(email.text).toContain("Balance remaining: ₦0.00");
  });
});
