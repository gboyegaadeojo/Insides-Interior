import puppeteer from "@cloudflare/puppeteer";
import type { Route } from "./+types/spike.pdf";

// Phase 0 PDF spike (SPEC 10.4): print /spike/pdf-sample with Browser Rendering,
// store the PDF in R2 and report timings. Locked behind the SPIKE_KEY secret so
// the public URL can't burn Browser Rendering minutes.
//
//   /spike/pdf?key=...              returns the PDF (timings in Server-Timing)
//   /spike/pdf?key=...&format=json  returns the timings as JSON

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const url = new URL(request.url);
  const key = (env as { SPIKE_KEY?: string }).SPIKE_KEY;
  if (!key || url.searchParams.get("key") !== key) {
    throw new Response("Not found", { status: 404 });
  }

  const started = Date.now();
  const browser = await puppeteer.launch(env.BROWSER);
  const launched = Date.now();
  let pdf: Uint8Array<ArrayBuffer>;
  let fonts: string[];
  let pageCount: number;
  let loaded: number;
  try {
    const page = await browser.newPage();
    // "load" covers the logo; fonts are awaited below. networkidle0 never settles
    // under `vite dev` because of the HMR socket.
    await page.goto(new URL("/spike/pdf-sample", url).toString(), { waitUntil: "load" });
    fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`);
    });
    loaded = Date.now();
    pdf = new Uint8Array(
      await page.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true }),
    );
    pageCount = countPdfPages(pdf);
  } finally {
    await browser.close();
  }
  const printed = Date.now();

  const digest = await crypto.subtle.digest("SHA-256", pdf);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const r2Key = `pdf/spike/1/${hash}.pdf`;
  await env.FILES.put(r2Key, pdf, { httpMetadata: { contentType: "application/pdf" } });
  const stored = Date.now();

  const timings = {
    launchMs: launched - started,
    loadMs: loaded - launched,
    printMs: printed - loaded,
    storeMs: stored - printed,
    totalMs: stored - started,
  };

  if (url.searchParams.get("format") === "json") {
    return Response.json({ timings, pages: pageCount, bytes: pdf.byteLength, fonts, r2Key });
  }
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Insides-Interior-Q-SPIKE-0001.pdf"',
      "Server-Timing": Object.entries(timings)
        .map(([name, ms]) => `${name};dur=${ms}`)
        .join(", "),
      "Cache-Control": "no-store",
    },
  });
}

function countPdfPages(pdf: Uint8Array) {
  const text = new TextDecoder("latin1").decode(pdf);
  return text.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
}
