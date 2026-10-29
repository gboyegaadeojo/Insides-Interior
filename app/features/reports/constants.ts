// Report names and bases, shared by the screens (browser) and the service
// (server). Kept apart from service.ts so the browser bundle never pulls in
// server code.

export const REPORTS = ["revenue", "tax", "aged"] as const;
export type ReportName = (typeof REPORTS)[number];

export const REPORT_LABEL: Record<ReportName, string> = {
  revenue: "Revenue",
  tax: "VAT",
  aged: "Aged receivables",
};

/** The question each report answers (SPEC 6.8 Reports). */
export const REPORT_QUESTION: Record<ReportName, string> = {
  revenue: "How much did we earn, and from whom?",
  tax: "How much VAT did we charge and pay?",
  aged: "Who owes us money, and for how long?",
};

export const BASES = ["accrual", "cash"] as const;
export type Basis = (typeof BASES)[number];

export const BASIS_LABEL: Record<Basis, string> = {
  accrual: "Accrual basis",
  cash: "Cash basis",
};

export const BASIS_EXPLAINER: Record<Basis, string> = {
  accrual: "Counts invoices on the date they were issued, paid or not.",
  cash: "Counts money on the date it was received, including withholding tax.",
};

export const EXPORT_KINDS = ["invoices", "payments", "expenses"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const ITEM_TYPE_LABEL: Record<string, string> = {
  service: "Services",
  product: "Products",
  fee: "Fees",
  allowance: "Allowances",
  other: "Deposits and other",
};

/** Home chart periods (months). */
export const CHART_PERIODS = [6, 12] as const;
