import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";
import { controlClass, Field, type FieldProps } from "./field";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Leading visual such as an Avatar. */
  icon?: React.ReactNode;
  description?: string;
}

export interface ComboboxProps extends Pick<FieldProps, "label" | "hint" | "error" | "required"> {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /**
   * Offers "Create '<query>'" when nothing matches exactly, and `createLabel`
   * (e.g. "New client") before anything is typed (SPEC 6.8 client picker).
   */
  onCreate?: (query: string) => void;
  createLabel?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Choose…",
  searchPlaceholder = "Search",
  emptyText = "No matches",
  onCreate,
  createLabel = "Create new",
  ...field
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((o) => o.value === value);
  const exact = options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              id={id}
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={cn(controlClass, "flex h-11 items-center gap-2 text-left pointer-fine:h-10")}
            >
              {selected?.icon}
              <span className={cn("min-w-0 flex-1 truncate", !selected && "text-secondary")}>
                {selected?.label ?? placeholder}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-secondary" aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[var(--radix-popover-trigger-width)] min-w-64 overflow-hidden rounded-card border border-border bg-surface text-primary shadow-sheet data-[state=open]:animate-in data-[state=open]:fade-in-0"
            >
              <Command shouldFilter>
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder={searchPlaceholder}
                  className="h-12 w-full border-b border-border bg-transparent px-4 text-body outline-none placeholder:text-secondary"
                />
                <Command.List className="max-h-72 overflow-y-auto p-1.5">
                  <Command.Empty className="px-3 py-3 text-secondary">{emptyText}</Command.Empty>
                  {options.map((option) => (
                    <Command.Item
                      key={option.value}
                      value={`${option.label} ${option.description ?? ""}`}
                      onSelect={() => {
                        onValueChange(option.value);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 py-2 data-[selected=true]:bg-surface-2"
                    >
                      {option.icon}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description && (
                          <span className="block truncate text-label font-normal text-secondary">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {option.value === value && (
                        <Check className="size-4 text-teal-base" aria-label="Selected" />
                      )}
                    </Command.Item>
                  ))}
                  {onCreate && !exact && (
                    <Command.Item
                      value={`__create__ ${query}`}
                      forceMount
                      onSelect={() => {
                        onCreate(query.trim());
                        setOpen(false);
                        setQuery("");
                      }}
                      className="mt-1 flex min-h-11 cursor-pointer items-center gap-3 rounded-control border-t border-border px-3 py-2 font-semibold text-teal-ink data-[selected=true]:bg-teal-tint"
                    >
                      <Plus className="size-5" aria-hidden />
                      {query.trim() ? `Create “${query.trim()}”` : createLabel}
                    </Command.Item>
                  )}
                </Command.List>
              </Command>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </Field>
  );
}
