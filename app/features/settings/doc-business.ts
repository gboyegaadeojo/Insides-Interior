import { eq } from "drizzle-orm";
import type { DocBusiness } from "~/components/doc/document-renderer";
import { formatAddress } from "~/features/clients/service";
import { type Db, schema } from "~/server/db";

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
    gstNumber: b.gstNumber,
    pstNumber: b.pstNumber,
    brandColor: b.brandColor,
  };
}
