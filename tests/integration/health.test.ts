import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { checkHealth } from "~/server/health";

describe("health", () => {
  it("reports ok when D1 answers", async () => {
    const health = await checkHealth(env);
    expect(health).toMatchObject({ status: "ok", checks: { db: "ok" } });
  });

  it("reports degraded when D1 fails", async () => {
    const broken = {
      DB: {
        prepare: () => {
          throw new Error("down");
        },
      },
    } as unknown as Pick<Env, "DB">;
    expect((await checkHealth(broken)).status).toBe("degraded");
  });
});

describe("bindings", () => {
  it("R2 files bucket round-trips an object", async () => {
    await env.FILES.put("pdf/test/1/abc.pdf", "hello");
    const object = await env.FILES.get("pdf/test/1/abc.pdf");
    expect(await object?.text()).toBe("hello");
  });
});
