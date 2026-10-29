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

  // Daily reminders and the weekly digest (SPEC 5.9). Loaded on demand, like
  // the queue consumer. Each run is idempotent (job_run + email keys).
  async scheduled(controller, env, ctx) {
    const { CRON_JOBS, runDailyJob, runWeeklyDigest } = await import("~/features/automation/service");
    const job = CRON_JOBS[controller.cron];
    if (!job) {
      console.warn(`cron ${controller.cron}: no job`);
      return;
    }
    const now = new Date(controller.scheduledTime);
    const run = job === "daily" ? runDailyJob(env, now) : runWeeklyDigest(env, now);
    ctx.waitUntil(run.then((result) => console.log(`cron ${job}`, JSON.stringify(result))));
    await run;
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
