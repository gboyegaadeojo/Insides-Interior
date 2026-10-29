import { eq } from "drizzle-orm";
import type { DocBusiness } from "~/components/doc/document-renderer";
import { formatAddress } from "~/features/clients/service";
import { type Db, schema } from "~/server/db";

/**
 * The business as it appears in emails (SPEC 9.4): name, brand colour, logo as
 * an absolute URL (raster only; mail clients don't show SVG), address, and the
 * business email as Reply-To so clients reply to a person (SPEC 9.1).
 */
export async function loadEmailBrand(db: Db, env: Pick<Env, "APP_URL">, businessId: string) {
  const [b] = await db.select().from(schema.business).where(eq(schema.business.id, businessId));
  if (!b) throw new Error("Business not found");
  const raster = b.logoKey && !/\.svg$/i.test(b.logoKey);
  return {
    name: b.tradingName || b.legalName,
    brandColor: b.brandColor,
    logoUrl: raster
      ? new URL(`/brand/logo?v=${encodeURIComponent(b.logoKey!)}`, env.APP_URL).toString()
      : undefined,
    address: formatAddress(b.address) || undefined,
    replyTo: b.email ?? undefined,
  };
}

/** Business details as they appear on documents (FR-SET-01/02). */
export async function loadDocBusiness(db: Db, businessId: string): Promise<DocBusiness> {
  const [b] = await db.select().from(schema.business).where(eq(schema.business.id, businessId));
  if (!b) throw new Error("Business not found");
  return {
    name: b.tradingName || b.legalName,
    legalName: b.legalName,
    address: formatAddress(b.address),
    phone: b.phone,
    email: b.email,
    website: b.website,
    logoUrl: b.logoKey ? `/brand/logo?v=${encodeURIComponent(b.logoKey)}` : null,
    tin: b.tin,
    rcNumber: b.rcNumber,
    brandColor: b.brandColor,
  };
}
