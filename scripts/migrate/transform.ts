import type { Plan, PlanLine } from "~/features/migration/schema";

// Old app ("InvoiceOS") → import plan (SPEC 12). Pure: no database, no files.
// The exports (Firestore and each browser's localStorage) are merged by id,
// keeping the newer updatedAt; the old app's seeded demo records are dropped;
// statuses are mapped per SPEC 12.2; money becomes integer kobo. The importer
// (import.ts) loads the plan through the services and reconciles.

/** Collections the old app used, by Firestore name. */
export const COLLECTIONS = [
  "customers",
  "items",
  "quotes",
  "quoteRevisions",
  "invoices",
  "payments",
  "expenses",
] as const;
export type Collection = (typeof COLLECTIONS)[number];

/** localStorage keys the old app wrote (its silent fallback, SPEC 2.3 C1/C2). */
export const BROWSER_KEYS: Record<string, Collection> = {
  invoiceos_demo_customers: "customers",
  invoiceos_demo_items: "items",
  invoiceos_demo_quotes: "quotes",
  invoiceos_demo_quote_revisions: "quoteRevisions",
  invoiceos_demo_invoices: "invoices",
  invoiceos_demo_payments: "payments",
  invoiceos_demo_expenses: "expenses",
};

export type LegacyRecord = Record<string, unknown> & { id?: unknown };

export interface FirestoreExport {
  source: "firestore";
  exportedAt: string;
  collections: Partial<Record<Collection, LegacyRecord[]>>;
}

export interface BrowserExport {
  source: "browser";
  exportedAt: string;
  origin?: string;
  keys: Record<string, unknown>;
}

export type LegacyExport = FirestoreExport | BrowserExport;

// The old app's seed data (legacy/src/lib/*-service.ts DEMO_*): never imported.
const DEMO_IDS = new Set([
  "cust_1",
  "cust_2",
  "cust_3",
  "item_1",
  "item_2",
  "item_3",
  "item_4",
  "inv_101",
  "inv_102",
  "inv_103",
  "quote_201",
  "quote_202",
]);
const DEMO_NAMES = new Set(["acme corporation", "starlight media", "nexus technologies"]);

// ---------- Small parsers ----------

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A Firestore timestamp ({seconds}), Date string or ISO string → ISO, or "". */
export function isoOf(v: unknown): string {
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (v && typeof v === "object") {
    const o = v as { seconds?: unknown; _seconds?: unknown };
    const s = typeof o.seconds === "number" ? o.seconds : typeof o._seconds === "number" ? o._seconds : null;
    if (s !== null) return new Date(s * 1000).toISOString();
  }
  return "";
}

/** YYYY-MM-DD from a date-ish value, or null. */
export function dateOf(v: unknown): string | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const iso = isoOf(v);
  return iso ? iso.slice(0, 10) : null;
}

/**
 * A decimal number from the old app (floats in naira) as an integer of
 * `places` decimals, rounded half up on the decimal string, so 6184.5 → 618450
 * kobo and 0.1 + 0.2 → 30, never 30.000000000000004.
 */
export function scaled(v: unknown, places: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replaceAll(",", "")) : NaN;
  if (!Number.isFinite(n)) return null;
  const negative = n < 0;
  const [whole, frac = ""] = Math.abs(n).toFixed(8).split(".");
  const kept = BigInt(`${whole}${frac.slice(0, places)}`);
  const roundUp = Number(frac[places] ?? "0") >= 5 ? 1n : 0n;
  const value = Number(kept + roundUp);
  return negative ? -value : value;
}

export const kobo = (v: unknown) => scaled(v, 2);

// ---------- Merge ----------

export interface Merged {
  records: Record<Collection, LegacyRecord[]>;
  /** Per collection: how many came from each source, and how many were demo. */
  counts: Record<Collection, { firestore: number; browser: number; merged: number; demo: number }>;
}

function collectionsOf(e: LegacyExport): Partial<Record<Collection, LegacyRecord[]>> {
  if (e.source === "firestore") return e.collections;
  const out: Partial<Record<Collection, LegacyRecord[]>> = {};
  for (const [key, value] of Object.entries(e.keys)) {
    const name = BROWSER_KEYS[key];
    if (!name) continue;
    const parsed = typeof value === "string" ? safeJson(value) : value;
    if (Array.isArray(parsed)) out[name] = [...(out[name] ?? []), ...(parsed as LegacyRecord[])];
  }
  return out;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isDemo(name: Collection, r: LegacyRecord): boolean {
  if (typeof r.id === "string" && DEMO_IDS.has(r.id)) return true;
  if (r.userId === "demo_user") return true;
  if (name === "customers" && DEMO_NAMES.has(String(r.name ?? "").toLowerCase())) return true;
  if ((name === "quotes" || name === "invoices") && DEMO_IDS.has(String(r.customerId ?? ""))) return true;
  if (
    (name === "quoteRevisions" || name === "payments") &&
    DEMO_IDS.has(String(r.quoteId ?? r.invoiceId ?? ""))
  )
    return true;
  return false;
}

/** SPEC 12.1 step 4: union by id; the newer updatedAt (then createdAt) wins; demo records dropped. */
export function mergeExports(exports: LegacyExport[]): Merged {
  const records = Object.fromEntries(COLLECTIONS.map((c) => [c, []])) as unknown as Record<
    Collection,
    LegacyRecord[]
  >;
  const counts = Object.fromEntries(
    COLLECTIONS.map((c) => [c, { firestore: 0, browser: 0, merged: 0, demo: 0 }]),
  ) as Merged["counts"];
  const byId = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map<string, LegacyRecord>()])) as Record<
    Collection,
    Map<string, LegacyRecord>
  >;
  const stamp = (r: LegacyRecord) => isoOf(r.updatedAt) || isoOf(r.createdAt);
  for (const e of exports) {
    for (const [name, list] of Object.entries(collectionsOf(e)) as [Collection, LegacyRecord[]][]) {
      for (const r of list ?? []) {
        if (!r || typeof r !== "object" || typeof r.id !== "string") continue;
        counts[name][e.source] += 1;
        if (isDemo(name, r)) {
          counts[name].demo += 1;
          continue;
        }
        const existing = byId[name].get(r.id);
        if (!existing || stamp(r) > stamp(existing)) byId[name].set(r.id, r);
      }
    }
  }
  for (const name of COLLECTIONS) {
    records[name] = [...byId[name].values()];
    counts[name].merged = records[name].length;
  }
  return { records, counts };
}

// ---------- Transform ----------

export type InvoiceStatusIn = "draft" | "sent" | "partially_paid" | "paid" | "void";
export type QuoteStatusIn = "draft" | "sent" | "changes_requested" | "approved" | "declined";

/** SPEC 12.2. Paid and partly paid are recomputed from payments by the importer. */
export function mapInvoiceStatus(old: unknown): InvoiceStatusIn | null {
  switch (old) {
    case "draft":
      return "draft";
    case "pending":
    case "overdue":
      return "sent";
    case "partially_paid":
    case "paid":
      return old;
    case "void":
      return "void";
    default:
      return null;
  }
}

export function mapQuoteStatus(old: unknown): { status: QuoteStatusIn; converted: boolean } | null {
  switch (old) {
    case "draft":
      return { status: "draft", converted: false };
    case "sent":
    case "sent_for_approval":
      return { status: "sent", converted: false };
    case "changes_requested":
      return { status: "changes_requested", converted: false };
    case "approved":
    case "accepted":
      return { status: "approved", converted: false };
    case "converted":
      return { status: "approved", converted: true };
    case "rejected":
      return { status: "declined", converted: false };
    default:
      return null;
  }
}

const CATEGORY: Record<string, Plan["expenses"][number]["category"]> = {
  general: "other",
  software: "office",
  equipment: "tools",
  travel: "transport",
  marketing: "other",
  office: "office",
  meals: "other",
};

export function mapCategory(old: unknown): Plan["expenses"][number]["category"] {
  return CATEGORY[String(old ?? "").toLowerCase()] ?? "other";
}

export function mapMethod(old: unknown): "bank" | "pos" | "cash" | "card" | "cheque" | "other" {
  const m = String(old ?? "").toLowerCase();
  if (m.includes("bank") || m.includes("transfer")) return "bank";
  if (m.includes("pos")) return "pos";
  if (m.includes("cash")) return "cash";
  if (m.includes("card") || m.includes("credit") || m.includes("debit")) return "card";
  if (m.includes("cheque") || m.includes("check")) return "cheque";
  return "other";
}

function lines(raw: unknown, warn: (m: string) => void, where: string): PlanLine[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanLine[] = [];
  for (const [n, l] of raw.entries()) {
    const line = (l ?? {}) as Record<string, unknown>;
    const qty = scaled(line.quantity ?? 1, 3);
    const price = kobo(line.unitPrice);
    const taxBp = scaled(line.taxRate ?? 0, 2) ?? 0;
    if (qty === null || price === null) {
      warn(`${where}: line ${n + 1} has no usable quantity or price; skipped`);
      continue;
    }
    const discount = line.type === "discount";
    out.push({
      description: str(line.description) ?? (discount ? "Discount" : "Item"),
      qtyMilli: qty,
      // Discount lines become negative lines (credits) so totals still add up.
      unitPriceCents: discount ? -Math.abs(price) : price,
      taxBp,
      itemType: discount ? "fee" : line.type === "product" ? "product" : "service",
    });
  }
  return out;
}

export function buildPlan(merged: Merged): Plan {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const r = merged.records;

  const clients: Plan["clients"] = r.customers.map((c) => ({
    legacyId: String(c.id),
    displayName: str(c.name) ?? "Unnamed client",
    email: str(c.email),
    phone: str(c.phone),
    address: str(c.billingAddress),
    notes: [str(c.notes), str(c.taxId) && `Tax ID: ${str(c.taxId)}`].filter(Boolean).join("\n") || null,
  }));
  const clientIds = new Set(clients.map((c) => c.legacyId));

  const items: Plan["items"] = r.items.flatMap((i) => {
    const price = kobo(i.unitPrice);
    if (price === null || price < 0) {
      warn(`Catalogue item ${String(i.id)} has no usable price; skipped`);
      return [];
    }
    return [
      {
        legacyId: String(i.id),
        type: i.type === "product" ? ("product" as const) : ("service" as const),
        name: str(i.name) ?? "Untitled item",
        description: str(i.description),
        priceCents: price,
        taxable: i.isTaxable !== false,
      },
    ];
  });

  // A changes-requested quote's latest client comment (quote or its revisions).
  const comments = new Map<string, { at: string; text: string }>();
  for (const rev of r.quoteRevisions) {
    const text = str(rev.clientComment);
    const quoteId = str(rev.quoteId);
    if (!text || !quoteId) continue;
    const at = isoOf(rev.createdAt);
    const prev = comments.get(quoteId);
    if (!prev || at > prev.at) comments.set(quoteId, { at, text });
  }

  const checkClient = (where: string, id: unknown) => {
    const cid = str(id);
    if (cid && !clientIds.has(cid)) warn(`${where}: its client (${cid}) wasn't in the export`);
    return cid && clientIds.has(cid) ? cid : null;
  };

  const quotes: Plan["quotes"] = r.quotes.flatMap((q) => {
    const where = `Quote ${str(q.quoteNumber) ?? String(q.id)}`;
    const mapped = mapQuoteStatus(q.status);
    if (!mapped) {
      warn(`${where}: unknown status "${String(q.status)}"; skipped`);
      return [];
    }
    const own = [...(Array.isArray(q.publicRevisions) ? q.publicRevisions : [])]
      .map((p) => str((p as Record<string, unknown>).clientComment))
      .filter(Boolean)
      .at(-1);
    return [
      {
        legacyId: String(q.id),
        number: str(q.quoteNumber),
        status: mapped.status,
        converted: mapped.converted,
        clientLegacyId: checkClient(where, q.customerId),
        clientName: str(q.customerName),
        issueDate: dateOf(q.issueDate),
        validUntil: dateOf(q.expiryDate),
        lines: lines(q.lineItems, warn, where),
        notes: str(q.notes),
        terms: str(q.terms),
        legacyTotalCents: kobo(q.total),
        clientComment:
          mapped.status === "changes_requested" ? (comments.get(String(q.id))?.text ?? own ?? null) : null,
      },
    ];
  });

  const invoices: Plan["invoices"] = r.invoices.flatMap((i) => {
    const where = `Invoice ${str(i.invoiceNumber) ?? String(i.id)}`;
    const status = mapInvoiceStatus(i.status);
    if (!status) {
      warn(`${where}: unknown status "${String(i.status)}"; skipped`);
      return [];
    }
    const from = /Converted from Quote #(\S+?)\.?(\s|$)/.exec(String(i.notes ?? ""));
    return [
      {
        legacyId: String(i.id),
        number: str(i.invoiceNumber),
        status,
        clientLegacyId: checkClient(where, i.customerId),
        clientName: str(i.customerName),
        issueDate: dateOf(i.issueDate),
        dueDate: dateOf(i.dueDate),
        lines: lines(i.lineItems, warn, where),
        notes: str(i.notes),
        terms: str(i.terms),
        legacyTotalCents: kobo(i.total),
        legacyBalanceCents: kobo(i.balanceDue),
        fromQuoteNumber: from?.[1] ?? null,
      },
    ];
  });

  // Duplicate numbers (the old app's random numbers collided, SPEC 2.3 C3).
  for (const [label, docs] of [
    ["quote", quotes],
    ["invoice", invoices],
  ] as const) {
    const seen = new Map<string, number>();
    for (const d of docs) if (d.number) seen.set(d.number, (seen.get(d.number) ?? 0) + 1);
    for (const [number, n] of seen)
      if (n > 1) warn(`${n} ${label}s share the number ${number}; later ones get "-dup" added. Review them.`);
  }

  // Tax rates other than Nigeria's 7.5% VAT need the owner's eye (SPEC 12.1 step 5).
  const rates = new Set(
    [...quotes, ...invoices].flatMap((d) => d.lines.map((l) => l.taxBp)).filter((bp) => bp > 0),
  );
  for (const bp of rates) {
    if (bp !== 750)
      warn(
        `Some lines carry a ${bp / 100}% tax (not VAT 7.5%). They keep that rate as a frozen "Tax ${bp / 100}%"; check with the owner.`,
      );
  }

  const invoiceIds = new Set(invoices.map((i) => i.legacyId));
  const payments: Plan["payments"] = r.payments.flatMap((p) => {
    const amount = kobo(p.amount);
    const invoiceId = str(p.invoiceId);
    const date = dateOf(p.date);
    if (!invoiceId || !invoiceIds.has(invoiceId) || amount === null || amount <= 0 || !date) {
      warn(`Payment ${String(p.id)} has no matching invoice, amount or date; skipped`);
      return [];
    }
    return [
      {
        legacyId: String(p.id),
        invoiceLegacyId: invoiceId,
        amountCents: amount,
        receivedOn: date,
        method: mapMethod(p.method),
        note: str(p.notes),
      },
    ];
  });

  const expenses: Plan["expenses"] = r.expenses.flatMap((e) => {
    const amount = kobo(e.amount);
    const date = dateOf(e.date);
    if (amount === null || amount <= 0 || !date) {
      warn(`Expense ${String(e.id)} has no usable amount or date; skipped`);
      return [];
    }
    return [
      {
        legacyId: String(e.id),
        date,
        supplier: str(e.merchant) ?? "Unknown supplier",
        category: mapCategory(e.category),
        amountCents: amount,
        note: str(e.description),
        receiptUrl: str(e.receiptUrl),
      },
    ];
  });

  return { clients, items, quotes, invoices, payments, expenses, warnings };
}
