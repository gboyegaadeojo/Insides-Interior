import * as React from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * May return a promise; the confirm button shows progress until it settles.
   * Returning false keeps the dialog open (e.g. a form inside it isn't valid
   * yet, or the parent closes it when the server answers).
   */
  onConfirm: () => void | boolean | Promise<void | boolean>;
  /** Extra content between the description and the buttons, such as a reason field. */
  children?: React.ReactNode;
  /** Progress driven by the parent, e.g. while a form submission is in flight. */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  children,
  loading = false,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const busy = pending || loading;

  async function confirm() {
    setPending(true);
    try {
      if ((await onConfirm()) !== false) onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button variant={destructive ? "destructive" : "primary"} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
