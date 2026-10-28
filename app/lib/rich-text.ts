// Rich text for line descriptions: bold and bullets only (SPEC 7.1, Tiptap).
// Stored and rendered through an allow-list sanitiser (SPEC 11.1): every tag
// outside p, strong, ul, li, br is dropped, and allowed tags lose all
// attributes, so no script, style, link or event handler can survive.

const ALLOWED = new Set(["p", "strong", "b", "ul", "li", "br"]);

export function sanitizeRichText(html: string): string {
  const withoutDangerous = html
    // Remove whole elements whose content must never show as text.
    .replace(/<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const cleaned = withoutDangerous.replace(
    /<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*>/g,
    (_tag, slash: string, name: string) => {
      const tag = name.toLowerCase();
      if (!ALLOWED.has(tag)) return "";
      const normal = tag === "b" ? "strong" : tag;
      if (normal === "br") return slash ? "" : "<br>";
      return `<${slash}${normal}>`;
    },
  );
  // Any stray angle bracket left (malformed tags) is escaped.
  return cleaned.replace(/<(?!\/?(p|strong|ul|li|br)>)/g, "&lt;").trim();
}

/** Plain text for emails, search and screen-reader summaries. */
export function richTextToPlain(html: string): string {
  return sanitizeRichText(html)
    .replace(/<li>/g, "• ")
    .replace(/<\/(p|li)>/g, "\n")
    .replace(/<br>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isEmptyRichText(html: string | undefined | null): boolean {
  return !html || richTextToPlain(html) === "";
}
