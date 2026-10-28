import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { SectionHeader } from "~/components/settings/section-header";
import { SettingsForm, useIntentErrors } from "~/components/settings/settings-form";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Select, TextField } from "~/components/ui/field";
import { runIntent, runService } from "~/features/settings/action";
import { taxRateSchema, taxRegistrationSchema } from "~/features/settings/schema";
import {
  loadSettings,
  saveTaxRate,
  setTaxRateArchived,
  updateTaxRegistrations,
} from "~/features/settings/service";
import { formatBp } from "~/domain/money";
import { cn } from "~/lib/utils";
import { assertSameOrigin, requireOwner } from "~/server/session";
import type { Route } from "./+types/tax";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireOwner(context.cloudflare.env, request);
  const { business, taxRates } = await loadSettings(ctx);
  return { business, taxRates };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireOwner(context.cloudflare.env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "registrations") {
    return runIntent(
      intent,
      taxRegistrationSchema,
      form,
      (input) => updateTaxRegistrations(ctx, input),
      "Tax numbers saved",
    );
  }
  if (intent.startsWith("rate:")) {
    return runIntent(intent, taxRateSchema, form, (input) => saveTaxRate(ctx, input), "Tax rate saved");
  }
  if (intent.startsWith("archive:") || intent.startsWith("restore:")) {
    const [verb, id] = intent.split(":") as [string, string];
    return runService(
      intent,
      () => setTaxRateArchived(ctx, id, verb === "archive"),
      verb === "archive" ? "Tax rate archived" : "Tax rate restored",
    );
  }
  throw new Response("Unknown action", { status: 400 });
}

const APPLIES = [
  { value: "both", label: "Services and products" },
  { value: "services", label: "Services only" },
  { value: "products", label: "Products only" },
];

export default function TaxSettings({ loaderData }: Route.ComponentProps) {
  const { business, taxRates } = loaderData;
  const regErrors = useIntentErrors("registrations");
  const active = taxRates.filter((r) => !r.archivedAt);
  const archived = taxRates.filter((r) => r.archivedAt);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Tax and currency"
        description="Amounts are in Nigerian naira (₦). Rate changes never alter documents you've already sent."
      />

      <SettingsForm
        intent="registrations"
        title="Registration numbers"
        description="Printed on quotes and invoices when set. If you charge VAT, add your TIN."
      >
        <div className="grid gap-4 tablet:grid-cols-2">
          <TextField
            label="TIN (Tax Identification Number)"
            name="tin"
            defaultValue={business.tin ?? ""}
            placeholder="e.g. 12345678-0001"
            error={regErrors.tin}
          />
          <TextField
            label="RC number (CAC registration)"
            name="rcNumber"
            defaultValue={business.rcNumber ?? ""}
            placeholder="e.g. RC 1234567"
            error={regErrors.rcNumber}
          />
        </div>
      </SettingsForm>

      <Card>
        <CardHeader>
          <CardTitle>Tax rates</CardTitle>
          <CardDescription>
            Defaults are added to new catalogue items and lines. Your accountant can confirm which apply.
          </CardDescription>
        </CardHeader>
        <ul className="flex flex-col gap-3">
          {active.map((rate) => (
            <li key={rate.id}>
              <RateForm rate={rate} />
            </li>
          ))}
          <li>
            <RateForm />
          </li>
        </ul>
        {archived.length > 0 && (
          <div className="mt-6">
            <h4 className="mb-2 text-label font-semibold text-secondary">Archived (kept on old documents)</h4>
            <ul className="flex flex-col gap-2">
              {archived.map((rate) => (
                <li
                  key={rate.id}
                  className="flex items-center justify-between gap-3 rounded-control bg-surface-2 px-3 py-2"
                >
                  <span>
                    {rate.name} <span className="text-secondary tabular">{formatBp(rate.rateBp)}%</span>
                  </span>
                  <Form method="post">
                    <input type="hidden" name="intent" value={`restore:${rate.id}`} />
                    <Button type="submit" variant="ghost">
                      <ArchiveRestore aria-hidden />
                      Restore
                    </Button>
                  </Form>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

function RateForm({ rate }: { rate?: Route.ComponentProps["loaderData"]["taxRates"][number] }) {
  const intent = `rate:${rate?.id ?? "new"}`;
  const errors = useIntentErrors(intent);
  const navigation = useNavigation();
  const saving = navigation.formData?.get("intent") === intent;
  const archiving = rate && navigation.formData?.get("intent") === `archive:${rate.id}`;

  return (
    <div className={cn("rounded-card border p-4", rate ? "border-border" : "border-dashed border-tertiary")}>
      <Form method="post" className="grid gap-3 tablet:grid-cols-[1fr_7rem_1fr] tablet:items-start">
        <input type="hidden" name="intent" value={intent} />
        {rate && <input type="hidden" name="id" value={rate.id} />}
        <TextField
          label="Name"
          name="name"
          defaultValue={rate?.name ?? ""}
          placeholder="e.g. VAT"
          error={errors.name}
          required
        />
        <TextField
          label="Rate (%)"
          name="rateBp"
          inputMode="decimal"
          defaultValue={rate ? formatBp(rate.rateBp) : ""}
          placeholder="5"
          error={errors.rateBp}
          required
          className="text-right tabular"
        />
        <Select label="Applies to" name="appliesTo" defaultValue={rate?.appliesTo ?? "both"}>
          {APPLIES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
        <label className="flex min-h-11 items-center gap-3 tablet:col-span-2">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={rate?.isDefault ?? true}
            className="size-5 accent-[var(--teal-base)]"
          />
          <span>Add to new items by default</span>
        </label>
        <div className="flex justify-end">
          <Button type="submit" variant={rate ? "secondary" : "primary"} loading={saving}>
            {!rate && !saving && <Plus aria-hidden />}
            {rate ? "Save" : "Add rate"}
          </Button>
        </div>
      </Form>
      {rate && (
        <Form method="post" className="mt-2 flex justify-end">
          <input type="hidden" name="intent" value={`archive:${rate.id}`} />
          <Button type="submit" variant="ghost" loading={archiving}>
            {!archiving && <Archive aria-hidden />}
            Archive {rate.name}
          </Button>
        </Form>
      )}
    </div>
  );
}
