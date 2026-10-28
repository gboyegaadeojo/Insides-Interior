import * as React from "react";
import { SectionHeader } from "~/components/settings/section-header";
import { SettingsForm, useIntentErrors } from "~/components/settings/settings-form";
import { TextField, Textarea } from "~/components/ui/field";
import { formatBp } from "~/domain/money";
import { formatDocumentNumber } from "~/domain/numbering";
import { runIntent } from "~/features/settings/action";
import {
  documentDefaultsSchema,
  numberingSchema,
  paymentInstructionsSchema,
} from "~/features/settings/schema";
import {
  loadSettings,
  updateDocumentDefaults,
  updateNumbering,
  updatePaymentInstructions,
} from "~/features/settings/service";
import { assertSameOrigin, requireOwner } from "~/server/session";
import type { Route } from "./+types/documents";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireOwner(context.cloudflare.env, request);
  const { settings, quoteSequence, invoiceSequence } = await loadSettings(ctx);
  return { settings, quoteSequence, invoiceSequence };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireOwner(context.cloudflare.env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  switch (intent) {
    case "numbering":
      return runIntent(
        intent,
        numberingSchema,
        form,
        (input) => updateNumbering(ctx, input),
        "Numbering saved",
      );
    case "defaults":
      return runIntent(
        intent,
        documentDefaultsSchema,
        form,
        (input) => updateDocumentDefaults(ctx, input),
        "Defaults saved",
      );
    case "payment":
      return runIntent(
        intent,
        paymentInstructionsSchema,
        form,
        (input) => updatePaymentInstructions(ctx, input),
        "Payment instructions saved",
      );
    default:
      throw new Response("Unknown action", { status: 400 });
  }
}

export default function DocumentSettings({ loaderData }: Route.ComponentProps) {
  const { settings, quoteSequence, invoiceSequence } = loaderData;
  const numberErrors = useIntentErrors("numbering");
  const defaultErrors = useIntentErrors("defaults");
  const paymentErrors = useIntentErrors("payment");
  const [quotePrefix, setQuotePrefix] = React.useState(quoteSequence.prefix);
  const [quoteNext, setQuoteNext] = React.useState(String(quoteSequence.nextValue));
  const [invoicePrefix, setInvoicePrefix] = React.useState(invoiceSequence.prefix);
  const [invoiceNext, setInvoiceNext] = React.useState(String(invoiceSequence.nextValue));
  const mailing = settings.mailingAddress ?? {};

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Documents" description="What new quotes and invoices start with." />

      <SettingsForm
        intent="numbering"
        title="Numbering"
        description="Separate sequences for quotes and invoices. Continue from your old numbers; the next number can only go up."
      >
        <div className="grid gap-4 tablet:grid-cols-2">
          <TextField
            label="Quote prefix"
            name="quotePrefix"
            value={quotePrefix}
            onChange={(e) => setQuotePrefix(e.target.value)}
            error={numberErrors.quotePrefix}
          />
          <TextField
            label="Next quote number"
            name="quoteNext"
            inputMode="numeric"
            value={quoteNext}
            onChange={(e) => setQuoteNext(e.target.value)}
            error={numberErrors.quoteNext}
            hint={`Currently ${quoteSequence.nextValue}`}
            className="tabular"
          />
          <TextField
            label="Invoice prefix"
            name="invoicePrefix"
            value={invoicePrefix}
            onChange={(e) => setInvoicePrefix(e.target.value)}
            error={numberErrors.invoicePrefix}
          />
          <TextField
            label="Next invoice number"
            name="invoiceNext"
            inputMode="numeric"
            value={invoiceNext}
            onChange={(e) => setInvoiceNext(e.target.value)}
            error={numberErrors.invoiceNext}
            hint={`Currently ${invoiceSequence.nextValue}`}
            className="tabular"
          />
        </div>
        <p className="rounded-control bg-surface-2 p-3" aria-live="polite">
          Next quote:{" "}
          <strong className="tabular">
            {formatDocumentNumber(quotePrefix, Number(quoteNext) || quoteSequence.nextValue)}
          </strong>
          {" · "}
          Next invoice:{" "}
          <strong className="tabular">
            {formatDocumentNumber(invoicePrefix, Number(invoiceNext) || invoiceSequence.nextValue)}
          </strong>
        </p>
      </SettingsForm>

      <SettingsForm
        intent="defaults"
        title="Defaults for new documents"
        description="Changing these never rewrites documents you've already made."
      >
        <div className="grid gap-4 tablet:grid-cols-3">
          <TextField
            label="Payment terms (days)"
            name="paymentTermsDays"
            inputMode="numeric"
            defaultValue={settings.paymentTermsDays}
            error={defaultErrors.paymentTermsDays}
            className="tabular"
          />
          <TextField
            label="Quotes valid for (days)"
            name="quoteValidDays"
            inputMode="numeric"
            defaultValue={settings.quoteValidDays}
            error={defaultErrors.quoteValidDays}
            className="tabular"
          />
          <TextField
            label="Deposit (%)"
            name="defaultDepositBp"
            inputMode="decimal"
            defaultValue={formatBp(settings.defaultDepositBp)}
            error={defaultErrors.defaultDepositBp}
            className="tabular"
          />
        </div>
        <Textarea
          label="Notes"
          name="defaultNotes"
          defaultValue={settings.defaultNotes ?? ""}
          hint="Shown above the totals, e.g. lead times"
          error={defaultErrors.defaultNotes}
        />
        <Textarea
          label="Terms and conditions"
          name="defaultTerms"
          defaultValue={settings.defaultTerms ?? ""}
          className="min-h-40"
          error={defaultErrors.defaultTerms}
        />
      </SettingsForm>

      <SettingsForm
        intent="payment"
        title="How clients pay"
        description="Shown on the invoice portal and PDF."
      >
        <div className="grid gap-4 tablet:grid-cols-2">
          <TextField
            label="Interac e-Transfer email"
            name="etransferEmail"
            type="email"
            defaultValue={settings.etransferEmail ?? ""}
            error={paymentErrors.etransferEmail}
          />
          <label className="flex min-h-11 items-center gap-3 self-end">
            <input
              type="checkbox"
              name="etransferAutoDeposit"
              defaultChecked={settings.etransferAutoDeposit}
              className="size-5 accent-[var(--teal-base)]"
            />
            <span>Autodeposit is on (no security question)</span>
          </label>
          <TextField
            label="e-Transfer note"
            name="etransferNote"
            defaultValue={settings.etransferNote ?? ""}
            hint="e.g. Put the invoice number in the message"
            fieldClassName="tablet:col-span-2"
          />
          <TextField
            label="Cheques payable to"
            name="chequePayee"
            defaultValue={settings.chequePayee ?? ""}
            fieldClassName="tablet:col-span-2"
          />
          <TextField
            label="Mailing address"
            name="mailingLine1"
            defaultValue={mailing.line1 ?? ""}
            fieldClassName="tablet:col-span-2"
          />
          <TextField label="City" name="mailingCity" defaultValue={mailing.city ?? ""} />
          <TextField label="Province" name="mailingProvince" defaultValue={mailing.province ?? ""} />
          <TextField label="Postal code" name="mailingPostalCode" defaultValue={mailing.postalCode ?? ""} />
        </div>
      </SettingsForm>
    </div>
  );
}
