export interface Health {
  status: "ok" | "degraded";
  checks: { db: "ok" | "error" };
  time: string;
}

export async function checkHealth(env: Pick<Env, "DB">): Promise<Health> {
  let db: Health["checks"]["db"] = "ok";
  try {
    const row = await env.DB.prepare("select 1 as ok").first<{ ok: number }>();
    if (row?.ok !== 1) db = "error";
  } catch {
    db = "error";
  }
  return {
    status: db === "ok" ? "ok" : "degraded",
    checks: { db },
    time: new Date().toISOString(),
  };
}
