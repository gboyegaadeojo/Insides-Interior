import type { FieldErrors } from "~/lib/form";
import { TextField, Textarea } from "~/components/ui/field";
import type { Address } from "~/server/db";

export interface ClientFormValues {
  displayName?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: Address | null;
  notes?: string | null;
  tags?: string[];
}

/** Fields for the full client record (FR-CLI-02); used in the create and edit sheets. */
export function ClientFields({
  values = {},
  errors = {},
}: {
  values?: ClientFormValues;
  errors?: FieldErrors;
}) {
  const address = values.billingAddress ?? {};
  return (
    <div className="grid gap-4 tablet:grid-cols-2">
      <TextField
        label="Name"
        name="displayName"
        defaultValue={values.displayName ?? ""}
        required
        error={errors.displayName}
        fieldClassName="tablet:col-span-2"
      />
      <TextField
        label="Company"
        name="company"
        defaultValue={values.company ?? ""}
        error={errors.company}
        fieldClassName="tablet:col-span-2"
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="off"
        defaultValue={values.email ?? ""}
        error={errors.email}
      />
      <TextField
        label="Phone"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        defaultValue={values.phone ?? ""}
        error={errors.phone}
      />
      <TextField
        label="Billing address"
        name="line1"
        defaultValue={address.line1 ?? ""}
        fieldClassName="tablet:col-span-2"
      />
      <TextField
        label="Unit or suite"
        name="line2"
        defaultValue={address.line2 ?? ""}
        fieldClassName="tablet:col-span-2"
      />
      <TextField label="City" name="city" defaultValue={address.city ?? "Winnipeg"} />
      <TextField label="Province" name="province" defaultValue={address.province ?? "MB"} />
      <TextField
        label="Postal code"
        name="postalCode"
        defaultValue={address.postalCode ?? ""}
        error={errors.postalCode}
      />
      <TextField
        label="Tags"
        name="tags"
        defaultValue={(values.tags ?? []).join(", ")}
        hint="Comma separated, e.g. referral, repeat"
      />
      <Textarea
        label="Notes"
        name="notes"
        defaultValue={values.notes ?? ""}
        fieldClassName="tablet:col-span-2"
        hint="Only you and your team see these"
      />
    </div>
  );
}
