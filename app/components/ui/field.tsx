import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";

// Field wrapper and native inputs (refactored from legacy/src/components/ui/input.tsx).
// Labels always visible above the field, errors linked and announced (DS-TCH-06,
// DS-A11Y); native inputs so Apple Pencil Scribble works (DS-PLT-06).

export const controlClass = cn(
  "block w-full rounded-control border border-tertiary/45 bg-surface px-3.5 text-body text-primary",
  "transition-colors duration-fast placeholder:text-secondary",
  "hover:border-tertiary focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent",
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-secondary",
  "aria-invalid:border-danger-base aria-invalid:focus-visible:outline-danger-base",
);

/**
 * A ledger cell (builder lines, premium redesign 2): reads as text until
 * hovered or focused, then shows a field with the accent ring.
 */
export const cellClass = cn(
  "block h-10 w-full min-w-0 rounded-[8px] border border-transparent bg-transparent px-2 text-body text-primary",
  "transition-colors duration-fast placeholder:text-tertiary",
  "hover:bg-surface-2 focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-accent-tint",
  "aria-invalid:border-danger-base",
);

export interface FieldProps {
  label: string;
  /** Keep the label for screen readers only (ledger cells, which have a column header). */
  hideLabel?: boolean;
  /** Helper text under the field (never the only instruction). */
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
}

export function Field({ label, hideLabel, hint, error, required, className, children }: FieldProps) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-label font-medium text-secondary", hideLabel && "sr-only")}>
        {label}
        {required && <span className="font-normal text-secondary"> (required)</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-micro text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-label font-semibold text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}

type InputBase = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> &
  Pick<FieldProps, "label" | "hint" | "error" | "hideLabel"> & { fieldClassName?: string; cell?: boolean };

export const TextField = React.forwardRef<HTMLInputElement, InputBase>(
  ({ label, hint, error, required, fieldClassName, className, hideLabel, cell, ...props }, ref) => (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      required={required}
      className={cn(hideLabel && "gap-0", fieldClassName)}
    >
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(cell ? cellClass : cn(controlClass, "h-11 pointer-fine:h-10"), className)}
          {...props}
        />
      )}
    </Field>
  ),
);
TextField.displayName = "TextField";

export const DateField = React.forwardRef<HTMLInputElement, Omit<InputBase, "type">>((props, ref) => (
  <TextField ref={ref} type="date" {...props} />
));
DateField.displayName = "DateField";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> &
    Pick<FieldProps, "label" | "hint" | "error"> & { fieldClassName?: string }
>(({ label, hint, error, required, fieldClassName, className, ...props }, ref) => (
  <Field label={label} hint={hint} error={error} required={required} className={fieldClassName}>
    {({ id, describedBy, invalid }) => (
      <textarea
        ref={ref}
        id={id}
        required={required}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn(controlClass, "min-h-28 py-2.5", className)}
        {...props}
      />
    )}
  </Field>
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id"> &
    Pick<FieldProps, "label" | "hint" | "error"> & { fieldClassName?: string }
>(({ label, hint, error, required, fieldClassName, className, children, ...props }, ref) => (
  <Field label={label} hint={hint} error={error} required={required} className={fieldClassName}>
    {({ id, describedBy, invalid }) => (
      <div className="relative">
        <select
          ref={ref}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(controlClass, "h-11 appearance-none truncate pr-10 pointer-fine:h-10", className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-secondary"
          aria-hidden
        />
      </div>
    )}
  </Field>
));
Select.displayName = "Select";
