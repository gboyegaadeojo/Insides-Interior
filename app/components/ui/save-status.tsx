import { AlertTriangle, CloudCheck, LoaderCircle, PencilLine } from "lucide-react";
import { LOCALE } from "~/domain/locale";
import { cn } from "~/lib/utils";

export type SaveState =
  | { state: "saved"; at: Date }
  | { state: "saving" }
  | { state: "unsaved" }
  | { state: "error"; message?: string };

const TIME = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });

/**
 * Truthful autosave indicator (CLAUDE.md design rules): it only says "Saved"
 * after the server confirmed the save, and says so politely to screen readers.
 */
export function SaveStatus({ status, className }: { status: SaveState; className?: string }) {
  let icon;
  let text: string;
  let tone = "text-secondary";
  switch (status.state) {
    case "saved":
      icon = <CloudCheck aria-hidden />;
      text = `Saved ${TIME.format(status.at)}`;
      break;
    case "saving":
      icon = <LoaderCircle className="animate-spin" aria-hidden />;
      text = "Saving…";
      break;
    case "unsaved":
      icon = <PencilLine aria-hidden />;
      text = "Unsaved changes";
      break;
    case "error":
      icon = <AlertTriangle aria-hidden />;
      text = status.message ?? "Not saved. Check your connection.";
      tone = "text-danger-ink font-semibold";
      break;
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 text-label [&_svg]:size-4", tone, className)}
    >
      {icon}
      {text}
    </span>
  );
}
