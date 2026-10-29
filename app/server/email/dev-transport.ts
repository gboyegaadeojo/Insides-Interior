import { extractLinks } from "./links";
import type { EmailMessage, EmailTransport } from "./types";

/** Portal links carry a share token; never log one outside local development. */
export function redactPortalTokens(link: string) {
  return link.replace(/\/(q|i)\/[A-Za-z0-9_-]{43}/g, "/$1/[token hidden]");
}

/**
 * Development transport: nothing leaves the machine. Each email is printed to the
 * terminal running `npm run dev` with its recipients, subject and links, so a
 * magic link or portal link can be clicked straight from the log.
 */
export function createDevTransport(
  log: (line: string) => void = console.log,
  opts: { redactTokens?: boolean } = {},
): EmailTransport {
  let counter = 0;
  return {
    name: "dev",
    async send(message: EmailMessage) {
      const id = `dev-${Date.now()}-${++counter}`;
      const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
      const links = extractLinks(message.html, message.text).map((link) =>
        opts.redactTokens ? redactPortalTokens(link) : link,
      );
      log(
        [
          "",
          "──── email (dev transport, not sent) ────",
          `to:      ${to}`,
          ...(message.cc?.length ? [`cc:      ${message.cc.join(", ")}`] : []),
          `subject: ${message.subject}`,
          ...(message.attachments?.length
            ? [`attach:  ${message.attachments.map((a) => a.filename).join(", ")}`]
            : []),
          ...(links.length ? ["links:", ...links.map((link) => `  ${link}`)] : ["links:   (none)"]),
          "─────────────────────────────────────────",
        ].join("\n"),
      );
      return { id, transport: "dev" };
    },
  };
}
