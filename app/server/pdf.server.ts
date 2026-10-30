// PDFs (SPEC 10.4): print the portal document route with Cloudflare Browser
// Rendering and cache the result in R2 under pdf/<entity>/<revision>/<hash>.pdf,
// so attachments and re-downloads reuse one file per revision. The phase 0
// spike's lessons apply: reuse warm browser sessions, load puppeteer on demand,
// and treat a busy or rate-limited browser as retryable (docs/decisions.md).

import type { Browser } from "@cloudflare/puppeteer";

export class PdfUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PdfUnavailableError";
  }
}

/**
 * Browser Rendering runs only on Cloudflare. Locally `page.pdf()` never returns
 * under workerd on Windows (PDF spike notes), so development and tests skip it.
 */
export function pdfEnabled(env: Pick<Env, "APP_ENV">) {
  // Production only: Browser Rendering's free allowance is per account, and the
  // preview Worker's test runs used it up, so live emails lost their PDFs.
  return env.APP_ENV === "production";
}

/** A stamp (Approved, Paid, Void) is part of the key: new stamp, new file. */
export function pdfKey(
  entity: "quote" | "invoice",
  revisionId: string,
  contentHash: string,
  stamp?: string | null,
) {
  return `pdf/${entity}/${revisionId}/${contentHash}${stamp ? `-${stamp}` : ""}.pdf`;
}

/** The cached PDF, or a fresh render stored for next time. */
export async function cachedPdf(
  env: Pick<Env, "APP_ENV" | "BROWSER" | "FILES">,
  key: string,
  url: string,
): Promise<Uint8Array> {
  const cached = await env.FILES.get(key);
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  if (!pdfEnabled(env)) {
    throw new PdfUnavailableError("PDFs are made on the deployed app, not in local development", false);
  }
  const pdf = await renderPdf(env.BROWSER, url);
  await env.FILES.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
  return pdf;
}

async function renderPdf(endpoint: Env["BROWSER"], url: string): Promise<Uint8Array> {
  let browser: Browser;
  try {
    browser = await getBrowser(endpoint);
  } catch (error) {
    console.error("browser launch failed", error);
    throw new PdfUnavailableError("The PDF service is busy; try again in a minute", true);
  }
  try {
    const page = await browser.newPage();
    const response = await page.goto(url, { waitUntil: "load" });
    if (!response?.ok()) {
      throw new PdfUnavailableError(`The document page answered ${response?.status() ?? "nothing"}`, true);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const pdf = new Uint8Array(
      await page.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true }),
    );
    await page.close();
    return pdf;
  } finally {
    // Close at once: idle browser time counts against the free daily allowance.
    await browser.close();
  }
}

// Reconnect to an idle browser session when there is one; otherwise start a new
// browser that stays alive for 10 minutes after the last disconnect.
async function getBrowser(endpoint: Env["BROWSER"]) {
  // Loaded on demand: puppeteer is large, and evaluating it on every cold start
  // pushed page requests over the Worker CPU limit (error 1102).
  const { default: puppeteer } = await import("@cloudflare/puppeteer");
  const idle = (await puppeteer.sessions(endpoint)).filter((s) => !s.connectionId);
  for (const session of idle) {
    try {
      return await puppeteer.connect(endpoint, session.sessionId);
    } catch {
      // Session closed between listing and connecting; try the next one.
    }
  }
  return puppeteer.launch(endpoint);
}

/** Base64 without spreading a large array onto the call stack. */
export function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
