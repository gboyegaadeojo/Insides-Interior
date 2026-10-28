import { RotateCcw } from "lucide-react";
import * as React from "react";
import { Form, useNavigation, useSearchParams } from "react-router";
import { SectionHeader } from "~/components/settings/section-header";
import { SettingsForm, useIntentErrors } from "~/components/settings/settings-form";
import { Button } from "~/components/ui/button";
import { Select, TextField, Textarea } from "~/components/ui/field";
import { runIntent, runService } from "~/features/settings/action";
import { emailTemplateSchema } from "~/features/settings/schema";
import { loadSettings, resetEmailTemplate, saveEmailTemplate } from "~/features/settings/service";
import {
  EMAIL_TEMPLATE_DEFAULTS,
  MERGE_FIELDS,
  renderMergeFields,
  unknownMergeFields,
} from "~/lib/merge-fields";
import { assertSameOrigin, requireOwner } from "~/server/session";
import type { Route } from "./+types/email";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireOwner(context.cloudflare.env, request);
  const { settings, business } = await loadSettings(ctx);
  return { overrides: settings.emailTemplates, businessName: business.tradingName || business.legalName };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireOwner(context.cloudflare.env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "template") {
    return runIntent(
      intent,
      emailTemplateSchema,
      form,
      (input) => saveEmailTemplate(ctx, input),
      "Email template saved",
    );
  }
  if (intent === "reset") {
    return runService(
      intent,
      () => resetEmailTemplate(ctx, String(form.get("template"))),
      "Template reset to the default",
    );
  }
  throw new Response("Unknown action", { status: 400 });
}

export default function EmailSettings({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const keys = Object.keys(EMAIL_TEMPLATE_DEFAULTS);
  const key = keys.includes(params.get("template") ?? "") ? params.get("template")! : keys[0]!;
  const defaults = EMAIL_TEMPLATE_DEFAULTS[key]!;
  const current = loaderData.overrides[key] ?? defaults;
  const customised = Boolean(loaderData.overrides[key]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Email"
        description="The wording of emails clients receive. Merge fields in braces are filled in for each email."
      />
      <Select
        label="Template"
        value={key}
        onChange={(e) => setParams({ template: e.target.value }, { replace: true })}
      >
        {keys.map((k) => (
          <option key={k} value={k}>
            {EMAIL_TEMPLATE_DEFAULTS[k]!.label}
            {loaderData.overrides[k] ? " (customised)" : ""}
          </option>
        ))}
      </Select>
      {/* Keyed so switching template resets the fields. */}
      <TemplateEditor
        key={`${key}:${current.subject}:${current.body}`}
        templateKey={key}
        initial={current}
        sample={{ ...defaults.sample, "business.name": loaderData.businessName }}
        customised={customised}
        label={defaults.label}
      />
    </div>
  );
}

function TemplateEditor({
  templateKey,
  initial,
  sample,
  customised,
  label,
}: {
  templateKey: string;
  initial: { subject: string; body: string };
  sample: Record<string, string | undefined>;
  customised: boolean;
  label: string;
}) {
  const [subject, setSubject] = React.useState(initial.subject);
  const [body, setBody] = React.useState(initial.body);
  const errors = useIntentErrors("template");
  const navigation = useNavigation();
  const resetting = navigation.formData?.get("intent") === "reset";
  const unknown = [...new Set([...unknownMergeFields(subject), ...unknownMergeFields(body)])];

  return (
    <div className="grid gap-6 desktop:grid-cols-2">
      <SettingsForm intent="template" title={label}>
        <input type="hidden" name="template" value={templateKey} />
        <TextField
          label="Subject"
          name="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          error={errors.subject}
        />
        <Textarea
          label="Message"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-48"
          error={errors.body}
        />
        <p className="text-micro text-secondary">
          Available: {MERGE_FIELDS.map((f) => `{${f}}`).join(" ")}. The button and your business details are
          added automatically.
        </p>
        {unknown.length > 0 && (
          <p role="alert" className="text-label font-semibold text-saffron-ink">
            Not recognised: {unknown.map((f) => `{${f}}`).join(", ")}. Check the spelling.
          </p>
        )}
      </SettingsForm>
      <div className="flex flex-col gap-3">
        <p className="text-label font-semibold text-secondary">Preview with sample details</p>
        <div className="rounded-card border border-border bg-surface p-5 shadow-card" aria-live="polite">
          <p className="text-label font-normal text-secondary">Subject</p>
          <p className="font-semibold">{renderMergeFields(subject, sample)}</p>
          <hr className="my-3 border-border" />
          <p className="whitespace-pre-line">{renderMergeFields(body, sample)}</p>
        </div>
        {customised && (
          <Form method="post">
            <input type="hidden" name="intent" value="reset" />
            <input type="hidden" name="template" value={templateKey} />
            <Button type="submit" variant="ghost" loading={resetting}>
              {!resetting && <RotateCcw aria-hidden />}
              Reset to the default wording
            </Button>
          </Form>
        )}
      </div>
    </div>
  );
}
