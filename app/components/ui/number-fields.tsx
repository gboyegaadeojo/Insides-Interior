import * as React from "react";
import { formatCentsPlain, formatQuantity, parseMoneyToCents, parseQuantityToMilli } from "~/domain/money";
import { CURRENCY_SYMBOL } from "~/domain/locale";
import { cn } from "~/lib/utils";
import { cellClass, controlClass, Field, type FieldProps } from "./field";

// MoneyField and QuantityField hold integer values (cents, thousandths) and let
// people type freely; the text is parsed on blur and re-formatted en-NG
// (DS-TCH-01, SPEC 10.1). A value that doesn't parse shows an error and keeps
// what was typed (DS-TCH-06).

interface NumberFieldProps extends Pick<FieldProps, "label" | "hint" | "required" | "hideLabel"> {
  /** A ledger cell: no border or currency sign until focused (builder lines). */
  cell?: boolean;
  value: number | null;
  onValueChange: (value: number | null) => void;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  className?: string;
  /** Allow negative values (credits, adjustments). */
  allowNegative?: boolean;
}

function useParsedInput(
  value: number | null,
  onValueChange: (value: number | null) => void,
  parse: (input: string) => number | null,
  format: (value: number) => string,
  allowNegative: boolean,
  invalidMessage: string,
) {
  const [text, setText] = React.useState(value === null ? "" : format(value));
  const [localError, setLocalError] = React.useState<string>();
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setText(value === null ? "" : format(value));
  }, [value, format]);

  return {
    text,
    localError,
    onFocus() {
      focused.current = true;
    },
    onChange(event: React.ChangeEvent<HTMLInputElement>) {
      setText(event.target.value);
      setLocalError(undefined);
    },
    onBlur() {
      focused.current = false;
      if (text.trim() === "") {
        onValueChange(null);
        return;
      }
      const parsed = parse(text);
      if (parsed === null || (!allowNegative && parsed < 0)) {
        setLocalError(invalidMessage);
        return;
      }
      onValueChange(parsed);
      setText(format(parsed));
    },
  };
}

export function MoneyField({
  value,
  onValueChange,
  error,
  allowNegative = false,
  className,
  name,
  cell = false,
  ...rest
}: NumberFieldProps) {
  const input = useParsedInput(
    value,
    onValueChange,
    parseMoneyToCents,
    formatCentsPlain,
    allowNegative,
    "Enter an amount like 42.75",
  );
  return (
    <Field
      label={rest.label}
      hideLabel={rest.hideLabel}
      hint={rest.hint}
      required={rest.required}
      error={error ?? input.localError}
      className={cn(rest.hideLabel && "gap-0")}
    >
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          {!cell && (
            <span
              className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-secondary"
              aria-hidden
            >
              {CURRENCY_SYMBOL}
            </span>
          )}
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={rest.disabled}
            placeholder={rest.placeholder}
            required={rest.required}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={cn(
              cell ? cellClass : cn(controlClass, "h-11 pl-7 pointer-fine:h-10"),
              "text-right tabular",
              className,
            )}
            value={input.text}
            onFocus={input.onFocus}
            onChange={input.onChange}
            onBlur={input.onBlur}
          />
          {name && <input type="hidden" name={name} value={value ?? ""} />}
        </div>
      )}
    </Field>
  );
}

export function QuantityField({
  value,
  onValueChange,
  error,
  allowNegative = false,
  className,
  name,
  cell = false,
  ...rest
}: NumberFieldProps) {
  const input = useParsedInput(
    value,
    onValueChange,
    parseQuantityToMilli,
    formatQuantity,
    allowNegative,
    "Enter a quantity with up to 3 decimals, like 4.5",
  );
  return (
    <Field
      label={rest.label}
      hideLabel={rest.hideLabel}
      hint={rest.hint}
      required={rest.required}
      error={error ?? input.localError}
      className={cn(rest.hideLabel && "gap-0")}
    >
      {({ id, describedBy, invalid }) => (
        <>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={rest.disabled}
            placeholder={rest.placeholder}
            required={rest.required}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={cn(
              cell ? cellClass : cn(controlClass, "h-11 pointer-fine:h-10"),
              "text-right tabular",
              className,
            )}
            value={input.text}
            onFocus={input.onFocus}
            onChange={input.onChange}
            onBlur={input.onBlur}
          />
          {name && <input type="hidden" name={name} value={value ?? ""} />}
        </>
      )}
    </Field>
  );
}
