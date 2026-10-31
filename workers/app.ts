import { createRequestHandler } from "react-router";
import { describeError } from "~/lib/describe-error";
import type { Job } from "~/features/email/service";
import { withBaselineHeaders } from "~/server/security-headers";

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
    const response = await requestHandler(request, { cloudflare: { env, ctx } });
    return withBaselineHeaders(response, new URL(request.url).protocol === "https:");
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
          await processEmailJob(env, job, {
            // The queue makes MAX_RETRIES attempts in all, then drops the message,
            // so the last one is attempts === MAX_RETRIES (was > : never true).
            lastAttempt: message.attempts >= MAX_RETRIES,
            attempt: message.attempts,
          });
        } else if (job?.kind === "notify") {
          // Push alerts and owner emails for new notifications (owner request).
          const { deliverNotifications } = await import("~/features/notifications/service");
          await deliverNotifications(env);
        }
        message.ack();
      } catch (error) {
        console.error(`job ${message.id} attempt ${message.attempts} failed`, describeError(error));
        message.retry({ delaySeconds: Math.min(30 * 2 ** (message.attempts - 1), 600) });
      }
    }
  },
} satisfies ExportedHandler<Env>;
