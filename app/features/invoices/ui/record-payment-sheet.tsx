import { Banknote } from "lucide-react";
import * as React from "react";
import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { DateField, Select, TextField } from "~/components/ui/field";
import { MoneyField } from "~/components/ui/number-fields";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { suggestedWhtCents } from "~/domain/invoice";
import { formatBp, formatCents, parseMoneyToCents } from "~/domain/money";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, WHT_RATES } from "../constants";

/**
 * FR-PAY-01, 02, 06: record cash received, optionally with withholding tax the
 * client deducted. The amount starts at the balance; WHT is suggested on the
 * pre-VAT share and stays editable; an overpayment needs a tick to become
 * client credit. The server checks all of it again.
 */
export function RecordPaymentSheet({
  open,
  onOpenChange,
  number,
  totalCents,
  taxCents,
  balanceCents,
  today,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  number: string;
  totalCents: number;
  taxCents: number;
  balanceCents: number;
  today: string;
  error: { error: string | null; field: string | null } | null;
}) {
  const navigation = useNavigation();
  const saving = navigation.state !== "idle" && navigation.formData?.get("intent") === "record_payment";
  const formId = React.useId();
  const [cash, setCash] = React.useState<number | null>(balanceCents);
  const [cashTouched, setCashTouched] = React.useState(false);
  const [withheld, setWithheld] = React.useState(false);
  const [rate, setRate] = React.useState<string>(String(WHT_RATES[0]));
  const [otherRate, setOtherRate] = React.useState("");
  const [wht, setWht] = React.useState(0);

  const rateBp = rate === "other" ? (parseMoneyToCents(otherRate) ?? 0) : Number(rate);
  // A suggestion for settling the whole balance; the owner can change both numbers.
  function applySuggestion(nextRate: number) {
    const suggested = suggestedWhtCents({
      totalCents,
      taxCents,
      settleCents: balanceCents,
      rateBp: nextRate,
    });
    setWht(suggested);
    if (!cashTouched) setCash(balanceCents - suggested);
  }

  const whtCents = withheld ? wht : 0;
  const settling = (cash ?? 0) + whtCents;
  const excess = settling - balanceCents;
  const fieldError = (name: string) => (error?.field === name ? (error.error ?? undefined) : undefined);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Record a payment"
        description={`${number} · ${formatCents(balanceCents)} due`}
        footer={
          <div className="flex flex-col gap-2">
            <p className="text-label text-secondary" aria-live="polite">
              {excess > 0
                ? `${formatCents(excess)} more than the balance`
                : excess === 0
                  ? "This pays the invoice in full"
                  : `${formatCents(-excess)} will still be due`}
            </p>
            <Button type="submit" form={formId} size="lg" className="w-full" loading={saving}>
              <Banknote aria-hidden />
              Record {formatCents(settling)}
            </Button>
          </div>
        }
      >
        <Form method="post" id={formId} className="flex flex-col gap-5" preventScrollReset>
          <input type="hidden" name="intent" value="record_payment" />
          <input type="hidden" name="amountCents" value={cash ?? 0} />
          <input type="hidden" name="whtCents" value={whtCents} />
          {withheld && <input type="hidden" name="whtRateBp" value={rateBp} />}
          {error?.error && !error.field?.match(/^(amountCents|receivedOn|whtCents|allowCredit)$/) && (
            <p
              role="alert"
              className="rounded-card border border-danger-base bg-danger-tint p-3 font-semibold text-danger-ink"
            >
              {error.error}
            </p>
          )}
          <MoneyField
            label="Amount received"
            value={cash}
            onValueChange={(v) => {
              setCash(v);
              setCashTouched(true);
            }}
            error={fieldError("amountCents")}
            hint="What arrived in the account or in hand"
          />
          <div className="grid gap-4 tablet:grid-cols-2">
            <DateField
              label="Received on"
              name="receivedOn"
              defaultValue={today}
              max={today}
              required
              error={fieldError("receivedOn")}
            />
            <Select label="Method" name="method" defaultValue="bank">
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </div>
          <TextField
            label="Reference (optional)"
            name="reference"
            maxLength={80}
            hint="Transfer reference or receipt number"
          />

          <fieldset className="flex flex-col gap-3 rounded-card border border-border p-4">
            <legend className="px-1 text-label font-semibold">Withholding tax</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={withheld}
                onChange={(e) => {
                  setWithheld(e.target.checked);
                  if (e.target.checked) applySuggestion(rateBp);
                  else if (!cashTouched) setCash(balanceCents);
                }}
                className="size-6 shrink-0 accent-[var(--teal-base)]"
              />
              <span>
                <span className="font-semibold">The client deducted WHT</span>
                <span className="block text-label text-secondary">
                  It settles the invoice with the cash and is listed for your accountant
                </span>
              </span>
            </label>
            {withheld && (
              <>
                <SegmentedControl
                  label="WHT rate"
                  value={rate}
                  onValueChange={(next) => {
                    setRate(next);
                    if (next !== "other") applySuggestion(Number(next));
                  }}
                  segments={[
                    ...WHT_RATES.map((bp) => ({ value: String(bp), label: `${formatBp(bp)}%` })),
                    { value: "other", label: "Other" },
                  ]}
                />
                {rate === "other" && (
                  <TextField
                    label="Rate (%)"
                    inputMode="decimal"
                    value={otherRate}
                    onChange={(e) => setOtherRate(e.target.value)}
                    onBlur={() => applySuggestion(rateBp)}
                    fieldClassName="max-w-40"
                    className="text-right tabular"
                  />
                )}
                <MoneyField
                  label="WHT amount"
                  value={wht}
                  onValueChange={(v) => setWht(v ?? 0)}
                  error={fieldError("whtCents")}
                  hint="Worked on the amount before VAT; change it to match the credit note"
                />
                <TextField label="WHT receipt or credit note (optional)" name="whtReference" maxLength={80} />
              </>
            )}
          </fieldset>

          {excess > 0 && (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-saffron-base bg-saffron-tint p-3 text-saffron-ink">
              <input
                type="checkbox"
                name="allowCredit"
                className="mt-0.5 size-6 shrink-0 accent-[var(--teal-base)]"
              />
              <span>
                <span className="font-semibold">Keep the extra {formatCents(excess)} as client credit</span>
                <span className="block text-label">
                  It shows on the client and can go towards their next invoice.
                </span>
                {fieldError("allowCredit") && (
                  <span role="alert" className="mt-1 block text-label font-semibold">
                    {fieldError("allowCredit")}
                  </span>
                )}
              </span>
            </label>
          )}
          <TextField label="Note (optional)" name="note" maxLength={500} />
        </Form>
      </SheetContent>
    </Sheet>
  );
}
