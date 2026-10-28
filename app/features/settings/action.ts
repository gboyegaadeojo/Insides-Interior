import { data } from "react-router";
import type { z } from "zod";
import { type ActionResult, parseForm } from "~/lib/form";
import { ServiceError } from "./service";

/**
 * Validates one form intent with its schema, runs the service and maps the
 * outcome to an ActionResult (inline field errors or a success message).
 */
export async function runIntent<S extends z.ZodType>(
  intent: string,
  schema: S,
  form: FormData,
  run: (input: z.output<S>) => Promise<unknown>,
  message: string,
) {
  const parsed = parseForm(schema, form);
  if (!parsed.ok) return data<ActionResult>({ ok: false, errors: parsed.errors, intent }, { status: 400 });
  return runService(intent, () => run(parsed.data), message);
}

export async function runService(intent: string, run: () => Promise<unknown>, message: string) {
  try {
    await run();
    return data<ActionResult>({ ok: true, message, intent });
  } catch (error) {
    if (error instanceof ServiceError) {
      return data<ActionResult>(
        { ok: false, errors: { [error.field]: error.message }, intent },
        { status: 400 },
      );
    }
    throw error;
  }
}
