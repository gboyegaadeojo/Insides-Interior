import type { z } from "zod";

export type FieldErrors = Record<string, string>;

export type FormResult<T> =
  { ok: true; data: T } | { ok: false; errors: FieldErrors; values: Record<string, string> };

/** Parses FormData with a Zod schema; errors keyed by field path for inline display (DS-TCH-06). */
export function parseForm<S extends z.ZodType>(schema: S, form: FormData): FormResult<z.output<S>> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    errors[key] ??= issue.message;
  }
  return { ok: false, errors, values };
}

/** Shape returned by settings actions and read by the forms. */
export type ActionResult =
  { ok: true; message: string; intent: string } | { ok: false; errors: FieldErrors; intent: string };
