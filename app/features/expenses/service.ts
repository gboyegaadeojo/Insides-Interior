// Expenses (SPEC 5.10): receipts captured to R2 first, then the expense saved
// with the stored key, so "saved" only ever shows after storage confirmed.
// Billable expenses go on the project's next draft invoice as ordinary lines
// that remember their expense (FR-EXP-02); a line removed from the draft, a
// deleted draft or a voided invoice makes the expense billable again.

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { computeContent } from "~/domain/document";
import { expenseNetCents, rechargeCents } from "~/domain/reports";
import { createInvoice } from "~/features/invoices/service";
import { ServiceError } from "~/features/settings/service";
import { businessToday, formatDate } from "~/lib/dates";
import { newId } from "~/lib/ids";
import { likeTerm } from "~/lib/like";
import { activityInsert } from "~/server/audit";
import { type DocumentContent, schema } from "~/server/db";
import { IMAGE_TYPES } from "~/server/files";
import type { RequestContext } from "~/server/session";
import { categoryOf, EXPENSE_PAGE_SIZE, type ExpenseCategory, RECEIPT_MAX_BYTES } from "./constants";
import type { BillExpensesInput, ExpenseInput } from "./schema";

type Ctx = Pick<RequestContext, "db" | "user">;
type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
const nowIso = () => new Date().toISOString();

const RECEIPT_TYPES: Record<string, string> = { ...IMAGE_TYPES, "application/pdf": "pdf" };

function audit(ctx: RequestContext, entityId: string, action: string, data?: Record<string, unknown>) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType: "expense",
    entityId,
    action,
    data,
  });
}

/** Billed means on a live (not void) invoice; a voided invoice frees the expense again. */
const billedSql = sql<number>`case when ${schema.expense.billedInvoiceId} is not null and coalesce((select ${schema.invoice.status} from ${schema.invoice} where ${schema.invoice.id} = ${schema.expense.billedInvoiceId}), 'void') <> 'void' then 1 else 0 end`;

// ---------- Receipts ----------

function receiptPrefix(ctx: Ctx) {
  return `receipts/${ctx.user.businessId}/`;
}

/**
 * FR-EXP-01: stores a receipt in R2 and returns its key once R2 has it. The
 * expense is saved separately with this key, so a photo taken before the form
 * is finished is never lost and never shown as saved too early.
 */
export async function uploadReceipt(ctx: RequestContext, file: File) {
  const ext = RECEIPT_TYPES[file.type];
  if (!ext) throw new ServiceError("Upload a photo (JPEG, PNG, WebP, HEIC) or a PDF", "receipt");
  if (file.size === 0) throw new ServiceError("That file is empty", "receipt");
  if (file.size > RECEIPT_MAX_BYTES)
    throw new ServiceError("The receipt must be 10 MB or smaller", "receipt");
  const key = `${receiptPrefix(ctx)}${newId("exp").slice(4)}.${ext}`;
  const stored = await ctx.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  if (!stored) throw new ServiceError("The receipt couldn't be stored; try again", "receipt");
  return { key, contentType: file.type };
}

async function checkReceipt(ctx: RequestContext, key: string | null) {
  if (!key) return;
  if (!key.startsWith(receiptPrefix(ctx)) || key.includes(".."))
    throw new ServiceError("Upload the receipt again", "receipt");
  if (!(await ctx.env.FILES.head(key))) throw new ServiceError("Upload the receipt again", "receipt");
}

// ---------- Lists ----------

export interface ExpenseFilters {
  category?: ExpenseCategory | null;
  projectId?: string | null;
  from?: string | null;
  to?: string | null;
  query?: string | null;
  /** Only billable expenses not yet on a live invoice. */
  unbilled?: boolean;
}

function expenseWhere(ctx: Ctx, f: ExpenseFilters) {
  const e = schema.expense;
  const pattern = f.query?.trim() ? likeTerm(f.query.trim().toLowerCase()) : null;
  return and(
    eq(e.businessId, ctx.user.businessId),
    isNull(e.deletedAt),
    f.category ? eq(e.category, f.category) : undefined,
    f.projectId ? eq(e.projectId, f.projectId) : undefined,
    f.from ? gte(e.date, f.from) : undefined,
    f.to ? lte(e.date, f.to) : undefined,
    f.unbilled ? and(eq(e.billable, true), sql`${billedSql} = 0`) : undefined,
    pattern
      ? or(
          sql`lower(${e.supplier}) LIKE ${pattern} ESCAPE '\\'`,
          sql`lower(coalesce(${e.note}, '')) LIKE ${pattern} ESCAPE '\\'`,
        )
      : undefined,
  );
}

export async function listExpenses(ctx: Ctx, opts: ExpenseFilters & { limit?: number } = {}) {
  const e = schema.expense;
  const limit = Math.min(Math.max(opts.limit ?? EXPENSE_PAGE_SIZE, 1), 2000);
  const rows = await ctx.db
    .select({
      id: e.id,
      date: e.date,
      supplier: e.supplier,
      category: e.category,
      amountCents: e.amountCents,
      vatCents: e.vatCents,
      billable: e.billable,
      receiptKey: e.receiptKey,
      note: e.note,
      projectId: e.projectId,
      projectName: schema.project.name,
      clientName: schema.client.displayName,
      billedInvoiceId: e.billedInvoiceId,
      billedInvoiceLineId: e.billedInvoiceLineId,
      billedInvoiceNumber: schema.invoice.number,
      billed: billedSql,
      createdAt: e.createdAt,
    })
    .from(e)
    .leftJoin(schema.project, eq(schema.project.id, e.projectId))
    .leftJoin(schema.client, eq(schema.client.id, schema.project.clientId))
    .leftJoin(schema.invoice, eq(schema.invoice.id, e.billedInvoiceId))
    .where(expenseWhere(ctx, opts))
    .orderBy(desc(e.date), desc(e.createdAt))
    .limit(limit + 1);
  return {
    expenses: rows.slice(0, limit).map((r) => ({ ...r, billed: r.billed === 1 })),
    hasMore: rows.length > limit,
  };
}

export type ExpenseRow = Awaited<ReturnType<typeof listExpenses>>["expenses"][number];

/** Header band: what was spent (net of VAT) this month and in the filtered view. */
export async function expenseSummary(ctx: Ctx, filters: ExpenseFilters = {}) {
  const e = schema.expense;
  const monthStart = `${businessToday().slice(0, 8)}01`;
  const [row] = await ctx.db
    .select({
      count: sql<number>`count(*)`,
      netCents: sql<number>`coalesce(sum(${e.amountCents} - ${e.vatCents}), 0)`,
      monthNetCents: sql<number>`coalesce(sum(case when ${e.date} >= ${monthStart} then ${e.amountCents} - ${e.vatCents} else 0 end), 0)`,
    })
    .from(e)
    .where(expenseWhere(ctx, filters));
  return { count: row?.count ?? 0, netCents: row?.netCents ?? 0, monthNetCents: row?.monthNetCents ?? 0 };
}

/** Active projects for the expense form's project picker. */
export async function expenseProjects(ctx: Ctx) {
  return ctx.db
    .select({
      id: schema.project.id,
      name: schema.project.name,
      clientName: schema.client.displayName,
    })
    .from(schema.project)
    .innerJoin(schema.client, eq(schema.client.id, schema.project.clientId))
    .where(and(eq(schema.project.businessId, ctx.user.businessId), eq(schema.project.status, "active")))
    .orderBy(schema.project.name);
}

// ---------- Create, edit, delete ----------

async function requireProject(ctx: Ctx, projectId: string | null) {
  if (!projectId) return null;
  const [project] = await ctx.db
    .select()
    .from(schema.project)
    .where(and(eq(schema.project.id, projectId), eq(schema.project.businessId, ctx.user.businessId)));
  if (!project) throw new ServiceError("That project no longer exists", "projectId");
  return project;
}

async function requireExpense(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select({ expense: schema.expense, billed: billedSql })
    .from(schema.expense)
    .where(
      and(
        eq(schema.expense.id, id),
        eq(schema.expense.businessId, ctx.user.businessId),
        isNull(schema.expense.deletedAt),
      ),
    );
  if (!row) throw new ServiceError("That expense no longer exists");
  return { ...row.expense, billed: row.billed === 1 };
}

export async function createExpense(ctx: RequestContext, input: ExpenseInput) {
  await requireProject(ctx, input.projectId);
  await checkReceipt(ctx, input.receiptKey);
  const id = newId("exp");
  await ctx.db.batch([
    ctx.db.insert(schema.expense).values({
      id,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      ...input,
    }),
    audit(ctx, id, "expense.created", {
      amountCents: input.amountCents,
      supplier: input.supplier,
      projectId: input.projectId ?? undefined,
    }),
  ]);
  return id;
}

export async function updateExpense(ctx: RequestContext, id: string, input: ExpenseInput) {
  const current = await requireExpense(ctx, id);
  await requireProject(ctx, input.projectId);
  if (current.billed) {
    const moneyChanged =
      current.amountCents !== input.amountCents ||
      current.vatCents !== input.vatCents ||
      current.projectId !== input.projectId ||
      !input.billable;
    if (moneyChanged)
      throw new ServiceError(
        "This expense is on an invoice. Remove its line from the invoice first, then change the amount or project.",
      );
  }
  if (input.receiptKey !== current.receiptKey) await checkReceipt(ctx, input.receiptKey);
  await ctx.db.batch([
    ctx.db
      .update(schema.expense)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(schema.expense.id, id)),
    audit(ctx, id, "expense.updated"),
  ]);
  if (current.receiptKey && current.receiptKey !== input.receiptKey)
    await ctx.env.FILES.delete(current.receiptKey);
}

/** Soft delete; the receipt stays in storage for the records (SPEC 11.4). */
export async function deleteExpense(ctx: RequestContext, id: string) {
  const current = await requireExpense(ctx, id);
  if (current.billed)
    throw new ServiceError("This expense is on an invoice. Remove its line from the invoice first.");
  await ctx.db.batch([
    ctx.db
      .update(schema.expense)
      .set({ deletedAt: nowIso(), updatedAt: nowIso() })
      .where(eq(schema.expense.id, id)),
    audit(ctx, id, "expense.deleted", { supplier: current.supplier, amountCents: current.amountCents }),
  ]);
}

// ---------- Billing (FR-EXP-02) ----------

/** The project's draft invoice to add to, or a new one for the project's client. */
async function draftInvoiceFor(ctx: RequestContext, project: typeof schema.project.$inferSelect) {
  const [draft] = await ctx.db
    .select({ id: schema.invoice.id })
    .from(schema.invoice)
    .where(
      and(
        eq(schema.invoice.businessId, ctx.user.businessId),
        eq(schema.invoice.projectId, project.id),
        eq(schema.invoice.status, "draft"),
        eq(schema.invoice.kind, "standard"),
        isNull(schema.invoice.reissueOfId),
      ),
    )
    .orderBy(desc(schema.invoice.updatedAt))
    .limit(1);
  return draft?.id ?? (await createInvoice(ctx, { clientId: project.clientId, projectId: project.id }));
}

/**
 * Adds billable expenses of one project to its draft invoice as editable
 * lines at cost (amount less VAT) plus the markup, in an "Expenses" section.
 * Returns the invoice id so the screen can open it.
 */
export async function billExpenses(ctx: RequestContext, input: BillExpensesInput) {
  const e = schema.expense;
  const rows = await ctx.db
    .select({ expense: e, billed: billedSql })
    .from(e)
    .where(and(eq(e.businessId, ctx.user.businessId), inArray(e.id, input.expenseIds), isNull(e.deletedAt)));
  if (rows.length !== input.expenseIds.length)
    throw new ServiceError("Some of those expenses no longer exist");
  if (rows.some((r) => r.billed === 1))
    throw new ServiceError("Some of those expenses are already on an invoice");
  if (rows.some((r) => !r.expense.billable)) throw new ServiceError("Only billable expenses can be invoiced");
  const projectIds = new Set(rows.map((r) => r.expense.projectId));
  if (projectIds.size !== 1 || !rows[0]!.expense.projectId)
    throw new ServiceError("Bill one project's expenses at a time");
  const project = (await requireProject(ctx, rows[0]!.expense.projectId))!;

  const invoiceId = await draftInvoiceFor(ctx, project);
  const [invoice] = await ctx.db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!invoice?.draftContent) throw new ServiceError("That invoice can't take new lines");

  const lines = rows
    .map((r) => r.expense)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => ({
      expenseId: x.id,
      line: {
        id: crypto.randomUUID(),
        itemType: "fee" as const,
        description: `${x.supplier} (${categoryOf(x.category).label.toLowerCase()}, ${formatDate(x.date)})`,
        qtyMilli: 1000,
        unit: "each",
        unitPriceCents: rechargeCents(expenseNetCents(x), input.markupBp),
        taxRateIds: [],
      },
    }));
  const content: DocumentContent = structuredClone(invoice.draftContent);
  // Fill an empty first section (a brand-new draft) rather than leaving it blank.
  const blank = content.sections.length === 1 && content.sections[0]!.lines.length === 0;
  let section = content.sections.find((s) => s.title === "Expenses");
  if (!section && blank) {
    section = content.sections[0]!;
    section.title = "Expenses";
  }
  if (!section) {
    section = { id: crypto.randomUUID(), title: "Expenses", lines: [] };
    content.sections.push(section);
  }
  section.lines.push(...lines.map((l) => l.line));
  const totals = computeContent(content);
  const now = nowIso();

  await ctx.db.batch([
    ctx.db
      .update(schema.invoice)
      .set({
        draftContent: content,
        draftTotalCents: totals.computed.totalCents,
        draftVersion: sql`${schema.invoice.draftVersion} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.invoice.id, invoiceId),
          eq(schema.invoice.status, "draft"),
          eq(schema.invoice.draftVersion, invoice.draftVersion),
        ),
      ),
    // Fails the batch (NOT NULL) if the draft changed under us.
    ctx.db
      .update(schema.invoice)
      .set({ draftVersion: sql`case when changes() = 1 then ${schema.invoice.draftVersion} else null end` })
      .where(eq(schema.invoice.id, invoiceId)),
    ...lines.map(({ expenseId, line }) =>
      ctx.db
        .update(e)
        .set({ billedInvoiceId: invoiceId, billedInvoiceLineId: line.id, updatedAt: now })
        .where(eq(e.id, expenseId)),
    ),
    activityInsert(ctx.db, {
      businessId: ctx.user.businessId,
      actor: { type: "user", id: ctx.user.id },
      entityType: "invoice",
      entityId: invoiceId,
      action: "invoice.expenses_added",
      data: { count: lines.length, markupBp: input.markupBp },
    }),
    ...lines.map(({ expenseId }) => audit(ctx, expenseId, "expense.billed", { invoiceId })),
  ] as Batch);
  return invoiceId;
}

/** Invoice builder: which lines came from which expense ("From expense", FR-EXP-02). */
export async function expensesOnInvoice(ctx: Ctx, invoiceId: string) {
  return ctx.db
    .select({
      id: schema.expense.id,
      lineId: schema.expense.billedInvoiceLineId,
      supplier: schema.expense.supplier,
      date: schema.expense.date,
    })
    .from(schema.expense)
    .where(
      and(eq(schema.expense.businessId, ctx.user.businessId), eq(schema.expense.billedInvoiceId, invoiceId)),
    );
}
