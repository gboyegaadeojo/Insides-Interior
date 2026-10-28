import { ImageUp, Trash2 } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { SectionHeader } from "~/components/settings/section-header";
import { SettingsForm, useIntentErrors } from "~/components/settings/settings-form";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { TextField } from "~/components/ui/field";
import { runIntent, runService } from "~/features/settings/action";
import { businessProfileSchema } from "~/features/settings/schema";
import {
  loadSettings,
  removeLogo,
  saveLogo,
  ServiceError,
  updateBusinessProfile,
} from "~/features/settings/service";
import { assertSameOrigin, requireOwner } from "~/server/session";
import type { Route } from "./+types/business";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireOwner(context.cloudflare.env, request);
  const { business } = await loadSettings(ctx);
  return { business };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireOwner(context.cloudflare.env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  switch (intent) {
    case "profile":
      return runIntent(
        intent,
        businessProfileSchema,
        form,
        (input) => updateBusinessProfile(ctx, input),
        "Business details saved",
      );
    case "logo":
      return runService(
        intent,
        async () => {
          const file = form.get("logo");
          if (!(file instanceof File) || file.size === 0)
            throw new ServiceError("Choose a PNG or SVG file", "logo");
          await saveLogo(ctx, file);
        },
        "Logo updated",
      );
    case "remove-logo":
      return runService(intent, () => removeLogo(ctx), "Logo removed");
    default:
      throw new Response("Unknown action", { status: 400 });
  }
}

export default function BusinessSettings({ loaderData }: Route.ComponentProps) {
  const { business } = loaderData;
  const errors = useIntentErrors("profile");
  const logoErrors = useIntentErrors("logo");
  const navigation = useNavigation();
  const uploading = navigation.formData?.get("intent") === "logo";
  const removing = navigation.formData?.get("intent") === "remove-logo";
  const address = business.address ?? {};

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Business" description="Appears on every quote, invoice, portal page and email." />

      <SettingsForm intent="profile" title="Business details">
        <div className="grid gap-4 tablet:grid-cols-2">
          <TextField
            label="Legal name"
            name="legalName"
            defaultValue={business.legalName}
            error={errors.legalName}
            required
          />
          <TextField
            label="Trading name"
            name="tradingName"
            defaultValue={business.tradingName ?? ""}
            error={errors.tradingName}
            hint="The name clients know you by"
          />
          <TextField
            label="Street address"
            name="line1"
            defaultValue={address.line1 ?? ""}
            autoComplete="address-line1"
            fieldClassName="tablet:col-span-2"
          />
          <TextField
            label="Unit or suite"
            name="line2"
            defaultValue={address.line2 ?? ""}
            autoComplete="address-line2"
            fieldClassName="tablet:col-span-2"
          />
          <TextField
            label="City"
            name="city"
            defaultValue={address.city ?? ""}
            autoComplete="address-level2"
          />
          <TextField
            label="Province"
            name="province"
            defaultValue={address.province ?? "MB"}
            autoComplete="address-level1"
          />
          <TextField
            label="Postal code"
            name="postalCode"
            defaultValue={address.postalCode ?? ""}
            autoComplete="postal-code"
            error={errors.postalCode}
          />
          <TextField
            label="Phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={business.phone ?? ""}
            autoComplete="tel"
            error={errors.phone}
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            defaultValue={business.email ?? ""}
            autoComplete="email"
            error={errors.email}
          />
          <TextField
            label="Website"
            name="website"
            type="url"
            inputMode="url"
            defaultValue={business.website ?? ""}
            error={errors.website}
          />
        </div>
      </SettingsForm>

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            PNG or SVG, up to 2 MB. A wide logo with a transparent background looks best.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-4 tablet:flex-row tablet:items-center">
          <div className="flex h-24 w-full items-center justify-center rounded-card border border-dashed border-border bg-surface-2 p-3 tablet:w-56">
            {business.logoKey ? (
              <img
                src={`/brand/logo?v=${encodeURIComponent(business.logoKey)}`}
                alt="Current logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-label font-normal text-secondary">No logo yet</span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <Form method="post" encType="multipart/form-data" className="flex flex-col gap-2">
              <input type="hidden" name="intent" value="logo" />
              <label htmlFor="logo" className="text-label font-semibold">
                Upload a new logo
              </label>
              <input
                id="logo"
                name="logo"
                type="file"
                accept="image/png,image/svg+xml"
                aria-invalid={Boolean(logoErrors.logo) || undefined}
                aria-describedby={logoErrors.logo ? "logo-error" : undefined}
                className="block w-full text-body file:mr-3 file:h-11 file:rounded-control file:border-0 file:bg-teal-tint file:px-4 file:font-semibold file:text-teal-ink"
              />
              {logoErrors.logo && (
                <p id="logo-error" role="alert" className="text-label font-semibold text-danger-ink">
                  {logoErrors.logo}
                </p>
              )}
              <p className="text-micro text-secondary">
                SVG logos should have their text converted to outlines so they print with the right font.
              </p>
              <div>
                <Button type="submit" variant="secondary" loading={uploading}>
                  {!uploading && <ImageUp aria-hidden />}
                  Upload
                </Button>
              </div>
            </Form>
            {business.logoKey && (
              <Form method="post">
                <input type="hidden" name="intent" value="remove-logo" />
                <Button type="submit" variant="ghost" loading={removing}>
                  {!removing && <Trash2 aria-hidden />}
                  Remove logo
                </Button>
              </Form>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
