// The PDF of a quote's or invoice's current revision (SPEC 10.4): printed from
// the portal route, cached in R2 by revision, content hash, stamp and date.
// Reads only; the email job and the download routes use it.

import { eq } from "drizzle-orm";
import { pdfFileName } from "~/domain/numbering";
import { getDb, schema } from "~/server/db";
import { cachedPdf, pdfKey, PdfUnavailableError } from "~/server/pdf.server";
import { portalPath, type ShareEntity, shareToken } from "~/server/tokens";

export async function documentPdf(
  env: Env,
  entity: ShareEntity,
  id: string,
  opts: { revisionId?: string } = {},
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const row = entity === "quote" ? await quoteRow(env, id) : await invoiceRow(env, id);
  if (!row?.number || !row.salt) throw new PdfUnavailableError("This hasn't been sent yet", false);
  // A newer revision went out after this job was queued; its own email carries its PDF.
  if (opts.revisionId && opts.revisionId !== row.revisionId) return null;
  const token = await shareToken(env.BETTER_AUTH_SECRET, entity, id, row.salt);
  const bytes = await cachedPdf(
    env,
    // The date part keeps an extended quote or a changed due date from reusing an old file.
    pdfKey(entity, row.revisionId, `${row.contentHash}-${row.date ?? ""}`, row.stamp),
    new URL(`${portalPath(entity, token)}?print=1`, env.APP_URL).toString(),
  );
  return { bytes, filename: pdfFileName(row.number, row.revisionNo) };
}

async function quoteRow(env: Env, id: string) {
  const [row] = await getDb(env)
    .select({
      number: schema.quote.number,
      status: schema.quote.status,
      salt: schema.quote.shareTokenSalt,
      date: schema.quote.validUntil,
      revisionId: schema.quoteRevision.id,
      revisionNo: schema.quoteRevision.revisionNo,
      contentHash: schema.quoteRevision.contentHash,
    })
    .from(schema.quote)
    .innerJoin(schema.quoteRevision, eq(schema.quoteRevision.id, schema.quote.currentRevisionId))
    .where(eq(schema.quote.id, id));
  return row ? { ...row, stamp: row.status === "approved" ? "approved" : null } : null;
}

async function invoiceRow(env: Env, id: string) {
  const [row] = await getDb(env)
    .select({
      number: schema.invoice.number,
      status: schema.invoice.status,
      salt: schema.invoice.shareTokenSalt,
      date: schema.invoice.dueDate,
      revisionId: schema.invoiceRevision.id,
      revisionNo: schema.invoiceRevision.revisionNo,
      contentHash: schema.invoiceRevision.contentHash,
    })
    .from(schema.invoice)
    .innerJoin(schema.invoiceRevision, eq(schema.invoiceRevision.id, schema.invoice.currentRevisionId))
    .where(eq(schema.invoice.id, id));
  return row
    ? { ...row, stamp: row.status === "paid" ? "paid" : row.status === "void" ? "void" : null }
    : null;
}
