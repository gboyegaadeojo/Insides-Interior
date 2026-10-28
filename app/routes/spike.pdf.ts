import puppeteer, { type Browser } from "@cloudflare/puppeteer";
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
  let browser: Browser;
  let reused: boolean;
  try {
    ({ browser, reused } = await getBrowser(env.BROWSER));
  } catch (error) {
    // Workers Free limits how often a new browser can start; say so plainly.
    console.error("browser launch failed", error);
    return Response.json(
      { error: "Browser Rendering is busy or rate limited; retry in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
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
    await page.close();
  } finally {
    // Disconnect rather than close so the next render can reuse the warm browser.
    await browser.disconnect();
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
    return Response.json({ timings, reused, pages: pageCount, bytes: pdf.byteLength, fonts, r2Key });
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

// Reconnect to an idle browser session when there is one; otherwise start a new
// browser that stays alive for 10 minutes after the last disconnect.
async function getBrowser(endpoint: Env["BROWSER"]) {
  const idle = (await puppeteer.sessions(endpoint)).filter((s) => !s.connectionId);
  for (const session of idle) {
    try {
      return { browser: await puppeteer.connect(endpoint, session.sessionId), reused: true };
    } catch {
      // Session closed between listing and connecting; try the next one.
    }
  }
  return { browser: await puppeteer.launch(endpoint, { keep_alive: 600_000 }), reused: false };
}

function countPdfPages(pdf: Uint8Array) {
  const text = new TextDecoder("latin1").decode(pdf);
  return text.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
}
