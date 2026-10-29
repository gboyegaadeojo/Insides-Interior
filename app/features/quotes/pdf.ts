// The PDF of a quote's current revision (SPEC 10.4): printed from the portal
// route, cached in R2. Reads only; the email job and both download routes use it.

import { eq } from "drizzle-orm";
import { pdfFileName } from "~/domain/numbering";
import { getDb, schema } from "~/server/db";
import { cachedPdf, pdfKey, PdfUnavailableError } from "~/server/pdf.server";
import { portalPath, shareToken } from "~/server/tokens";

export async function quotePdf(
  env: Env,
  quoteId: string,
  opts: { revisionId?: string } = {},
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const db = getDb(env);
  const [row] = await db
    .select({
      number: schema.quote.number,
      status: schema.quote.status,
      salt: schema.quote.shareTokenSalt,
      revisionId: schema.quoteRevision.id,
      revisionNo: schema.quoteRevision.revisionNo,
      contentHash: schema.quoteRevision.contentHash,
    })
    .from(schema.quote)
    .innerJoin(schema.quoteRevision, eq(schema.quoteRevision.id, schema.quote.currentRevisionId))
    .where(eq(schema.quote.id, quoteId));
  if (!row?.number || !row.salt) throw new PdfUnavailableError("This quote hasn't been sent yet", false);
  // A newer revision went out after this job was queued; its own email carries its PDF.
  if (opts.revisionId && opts.revisionId !== row.revisionId) return null;
  const token = await shareToken(env.BETTER_AUTH_SECRET, "quote", quoteId, row.salt);
  const stamp = row.status === "approved" ? "approved" : null;
  const bytes = await cachedPdf(
    env,
    pdfKey("quote", row.revisionId, row.contentHash, stamp),
    new URL(`${portalPath("quote", token)}?print=1`, env.APP_URL).toString(),
  );
  return { bytes, filename: pdfFileName(row.number, row.revisionNo) };
}
