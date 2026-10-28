import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "~/lib/utils";

// Refactored from legacy/src/components/ui/card.tsx onto tokens (DS-SPC-02/04/05).
const cardVariants = cva("rounded-card border border-border bg-surface text-primary shadow-card", {
  variants: {
    padding: { default: "p-5 tablet:p-6", compact: "p-4", none: "" },
  },
  defaultVariants: { padding: "default" },
});

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, padding, ...props }, ref) => (
  <div ref={ref} className={cn(cardVariants({ padding }), className)} {...props} />
));
Card.displayName = "Card";

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-section font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-secondary", className)} {...props} />;
}
