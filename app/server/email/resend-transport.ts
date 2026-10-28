import type { EmailMessage, EmailTransport } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Resend REST transport (SPEC 9.3). Selected only when RESEND_API_KEY is set. */
export function createResendTransport(options: {
  apiKey: string;
  defaultFrom: string;
  fetch?: typeof fetch;
}): EmailTransport {
  const doFetch = options.fetch ?? fetch;
  return {
    name: "resend",
    async send(message: EmailMessage) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      };
      if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;

      const response = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: message.from ?? options.defaultFrom,
          to: Array.isArray(message.to) ? message.to : [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo,
        }),
      });
      if (!response.ok) {
        // The body carries Resend's error name and message, never our API key.
        throw new Error(`Resend send failed (${response.status}): ${await response.text()}`);
      }
      const { id } = (await response.json()) as { id: string };
      return { id, transport: "resend" };
    },
  };
}
