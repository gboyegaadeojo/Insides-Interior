import * as React from "react";
import { Form, useActionData, useBlocker, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { toast } from "~/components/ui/toast";
import type { ActionResult } from "~/lib/form";

/** Field errors for one intent from the last action. */
export function useIntentErrors(intent: string) {
  const result = useActionData<ActionResult>();
  return result && !result.ok && result.intent === intent ? result.errors : {};
}

/**
 * A settings card holding one form: tracks unsaved changes and warns before
 * leaving (FR-SET-11), disables Save while saving (DS-TCH-08), shows the
 * result as a toast and form-level errors inline.
 */
export function SettingsForm({
  intent,
  title,
  description,
  children,
  submitLabel = "Save",
  encType,
}: {
  intent: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  submitLabel?: string;
  encType?: "multipart/form-data";
}) {
  const navigation = useNavigation();
  const result = useActionData<ActionResult>();
  // The action result current when the form was last edited. A newer successful
  // save for this form means it's clean again.
  const [editedAt, setEditedAt] = React.useState<ActionResult | undefined | null>(null);
  const savedSinceEdit = result !== editedAt && result?.ok === true && result.intent === intent;
  const dirty = editedAt !== null && !savedSinceEdit;
  const saving = navigation.state === "submitting" && navigation.formData?.get("intent") === intent;
  const errors = useIntentErrors(intent);
  const lastResult = React.useRef<ActionResult | undefined>(undefined);

  React.useEffect(() => {
    if (!result || result === lastResult.current || result.intent !== intent) return;
    lastResult.current = result;
    if (result.ok) toast(result.message, { tone: "success" });
    else if (result.errors.form) toast(result.errors.form, { tone: "error" });
  }, [result, intent]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <Form
        method="post"
        encType={encType}
        onChange={() => setEditedAt(result)}
        onInput={() => setEditedAt(result)}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="intent" value={intent} />
        {children}
        {errors.form && (
          <p role="alert" className="text-label font-semibold text-danger-ink">
            {errors.form}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          {dirty && !saving && <span className="text-label font-normal text-secondary">Unsaved changes</span>}
          <Button type="submit" loading={saving}>
            {submitLabel}
          </Button>
        </div>
      </Form>
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.state === "blocked" && blocker.reset()}
        title="Leave without saving?"
        description={`Your changes to ${title.toLowerCase()} haven't been saved.`}
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </Card>
  );
}
