import { createDevTransport } from "./dev-transport";
import { createResendTransport } from "./resend-transport";
import type { EmailEnv, EmailMessage, EmailTransport, SendResult } from "./types";

export type { EmailEnv, EmailMessage, EmailTransport, SendResult } from "./types";

/**
 * The single way the app sends email. Uses Resend when RESEND_API_KEY is set,
 * otherwise the dev transport that logs to the terminal (docs/decisions.md).
 */
export function createEmailTransport(env: EmailEnv): EmailTransport {
  if (env.RESEND_API_KEY) {
    return createResendTransport({ apiKey: env.RESEND_API_KEY, defaultFrom: env.EMAIL_FROM });
  }
  return createDevTransport(console.log, { redactTokens: env.APP_ENV !== "development" });
}

export function sendEmail(env: EmailEnv, message: EmailMessage): Promise<SendResult> {
  return createEmailTransport(env).send(message);
}
