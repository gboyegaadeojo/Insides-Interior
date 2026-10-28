// Email templates (SPEC 9.4). Premium, on-brand HTML plus a plain-text part:
// logo or name, brand-colour rule, display serif headline, one 48px button
// (full width on phone), business address in the footer. Phase 5 moves these
// to React Email; the shape stays the same.

export interface Brand {
  name: string;
  brandColor: string;
  logoUrl?: string;
  address?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Text colour on the brand colour: white unless the brand is light. */
function onBrand(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1E1B18" : "#FFFFFF";
}

export function layout(
  brand: Brand,
  opts: {
    preheader: string;
    headline: string;
    body: string[];
    button: { label: string; url: string };
    footnote?: string;
  },
): { html: string; text: string } {
  const color = /^#[0-9a-f]{6}$/i.test(brand.brandColor) ? brand.brandColor : "#0F766E";
  const header = brand.logoUrl
    ? `<img src="${escape(brand.logoUrl)}" alt="${escape(brand.name)}" height="40" style="display:block;height:40px;border:0">`
    : `<span style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#1E1B18">${escape(brand.name)}</span>`;
  const html = `<!doctype html>
<html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(opts.headline)}</title></head>
<body style="margin:0;padding:0;background:#F8F6F2">
<span style="display:none;max-height:0;overflow:hidden">${escape(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F6F2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4DED5;border-radius:16px">
<tr><td style="padding:28px 28px 0">${header}</td></tr>
<tr><td style="padding:16px 28px 0"><div style="height:3px;background:${color};border-radius:2px"></div></td></tr>
<tr><td style="padding:24px 28px 0;font-family:Fraunces,Georgia,serif;font-size:28px;line-height:1.2;font-weight:600;color:#1E1B18">${escape(opts.headline)}</td></tr>
${opts.body.map((p) => `<tr><td style="padding:12px 28px 0;font-family:Inter,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.5;color:#3D3731">${escape(p)}</td></tr>`).join("\n")}
<tr><td style="padding:24px 28px 8px">
<a href="${escape(opts.button.url)}" style="display:block;text-align:center;background:${color};color:${onBrand(color)};font-family:Inter,-apple-system,'Segoe UI',sans-serif;font-size:16px;font-weight:600;line-height:48px;height:48px;border-radius:10px;text-decoration:none">${escape(opts.button.label)}</a>
</td></tr>
${opts.footnote ? `<tr><td style="padding:8px 28px 0;font-family:Inter,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.4;color:#5C554D">${escape(opts.footnote)}</td></tr>` : ""}
<tr><td style="padding:24px 28px 28px;font-family:Inter,-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.4;color:#5C554D">${escape(brand.name)}${brand.address ? ` · ${escape(brand.address)}` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    opts.headline,
    "",
    ...opts.body,
    "",
    `${opts.button.label}: ${opts.button.url}`,
    ...(opts.footnote ? ["", opts.footnote] : []),
    "",
    brand.name + (brand.address ? `, ${brand.address}` : ""),
  ].join("\n");
  return { html, text };
}

/** Sign-in link (SPEC 9.4). */
export function signInEmail(
  brand: Brand,
  url: string,
  opts: { invited?: boolean; name?: string } = {},
): RenderedEmail {
  const headline = opts.invited ? `You're invited to ${brand.name}` : `Sign in to ${brand.name}`;
  const greeting = opts.name ? `Hi ${opts.name.split(/\s+/)[0]},` : "Hi,";
  const { html, text } = layout(brand, {
    preheader: "Your sign-in link is inside. It works once and expires in 15 minutes.",
    headline,
    body: [
      greeting,
      opts.invited
        ? `You've been added to the ${brand.name} quotes and invoicing app. Tap the button to sign in.`
        : "Tap the button to sign in. The link works once and expires in 15 minutes.",
    ],
    button: { label: "Sign in", url },
    footnote: "If you didn't ask for this, you can ignore this email; nobody can sign in without the link.",
  });
  return { subject: headline, html, text };
}
