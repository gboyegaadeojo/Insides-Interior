import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";

// Refactored from legacy/src/components/ui/button.tsx (SPEC 2.5): tokens only,
// graphite primary, grey tinted (premium redesign 2, docs/decisions.md),
// sizes md 44 / lg 52 on touch, 40 / 44 with a mouse (DS-SPC-03), tinted and
// loading variants, 0.98 press (DS-MOT-02).
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium",
    "transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-fast ease-out active:duration-press",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55 aria-busy:pointer-events-none",
    "[&_svg]:size-4.5 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-action font-semibold text-action-on hover:bg-action/88",
        secondary: "border border-tertiary/35 bg-surface text-primary hover:bg-surface-2",
        tinted: "bg-surface-3/70 text-primary hover:bg-surface-3",
        ghost: "text-primary hover:bg-surface-2",
        destructive: "bg-danger-base text-danger-on hover:brightness-110",
      },
      size: {
        md: "h-11 px-4 text-body pointer-fine:h-10",
        lg: "h-12 px-6 text-body pointer-fine:h-11",
        icon: "size-11 pointer-fine:size-10",
        /** Compact list actions: 32px to look at, 44px to tap (after: extends the target). */
        sm: "relative h-8 min-w-21 px-3 text-label after:absolute after:inset-x-0 after:-inset-y-1.5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Disables the button and shows a spinner (DS-TCH-08). */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <LoaderCircle className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
