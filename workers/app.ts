import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

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

  // Placeholder until phase 5 (email and PDF work off the request path).
  async queue(batch) {
    for (const message of batch.messages) {
      console.log(`queue ${batch.queue}: no consumer for message ${message.id}`);
      message.ack();
    }
  },
} satisfies ExportedHandler<Env>;
