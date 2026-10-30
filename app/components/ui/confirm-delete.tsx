import { Trash2 } from "lucide-react";
import * as React from "react";
import { useFetcher } from "react-router";
import { cn } from "~/lib/utils";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * A delete that always warns first (owner request: "deleting anything should
 * give a warning"). Shows a confirmation, then posts `fields` to `action` (the
 * current route by default). Icon-only in lists, or a text button.
 */
export function ConfirmDelete({
  fields,
  action,
  title,
  description,
  confirmLabel = "Delete",
  label,
  iconOnly = false,
  className,
}: {
  fields: Record<string, string>;
  action?: string;
  /** e.g. "Delete this draft quote?" */
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  /** Visible text, or the accessible name when icon-only. */
  label: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={iconOnly ? "icon" : "md"}
        aria-label={iconOnly ? label : undefined}
        className={cn("text-danger-ink hover:bg-danger-tint", className)}
        onClick={() => setOpen(true)}
        loading={busy}
      >
        {!busy && <Trash2 aria-hidden />}
        {!iconOnly && label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive
        loading={busy}
        // The dialog shows progress until the server answers, then closes.
        onConfirm={() => fetcher.submit(fields, { method: "post", action })}
      />
    </>
  );
}
