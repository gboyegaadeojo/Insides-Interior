import { z } from "zod";

export const projectSchema = z.object({
  name: z.string().trim().min(1, "Name the project, e.g. Main floor drapery").max(120),
  clientId: z.string().min(1, "Choose a client"),
  siteId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
});

export const projectStatusSchema = z.object({
  status: z.enum(["active", "completed", "archived"]),
});
