import * as React from "react";
import { ConfirmDelete } from "~/components/ui/confirm-delete";
import { BrandPreview } from "~/components/doc/brand-preview";
import { SectionHeader } from "~/components/settings/section-header";
import { SettingsForm, useIntentErrors } from "~/components/settings/settings-form";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { TextField } from "~/components/ui/field";
import { SignaturePad } from "~/components/ui/signature-pad";
import { runIntent, runService } from "~/features/settings/action";
import { brandColorSchema, signatureSchema } from "~/features/settings/schema";
import { loadSettings, removeSignature, saveSignature, updateBrandColor } from "~/features/settings/service";
import { accessibleBrandColor, normaliseHex } from "~/lib/brand";
import { onColour } from "~/styles/tokens";
import { assertSameOrigin, requireOwner } from "~/server/session";
import type { Route } from "./+types/branding";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireOwner(context.cloudflare.env, request);
  const { business } = await loadSettings(ctx);
  return {
    brandColor: business.brandColor,
    businessName: business.tradingName || business.legalName,
    logoUrl: business.logoKey ? `/brand/logo?v=${encodeURIComponent(business.logoKey)}` : undefined,
    signature: business.signatureSvg
      ? { svg: business.signatureSvg, name: business.signatoryName, title: business.signatoryTitle }
      : null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireOwner(context.cloudflare.env, request);
  const form = await request.formData();
  if (form.get("intent") === "signature") {
    return runIntent(
      "signature",
      signatureSchema,
      form,
      (input) => saveSignature(ctx, input),
      "Signature saved; it's on every quote and invoice",
    );
  }
  if (form.get("intent") === "remove_signature") {
    return runService("remove_signature", () => removeSignature(ctx), "Signature removed");
  }
  return runIntent(
    "brand",
    brandColorSchema,
    form,
    (input) => updateBrandColor(ctx, input),
    "Brand colour saved",
  );
}

export default function BrandingSettings({ loaderData }: Route.ComponentProps) {
  const [value, setValue] = React.useState(loaderData.brandColor);
  const errors = useIntentErrors("brand");
  const hex = normaliseHex(value);
  const check = hex ? accessibleBrandColor(hex) : null;
  const preview = hex ?? loaderData.brandColor;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Branding"
        description="Your colour on quotes, invoices, the client portal and emails. The app itself keeps its studio palette."
      />
      <div className="grid gap-6 desktop:grid-cols-2">
        <SettingsForm intent="brand" title="Brand colour">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="brand-picker" className="text-label font-semibold">
                Pick
              </label>
              <input
                id="brand-picker"
                type="color"
                value={hex ?? "#000000"}
                onChange={(e) => setValue(e.target.value.toUpperCase())}
                className="h-11 w-16 cursor-pointer rounded-control border border-tertiary bg-surface p-1"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="brandColor" className="text-label font-semibold">
                Hex
              </label>
              <input
                id="brandColor"
                name="brandColor"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={Boolean(errors.brandColor) || (check ? !check.ok : true) || undefined}
                aria-describedby="brand-check"
                className="mt-1.5 block h-11 w-full rounded-control border border-tertiary bg-surface px-3.5 font-mono text-body uppercase"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
          <div id="brand-check" aria-live="polite" className="text-label">
            {!hex && <p className="font-semibold text-danger-ink">Enter a colour like #0F766E.</p>}
            {check?.ok && (
              <p className="font-normal text-sage-ink">
                Contrast on white {check.ratio.toFixed(2)}:1. Passes WCAG AA for text and buttons.
              </p>
            )}
            {check && !check.ok && (
              <div className="flex flex-col items-start gap-2">
                <p className="font-semibold text-danger-ink">
                  Contrast on white {check.ratio.toFixed(2)}:1 is below 4.5:1, so text in this colour would be
                  hard to read.
                </p>
                <Button type="button" variant="secondary" onClick={() => setValue(check.suggestion)}>
                  <span
                    className="size-5 rounded-full border border-border"
                    style={{ background: check.suggestion }}
                    aria-hidden
                  />
                  Use {check.suggestion}
                </Button>
              </div>
            )}
            {errors.brandColor && <p className="mt-1 font-semibold text-danger-ink">{errors.brandColor}</p>}
          </div>
        </SettingsForm>
        <div>
          <p className="mb-2 text-label font-semibold text-secondary">Preview</p>
          <BrandPreview
            brandColor={preview}
            onBrand={hex ? onColour(hex) : onColour(loaderData.brandColor as `#${string}`)}
            businessName={loaderData.businessName}
            logoUrl={loaderData.logoUrl}
          />
        </div>
      </div>
      <SignatureCard current={loaderData.signature} />
    </div>
  );
}

/**
 * The owner's permanent signature (owner request): drawn once with a finger,
 * Apple Pencil or mouse, printed with the name and title under "Authorised
 * signature" on every quote and invoice, in the portal and the PDF.
 */
function SignatureCard({
  current,
}: {
  current: { svg: string; name: string | null; title: string | null } | null;
}) {
  const errors = useIntentErrors("signature");
  return (
    <div className="grid gap-6 desktop:grid-cols-2">
      <SettingsForm
        intent="signature"
        title="Signature"
        description="Sign once; it's printed under “Authorised signature” on every quote and invoice."
        submitLabel={current ? "Replace signature" : "Save signature"}
      >
        <SignaturePad name="signature" label="Sign here" />
        {errors.signature && (
          <p role="alert" className="text-label font-semibold text-danger-ink">
            {errors.signature}
          </p>
        )}
        <div className="grid gap-4 tablet:grid-cols-2 [&>*]:min-w-0">
          <TextField
            label="Name under the signature"
            name="signatoryName"
            required
            autoComplete="name"
            defaultValue={current?.name ?? ""}
            error={errors.signatoryName}
          />
          <TextField
            label="Title (optional)"
            name="signatoryTitle"
            placeholder="e.g. Managing Director"
            defaultValue={current?.title ?? ""}
            error={errors.signatoryTitle}
          />
        </div>
      </SettingsForm>
      <Card>
        <CardHeader>
          <CardTitle>On your documents</CardTitle>
          <CardDescription>
            {current
              ? "This is what clients see."
              : "No signature yet; documents show none until you save one."}
          </CardDescription>
        </CardHeader>
        {current && (
          <div className="flex flex-col gap-4">
            <div className="max-w-xs rounded-control bg-surface p-3" data-testid="signature-preview">
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(current.svg)}`}
                alt={`Signature of ${current.name ?? "the owner"}`}
                className="bg-white h-20 w-full rounded-control object-contain object-left"
              />
              <p className="mt-1 border-t border-primary pt-1 text-micro font-semibold tracking-[0.12em] text-secondary uppercase">
                Authorised signature
              </p>
              {current.name && <p className="font-semibold">{current.name}</p>}
              {current.title && <p className="text-label text-secondary">{current.title}</p>}
            </div>
            <ConfirmDelete
              label="Remove signature"
              title="Remove your signature?"
              description="Quotes and invoices will go out without a signature until you sign again."
              confirmLabel="Remove signature"
              fields={{ intent: "remove_signature" }}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
