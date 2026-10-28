// Catalogue (SPEC 5.4): items and room templates. Inserting a template into a
// quote copies its items (phase 4), so later catalogue edits never change
// existing documents (FR-CAT-04).

import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { markupFromPrice } from "~/domain/pricing";
import { ServiceError } from "~/features/settings/service";
import { newId } from "~/lib/ids";
import { likeTerm } from "~/lib/like";
import { activityInsert } from "~/server/audit";
import { schema } from "~/server/db";
import { IMAGE_TYPES, PHOTO_MAX_BYTES } from "~/server/files";
import type { RequestContext } from "~/server/session";
import type { itemSchema, templateSchema } from "./schema";

type Ctx = Pick<RequestContext, "db" | "user">;
const nowIso = () => new Date().toISOString();

function audit(
  ctx: RequestContext,
  entityType: string,
  entityId: string,
  action: string,
  data?: Record<string, unknown>,
) {
  return activityInsert(ctx.db, {
    businessId: ctx.user.businessId,
    actor: { type: "user", id: ctx.user.id },
    entityType,
    entityId,
    action,
    data,
  });
}

/** Rows per page on the catalogue list; "Show more" asks for the next page. */
export const ITEM_PAGE_SIZE = 50;

/** Active catalogue items, for the Catalogue header. */
export async function countItems(ctx: Ctx) {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.item)
    .where(and(eq(schema.item.businessId, ctx.user.businessId), isNull(schema.item.archivedAt)));
  return row?.n ?? 0;
}

export async function listItems(
  ctx: Ctx,
  opts: { query?: string; type?: string; archived?: boolean; limit?: number } = {},
) {
  const i = schema.item;
  const conditions = [
    eq(i.businessId, ctx.user.businessId),
    opts.archived ? isNotNull(i.archivedAt) : isNull(i.archivedAt),
  ];
  if (opts.type) conditions.push(eq(i.type, opts.type as (typeof schema.ITEM_TYPE_VALUES)[number]));
  const query = opts.query?.trim().toLowerCase();
  if (query) {
    const term = likeTerm(query);
    conditions.push(
      or(
        sql`lower(${i.name}) LIKE ${term} ESCAPE '\\'`,
        sql`lower(coalesce(${i.description}, '')) LIKE ${term} ESCAPE '\\'`,
        sql`lower(coalesce(${i.supplier}, '')) LIKE ${term} ESCAPE '\\'`,
        sql`lower(coalesce(${i.sku}, '')) LIKE ${term} ESCAPE '\\'`,
      )!,
    );
  }
  return ctx.db
    .select()
    .from(i)
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${i.name})`))
    .limit(opts.limit ?? ITEM_PAGE_SIZE);
}

export type ItemRow = Awaited<ReturnType<typeof listItems>>[number];

async function requireItem(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.item)
    .where(and(eq(schema.item.id, id), eq(schema.item.businessId, ctx.user.businessId)));
  if (!row) throw new ServiceError("That item no longer exists");
  return row;
}

export async function getItem(ctx: Ctx, id: string) {
  return requireItem(ctx, id).catch(() => null);
}

/** Only tax rates that exist for this business are kept. */
async function validTaxIds(ctx: Ctx, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await ctx.db
    .select({ id: schema.taxRate.id })
    .from(schema.taxRate)
    .where(and(eq(schema.taxRate.businessId, ctx.user.businessId), inArray(schema.taxRate.id, ids)));
  const valid = new Set(rows.map((r) => r.id));
  return ids.filter((id) => valid.has(id));
}

function itemValues(input: z.output<typeof itemSchema>) {
  const { taxIds: _taxIds, ...rest } = input;
  return { ...rest, markupBp: input.costCents ? markupFromPrice(input.costCents, input.priceCents) : null };
}

export async function createItem(ctx: RequestContext, input: z.output<typeof itemSchema>) {
  const id = newId("itm");
  const defaultTaxIds = await validTaxIds(ctx, input.taxIds);
  await ctx.db.batch([
    ctx.db.insert(schema.item).values({
      id,
      businessId: ctx.user.businessId,
      createdBy: ctx.user.id,
      ...itemValues(input),
      defaultTaxIds,
    }),
    audit(ctx, "item", id, "item.created", { name: input.name }),
  ]);
  return id;
}

export async function updateItem(ctx: RequestContext, id: string, input: z.output<typeof itemSchema>) {
  await requireItem(ctx, id);
  const defaultTaxIds = await validTaxIds(ctx, input.taxIds);
  await ctx.db.batch([
    ctx.db
      .update(schema.item)
      .set({ ...itemValues(input), defaultTaxIds, updatedAt: nowIso() })
      .where(eq(schema.item.id, id)),
    audit(ctx, "item", id, "item.updated"),
  ]);
}

export async function setItemArchived(ctx: RequestContext, id: string, archived: boolean) {
  await requireItem(ctx, id);
  await ctx.db.batch([
    ctx.db
      .update(schema.item)
      .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
      .where(eq(schema.item.id, id)),
    audit(ctx, "item", id, archived ? "item.archived" : "item.restored"),
  ]);
}

/** FR-CAT-05: a product photo in private R2 storage. */
export async function saveItemPhoto(ctx: RequestContext, id: string, file: File) {
  const item = await requireItem(ctx, id);
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new ServiceError("Upload a JPEG, PNG, WebP or HEIC photo", "photo");
  if (file.size > PHOTO_MAX_BYTES) throw new ServiceError("The photo must be 10 MB or smaller", "photo");
  const key = `items/${id}/${newId("act").slice(4)}.${ext}`;
  await ctx.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await ctx.db.batch([
    ctx.db.update(schema.item).set({ photoKey: key, updatedAt: nowIso() }).where(eq(schema.item.id, id)),
    audit(ctx, "item", id, "item.photo_updated"),
  ]);
  if (item.photoKey) await ctx.env.FILES.delete(item.photoKey);
  return key;
}

export async function removeItemPhoto(ctx: RequestContext, id: string) {
  const item = await requireItem(ctx, id);
  if (!item.photoKey) return;
  await ctx.db.batch([
    ctx.db.update(schema.item).set({ photoKey: null, updatedAt: nowIso() }).where(eq(schema.item.id, id)),
    audit(ctx, "item", id, "item.photo_removed"),
  ]);
  await ctx.env.FILES.delete(item.photoKey);
}

// ---------- Room templates (FR-CAT-04) ----------

export async function listTemplates(ctx: Ctx) {
  const templates = await ctx.db
    .select()
    .from(schema.roomTemplate)
    .where(
      and(eq(schema.roomTemplate.businessId, ctx.user.businessId), isNull(schema.roomTemplate.archivedAt)),
    )
    .orderBy(asc(schema.roomTemplate.name));
  if (templates.length === 0) return [];
  const lines = await ctx.db
    .select({
      templateId: schema.roomTemplateLine.templateId,
      itemId: schema.roomTemplateLine.itemId,
      qtyMilli: schema.roomTemplateLine.qtyMilli,
      position: schema.roomTemplateLine.position,
      name: schema.item.name,
      type: schema.item.type,
      unit: schema.item.unit,
      priceCents: schema.item.priceCents,
    })
    .from(schema.roomTemplateLine)
    .innerJoin(schema.item, eq(schema.item.id, schema.roomTemplateLine.itemId))
    .where(
      inArray(
        schema.roomTemplateLine.templateId,
        templates.map((t) => t.id),
      ),
    )
    .orderBy(asc(schema.roomTemplateLine.position));
  return templates.map((t) => ({ ...t, lines: lines.filter((l) => l.templateId === t.id) }));
}

export type TemplateWithLines = Awaited<ReturnType<typeof listTemplates>>[number];

export async function saveTemplate(
  ctx: RequestContext,
  id: string | null,
  input: z.output<typeof templateSchema>,
) {
  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  if (itemIds.length > 0) {
    const found = await ctx.db
      .select({ id: schema.item.id })
      .from(schema.item)
      .where(and(eq(schema.item.businessId, ctx.user.businessId), inArray(schema.item.id, itemIds)));
    if (found.length !== itemIds.length)
      throw new ServiceError("One of those items no longer exists", "lines");
  }
  const templateId = id ?? newId("rtp");
  if (id) {
    const [existing] = await ctx.db
      .select()
      .from(schema.roomTemplate)
      .where(and(eq(schema.roomTemplate.id, id), eq(schema.roomTemplate.businessId, ctx.user.businessId)));
    if (!existing) throw new ServiceError("That template no longer exists");
  }
  const lineInserts = input.lines.map((line) =>
    ctx.db.insert(schema.roomTemplateLine).values({ id: newId("rtl"), templateId, ...line }),
  );
  await ctx.db.batch([
    id
      ? ctx.db
          .update(schema.roomTemplate)
          .set({ name: input.name, color: input.color, updatedAt: nowIso() })
          .where(eq(schema.roomTemplate.id, id))
      : ctx.db.insert(schema.roomTemplate).values({
          id: templateId,
          businessId: ctx.user.businessId,
          createdBy: ctx.user.id,
          name: input.name,
          color: input.color,
        }),
    ctx.db.delete(schema.roomTemplateLine).where(eq(schema.roomTemplateLine.templateId, templateId)),
    ...lineInserts,
    audit(ctx, "room_template", templateId, id ? "room_template.updated" : "room_template.created", {
      name: input.name,
    }),
  ]);
  return templateId;
}

export async function archiveTemplate(ctx: RequestContext, id: string) {
  await ctx.db.batch([
    ctx.db
      .update(schema.roomTemplate)
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where(and(eq(schema.roomTemplate.id, id), eq(schema.roomTemplate.businessId, ctx.user.businessId))),
    audit(ctx, "room_template", id, "room_template.archived"),
  ]);
}
