import { SectionHeader } from "~/components/settings/section-header";
import { SettingsForm, useIntentErrors } from "~/components/settings/settings-form";
import { TextField } from "~/components/ui/field";
import { runIntent } from "~/features/settings/action";
import { reminderCadenceSchema } from "~/features/settings/schema";
import { loadSettings, updateReminderCadence } from "~/features/settings/service";
import { assertSameOrigin, requireOwner } from "~/server/session";
import type { Route } from "./+types/reminders";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireOwner(context.cloudflare.env, request);
  const { settings } = await loadSettings(ctx);
  return { cadence: settings.reminderCadence };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireOwner(context.cloudflare.env, request);
  const form = await request.formData();
  return runIntent(
    "cadence",
    reminderCadenceSchema,
    form,
    (input) => updateReminderCadence(ctx, input),
    "Reminder schedule saved",
  );
}

function describe(offset: number) {
  if (offset === 0) return "on the due date";
  return offset < 0
    ? `${-offset} day${offset === -1 ? "" : "s"} before`
    : `${offset} day${offset === 1 ? "" : "s"} after`;
}

export default function ReminderSettings({ loaderData }: Route.ComponentProps) {
  const { cadence } = loaderData;
  const errors = useIntentErrors("cadence");
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Reminders"
        description="Payment reminders and quote follow-ups are sent automatically at 8 a.m. Winnipeg time. Changes apply to future sends only."
      />
      <SettingsForm intent="cadence" title="Schedule">
        <TextField
          label="Payment reminders (days from the due date)"
          name="offsets"
          defaultValue={cadence.offsets.join(", ")}
          hint="Negative is before the due date, 0 is the due date. e.g. -3, 0, 7, 14"
          error={errors.offsets}
        />
        <p className="text-label font-normal text-secondary">
          Currently: {cadence.offsets.map(describe).join(", ")}.
        </p>
        <div className="grid gap-4 tablet:grid-cols-3">
          <TextField
            label="Maximum reminders per invoice"
            name="maxCount"
            inputMode="numeric"
            defaultValue={cadence.maxCount}
            error={errors.maxCount}
            className="tabular"
          />
          <TextField
            label="Quiet from (hour, 0–23)"
            name="quietStartHour"
            inputMode="numeric"
            defaultValue={cadence.quietStartHour}
            error={errors.quietStartHour}
            className="tabular"
          />
          <TextField
            label="Quiet until (hour, 0–23)"
            name="quietEndHour"
            inputMode="numeric"
            defaultValue={cadence.quietEndHour}
            error={errors.quietEndHour}
            className="tabular"
          />
        </div>
        <TextField
          label="Quote follow-ups (days after sending)"
          name="quoteFollowUpDays"
          defaultValue={cadence.quoteFollowUpDays.join(", ")}
          hint="Sent only while the quote hasn't been answered, e.g. 3, 7"
          error={errors.quoteFollowUpDays}
        />
      </SettingsForm>
    </div>
  );
}
