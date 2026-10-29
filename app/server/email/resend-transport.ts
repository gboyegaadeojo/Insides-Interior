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
          cc: message.cc?.length ? message.cc : undefined,
          bcc: message.bcc?.length ? message.bcc : undefined,
          attachments: message.attachments?.length ? message.attachments : undefined,
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo,
        }),
      });
      if (!response.ok) {
        // The body carries Resend's error name and message, never our API key.
        throw new EmailSendError(response.status, await response.text());
      }
      const { id } = (await response.json()) as { id: string };
      return { id, transport: "resend" };
    },
  };
}

/**
 * Resend refused the email. 4xx (other than 408 timeout and 429 rate limit) is
 * permanent: an unverified sending domain, a recipient the test sender may not
 * reach, a bad address. Retrying won't help, so the email is marked failed at
 * once with Resend's reason, and the owner sees it with Retry.
 */
export class EmailSendError extends Error {
  readonly permanent: boolean;
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Resend send failed (${status}): ${body}`);
    this.name = "EmailSendError";
    this.permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  }
}
