import { PdfUnavailableError } from "./pdf.server";

/** The PDF as a download, or a plain explanation (503) when it can't be made right now. */
export async function pdfResponse(make: () => Promise<{ bytes: Uint8Array; filename: string } | null>) {
  try {
    const pdf = await make();
    if (!pdf) return new Response("Not found", { status: 404 });
    return new Response(pdf.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdf.filename}"`,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof PdfUnavailableError) {
      return new Response(error.message, {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...(error.retryable && { "Retry-After": "60" }),
        },
      });
    }
    throw error;
  }
}
