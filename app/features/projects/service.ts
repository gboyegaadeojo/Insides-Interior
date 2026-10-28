// Projects (SPEC 5.5): a job for one client and one site grouping quotes,
// invoices and expenses. Figures come from the project_financials view.

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { projectProgress } from "~/domain/pricing";
import { ServiceError } from "~/features/settings/service";
import { newId } from "~/lib/ids";
import { activityInsert } from "~/server/audit";
import { schema } from "~/server/db";
import { IMAGE_TYPES, PHOTO_MAX_BYTES } from "~/server/files";
import type { RequestContext } from "~/server/session";
import type { projectSchema } from "./schema";

type Ctx = Pick<RequestContext, "db" | "user">;
const nowIso = () => new Date().toISOString();

function audit(ctx: RequestContext, entityId: string, action: string, data?: Record<string, unknown>) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType: "project",
    entityId,
    action,
    data,
  });
}

function withProgress<
  T extends { contractCents: number; invoicedCents: number; paidCents: number; expensesCents: number },
>(row: T) {
  return { ...row, progress: projectProgress(row), marginCents: row.paidCents - row.expensesCents };
}

/** Rows per page on the project list; "Show more" asks for the next page. */
export const PROJECT_PAGE_SIZE = 50;

type ProjectStatusFilter = "active" | "completed" | "archived";

function projectFilter(ctx: Ctx, status?: ProjectStatusFilter) {
  const p = schema.project;
  return and(eq(p.businessId, ctx.user.businessId), status ? eq(p.status, status) : ne(p.status, "archived"));
}

/** Count, contract value and amount left to bill (as projectProgress) for the Projects header. */
export async function projectSummary(ctx: Ctx, opts: { status?: ProjectStatusFilter } = {}) {
  const f = schema.projectFinancials;
  const [row] = await ctx.db
    .select({
      count: sql<number>`count(*)`,
      contractCents: sql<number>`coalesce(sum(${f.contractCents}), 0)`,
      toBillCents: sql<number>`coalesce(sum(max(0, ${f.contractCents} - ${f.invoicedCents})), 0)`,
    })
    .from(schema.project)
    .innerJoin(f, eq(f.projectId, schema.project.id))
    .where(projectFilter(ctx, opts.status));
  return {
    count: row?.count ?? 0,
    contractCents: row?.contractCents ?? 0,
    toBillCents: row?.toBillCents ?? 0,
  };
}

export async function listProjects(ctx: Ctx, opts: { status?: ProjectStatusFilter; limit?: number } = {}) {
  const p = schema.project;
  const rows = await ctx.db
    .select({
      id: p.id,
      name: p.name,
      status: p.status,
      coverPhotoKey: p.coverPhotoKey,
      createdAt: p.createdAt,
      clientId: p.clientId,
      clientName: schema.client.displayName,
      siteLabel: schema.site.label,
      contractCents: schema.projectFinancials.contractCents,
      invoicedCents: schema.projectFinancials.invoicedCents,
      paidCents: schema.projectFinancials.paidCents,
      expensesCents: schema.projectFinancials.expensesCents,
    })
    .from(p)
    .innerJoin(schema.client, eq(schema.client.id, p.clientId))
    .innerJoin(schema.projectFinancials, eq(schema.projectFinancials.projectId, p.id))
    .leftJoin(schema.site, eq(schema.site.id, p.siteId))
    .where(projectFilter(ctx, opts.status))
    .orderBy(desc(p.createdAt))
    .limit(opts.limit ?? PROJECT_PAGE_SIZE);
  return rows.map(withProgress);
}

export type ProjectRow = Awaited<ReturnType<typeof listProjects>>[number];

export async function getProject(ctx: Ctx, id: string) {
  const p = schema.project;
  const [row] = await ctx.db
    .select({
      project: p,
      clientName: schema.client.displayName,
      site: schema.site,
      contractCents: schema.projectFinancials.contractCents,
      invoicedCents: schema.projectFinancials.invoicedCents,
      paidCents: schema.projectFinancials.paidCents,
      expensesCents: schema.projectFinancials.expensesCents,
    })
    .from(p)
    .innerJoin(schema.client, eq(schema.client.id, p.clientId))
    .innerJoin(schema.projectFinancials, eq(schema.projectFinancials.projectId, p.id))
    .leftJoin(schema.site, eq(schema.site.id, p.siteId))
    .where(and(eq(p.id, id), eq(p.businessId, ctx.user.businessId)));
  if (!row) return null;
  const quotes = await ctx.db
    .select({
      id: schema.quote.id,
      number: schema.quote.number,
      title: schema.quote.title,
      status: schema.quote.status,
    })
    .from(schema.quote)
    .where(eq(schema.quote.projectId, id))
    .orderBy(desc(schema.quote.createdAt));
  const invoices = await ctx.db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      kind: schema.invoice.kind,
      status: schema.invoice.status,
    })
    .from(schema.invoice)
    .where(eq(schema.invoice.projectId, id))
    .orderBy(desc(schema.invoice.createdAt));
  const activity = await ctx.db
    .select()
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.businessId, ctx.user.businessId),
        inArray(schema.activity.entityId, [id, ...quotes.map((q) => q.id), ...invoices.map((i) => i.id)]),
      ),
    )
    .orderBy(desc(schema.activity.at))
    .limit(30);
  return { ...withProgress(row), quotes, invoices, activity };
}

async function requireClientSite(ctx: Ctx, clientId: string, siteId: string | null) {
  const [client] = await ctx.db
    .select()
    .from(schema.client)
    .where(and(eq(schema.client.id, clientId), eq(schema.client.businessId, ctx.user.businessId)));
  if (!client) throw new ServiceError("Choose a client", "clientId");
  if (siteId) {
    const [site] = await ctx.db
      .select()
      .from(schema.site)
      .where(and(eq(schema.site.id, siteId), eq(schema.site.clientId, clientId)));
    if (!site) throw new ServiceError("That site belongs to another client", "siteId");
  }
}

export async function createProject(ctx: RequestContext, input: z.output<typeof projectSchema>) {
  await requireClientSite(ctx, input.clientId, input.siteId);
  const id = newId("prj");
  await ctx.db.batch([
    ctx.db
      .insert(schema.project)
      .values({ id, businessId: ctx.user.businessId, createdBy: ctx.user.id, ...input }),
    audit(ctx, id, "project.created", { name: input.name }),
  ]);
  return id;
}

async function requireProject(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.project)
    .where(and(eq(schema.project.id, id), eq(schema.project.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("That project no longer exists");
  return row;
}

export async function updateProject(ctx: RequestContext, id: string, input: z.output<typeof projectSchema>) {
  await requireProject(ctx, id);
  await requireClientSite(ctx, input.clientId, input.siteId);
  await ctx.db.batch([
    ctx.db
      .update(schema.project)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(schema.project.id, id)),
    audit(ctx, id, "project.updated"),
  ]);
}

export async function setProjectStatus(
  ctx: RequestContext,
  id: string,
  status: "active" | "completed" | "archived",
) {
  const project = await requireProject(ctx, id);
  if (project.status === status) return;
  await ctx.db.batch([
    ctx.db.update(schema.project).set({ status, updatedAt: nowIso() }).where(eq(schema.project.id, id)),
    audit(ctx, id, `project.${status}`),
  ]);
}

/** FR-PRJ-03: optional cover photo. */
export async function saveProjectCover(ctx: RequestContext, id: string, file: File) {
  const project = await requireProject(ctx, id);
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new ServiceError("Upload a JPEG, PNG, WebP or HEIC photo", "cover");
  if (file.size > PHOTO_MAX_BYTES) throw new ServiceError("The photo must be 10 MB or smaller", "cover");
  const key = `projects/${id}/${newId("act").slice(4)}.${ext}`;
  await ctx.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await ctx.db.batch([
    ctx.db
      .update(schema.project)
      .set({ coverPhotoKey: key, updatedAt: nowIso() })
      .where(eq(schema.project.id, id)),
    audit(ctx, id, "project.cover_updated"),
  ]);
  if (project.coverPhotoKey) await ctx.env.FILES.delete(project.coverPhotoKey);
}
