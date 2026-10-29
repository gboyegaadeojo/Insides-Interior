import { createRequestHandler } from "react-router";
import type { Job } from "~/features/email/service";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

/** Matches `max_retries` on the queue consumer in wrangler.jsonc. */
const MAX_RETRIES = 5;

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },

  // Placeholder until phase 8 (daily and weekly jobs, SPEC 5.9).
  async scheduled(controller) {
    console.log(`cron ${controller.cron}: no jobs registered yet`);
  },

  // Email (with PDF attachments) off the request path (SPEC 9.3). Loaded on
  // demand so page requests never pay for it. A failed job is retried with
  // backoff; the last of max_retries (wrangler.jsonc) marks the email failed.
  async queue(batch, env) {
    const { processEmailJob } = await import("~/features/email/service");
    for (const message of batch.messages) {
      const job = message.body as Job;
      try {
        if (job?.kind === "email") {
          await processEmailJob(env, job, { lastAttempt: message.attempts > MAX_RETRIES });
        }
        message.ack();
      } catch (error) {
        console.error(
          `job ${message.id} attempt ${message.attempts} failed`,
          error instanceof Error ? error.message : error,
        );
        message.retry({ delaySeconds: Math.min(30 * 2 ** (message.attempts - 1), 600) });
      }
    }
  },
} satisfies ExportedHandler<Env>;
