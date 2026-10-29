// Invoice and payment constants shared by screens (browser) and services
// (server). Kept apart from service.ts so the browser bundle never pulls in
// server code.

export const INVOICE_FILTERS = ["all", "draft", "outstanding", "overdue", "paid", "void"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export const INVOICE_FILTER_LABELS: Record<InvoiceFilter, string> = {
  all: "All",
  draft: "Draft",
  outstanding: "Outstanding",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

/** Rows per page on list screens; "Show more" asks for the next page. */
export const INVOICE_PAGE_SIZE = 50;
export const PAYMENT_PAGE_SIZE = 50;

export const PAYMENT_METHODS = ["bank", "pos", "cash", "card", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank: "Bank transfer",
  pos: "POS",
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};

export const INVOICE_KIND_LABEL = {
  standard: "Invoice",
  deposit: "Deposit invoice",
  progress: "Progress invoice",
  final: "Final invoice",
} as const;

/** Common payment terms for the picker; null = choose a due date. */
export const TERMS_OPTIONS = [0, 7, 14, 30] as const;

/** Common withholding tax rates in Nigeria (FR-PAY-06), basis points. */
export const WHT_RATES = [500, 1000] as const;
