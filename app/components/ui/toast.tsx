import { toast as sonner, Toaster as SonnerToaster } from "sonner";

/** Mount once in the root layout. Themed by tokens; announced politely. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      offset={{ bottom: "calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 12px)" }}
      mobileOffset={{ bottom: "calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 12px)" }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[min(92vw,26rem)] items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 text-primary shadow-sheet",
          title: "font-semibold",
          description: "text-secondary",
          actionButton:
            "ml-auto inline-flex h-11 shrink-0 items-center rounded-control px-3 font-semibold text-teal-ink hover:bg-teal-tint",
          cancelButton: "inline-flex h-11 shrink-0 items-center rounded-control px-3 text-secondary",
          error: "border-danger-base",
          success: "border-sage-base",
        },
      }}
    />
  );
}

/** Shows a toast. Pass `undo` to offer an Undo action (SPEC 6.11 Toast with Undo). */
export function toast(
  message: string,
  options: { description?: string; undo?: () => void; tone?: "success" | "error" } = {},
) {
  const show = options.tone === "error" ? sonner.error : options.tone === "success" ? sonner.success : sonner;
  return show(message, {
    description: options.description,
    action: options.undo ? { label: "Undo", onClick: options.undo } : undefined,
    duration: options.undo ? 8000 : 4000,
  });
}
