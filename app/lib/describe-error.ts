/**
 * An error for the logs without bound values: Drizzle puts a failed query's
 * params (session and share tokens among them) in its message, and SPEC 11.1
 * says tokens are never logged. The driver's cause says why it failed.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const strip = (text: string) => text.replace(/\nparams:[^\n]*/g, "");
  const frames = (error.stack ?? "").split("\n").filter((line) => line.trimStart().startsWith("at "));
  const cause = error.cause instanceof Error ? `\ncause: ${strip(error.cause.message)}` : "";
  return [strip(error.message) + cause, ...frames].join("\n");
}
