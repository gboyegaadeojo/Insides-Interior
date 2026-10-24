export interface EmailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  /** Defaults to env.EMAIL_FROM. */
  from?: string;
  replyTo?: string;
  /** `<entity>:<revision>:<template>` so retries never double-send (SPEC 9.3). */
  idempotencyKey?: string;
}

export interface SendResult {
  /** Provider message id (Resend id), or a local id for the dev transport. */
  id: string;
  transport: EmailTransport["name"];
}

export interface EmailTransport {
  readonly name: "dev" | "resend";
  send(message: EmailMessage): Promise<SendResult>;
}

export interface EmailEnv {
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
}
