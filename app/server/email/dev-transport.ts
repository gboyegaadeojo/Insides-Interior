import { extractLinks } from "./links";
import type { EmailMessage, EmailTransport } from "./types";

/**
 * Development transport: nothing leaves the machine. Each email is printed to the
 * terminal running `npm run dev` with its recipients, subject and links, so a
 * magic link or portal link can be clicked straight from the log.
 */
export function createDevTransport(log: (line: string) => void = console.log): EmailTransport {
  let counter = 0;
  return {
    name: "dev",
    async send(message: EmailMessage) {
      const id = `dev-${Date.now()}-${++counter}`;
      const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
      const links = extractLinks(message.html, message.text);
      log(
        [
          "",
          "──── email (dev transport, not sent) ────",
          `to:      ${to}`,
          `subject: ${message.subject}`,
          ...(links.length ? ["links:", ...links.map((link) => `  ${link}`)] : ["links:   (none)"]),
          "─────────────────────────────────────────",
        ].join("\n"),
      );
      return { id, transport: "dev" };
    },
  };
}
