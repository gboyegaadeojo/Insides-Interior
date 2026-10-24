/** Every distinct http(s) link in an email's HTML (href) and text parts, in order. */
export function extractLinks(...parts: (string | undefined)[]): string[] {
  const links = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const match of part.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
      if (/^https?:\/\//i.test(match[1]!)) links.add(decodeEntities(match[1]!));
    }
    for (const match of part.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      links.add(decodeEntities(match[0]));
    }
  }
  return [...links];
}

function decodeEntities(url: string) {
  return url.replaceAll("&amp;", "&");
}
