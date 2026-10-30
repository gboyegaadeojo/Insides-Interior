import { data } from "react-router";
import { clientOptions, clientSites, quickCreateClient, saveSite } from "~/features/clients/service";
import { quickClientSchema, siteSchema } from "~/features/clients/schema";
import { ServiceError } from "~/features/settings/service";
import { parseForm } from "~/lib/form";
import { assertSameOrigin, requireUser } from "~/server/session";
import { formatAddress } from "~/features/clients/service";
import type { Route } from "./+types/api.clients";

// Resource route behind the client Combobox: options, a client's sites, and
// inline create from any builder (FR-CLI-01).
export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const clientId = new URL(request.url).searchParams.get("sites");
  if (clientId) {
    const sites = await clientSites(ctx, clientId);
    return { sites: sites.map((s) => ({ id: s.id, label: s.label, address: formatAddress(s.address) })) };
  }
  const options = await clientOptions(ctx);
  return {
    options: options.map((c) => ({
      value: c.id,
      label: c.displayName,
      description: c.company ?? c.email ?? undefined,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  // A job address made from a builder (owner request): saved on the client, then chosen.
  if (form.get("intent") === "site") {
    const site = parseForm(siteSchema, form);
    if (!site.ok) return data({ ok: false as const, errors: site.errors }, { status: 400 });
    try {
      const id = await saveSite(ctx, String(form.get("clientId")), site.data);
      const { id: _id, label, ...address } = site.data;
      const clean = Object.fromEntries(Object.entries(address).filter(([, v]) => v)) as Record<
        string,
        string
      >;
      return { ok: true as const, site: { id, label, address: formatAddress(clean) } };
    } catch (error) {
      if (error instanceof ServiceError) {
        return data({ ok: false as const, errors: { [error.field]: error.message } }, { status: 400 });
      }
      throw error;
    }
  }
  const parsed = parseForm(quickClientSchema, form);
  if (!parsed.ok) return data({ ok: false as const, errors: parsed.errors }, { status: 400 });
  const id = await quickCreateClient(ctx, parsed.data);
  return { ok: true as const, client: { value: id, label: parsed.data.displayName } };
}
