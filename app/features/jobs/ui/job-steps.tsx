import { Check } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import type { JobStage } from "~/domain/job";
import { formatDate } from "~/lib/dates";
import { cn } from "~/lib/utils";

// Job steps on screen (owner request, mockup approved 2026-10-30): the big step
// bar on a quote, the slim bar in lists, and the one button for the next step.

const shortDate = (iso: string | null) => (iso ? formatDate(iso).replace(/ \d{4}$/, "") : "");

function Dot({
  state,
  n,
  size,
}: {
  state: JobStage["steps"][number]["state"];
  n: number;
  size: "lg" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold tabular",
        size === "lg" ? "size-10 text-body" : "size-8 text-label",
        state === "done" && "bg-sage-base text-sage-on",
        state === "current" && "border-[3px] border-accent bg-surface text-accent",
        state === "upcoming" && "border-2 border-tertiary/45 bg-surface text-secondary",
        state === "skipped" && "border-2 border-dashed border-tertiary/45 bg-surface text-secondary",
      )}
    >
      {state === "done" ? (
        <Check className={size === "lg" ? "size-5" : "size-4"} strokeWidth={3} aria-label="Done" />
      ) : (
        n
      )}
    </span>
  );
}

const line = (on: boolean) => (on ? "bg-sage-base" : "bg-border");

function sub(step: JobStage["steps"][number]) {
  if (step.state === "current") return "Now";
  if (step.state === "skipped") return "Not needed";
  if (step.state === "done") return shortDate(step.date);
  return "";
}

/**
 * The seven steps. Tablet and desktop: a bar across. Phone: a list down the
 * page with the next step's sentence and button under the current step.
 */
export function JobSteps({ stage, next }: { stage: JobStage; next?: React.ReactNode }) {
  const last = stage.steps.length - 1;
  return (
    <section
      aria-label="Where this job is"
      className="rounded-card border border-border bg-surface shadow-card"
      data-testid="job-steps"
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5 tablet:px-6">
        <h2 className="text-title">Where this job is</h2>
        <p className="text-secondary">
          Step {stage.step} of {stage.steps.length}
        </p>
      </div>

      <ol className="hidden grid-cols-7 px-3 pt-5 pb-5 tablet:grid">
        {stage.steps.map((step, index) => (
          <li
            key={step.key}
            className="flex flex-col items-center gap-2 text-center"
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <div className="flex w-full items-center">
              <span
                className={cn("h-[3px] flex-1", index === 0 ? "bg-transparent" : line(index < stage.step))}
              />
              <Dot state={step.state} n={index + 1} size="lg" />
              <span
                className={cn(
                  "h-[3px] flex-1",
                  index === last ? "bg-transparent" : line(index + 1 < stage.step),
                )}
              />
            </div>
            <span
              className={cn(
                "px-1 text-label leading-tight",
                step.state === "current"
                  ? "font-bold"
                  : step.state === "done"
                    ? "font-medium"
                    : "text-secondary",
              )}
            >
              {step.label}
            </span>
            <span
              className={cn(
                "min-h-4 text-micro font-medium",
                step.state === "current" ? "text-accent" : "text-secondary",
              )}
            >
              {sub(step)}
            </span>
          </li>
        ))}
      </ol>

      <ol className="mt-3 pb-2 tablet:hidden">
        {stage.steps.map((step, index) => (
          <li
            key={step.key}
            className="flex gap-3.5 px-4"
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <div className="flex w-8 shrink-0 flex-col items-center">
              <span
                className={cn("h-3 w-[3px]", index === 0 ? "bg-transparent" : line(index < stage.step))}
              />
              <Dot state={step.state} n={index + 1} size="md" />
              <span
                className={cn(
                  "min-h-3 w-[3px] flex-1",
                  index === last ? "bg-transparent" : line(index + 1 < stage.step),
                )}
              />
            </div>
            <div className="min-w-0 flex-1 pt-3.5 pb-3">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    step.state === "current"
                      ? "font-bold"
                      : step.state === "done"
                        ? "font-medium"
                        : "text-secondary",
                  )}
                >
                  {step.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-label font-medium",
                    step.state === "current" ? "text-accent" : "text-secondary",
                  )}
                >
                  {sub(step)}
                </span>
              </div>
              {step.state === "current" && next && <div className="mt-2.5">{next}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Tablet and desktop: the next step in a bronze-bordered card beside its button. */
export function NextStepCard({
  stage,
  sentence,
  button,
}: {
  stage: JobStage;
  sentence: string;
  button: React.ReactNode;
}) {
  return (
    <section
      aria-label="Next step"
      className="hidden items-center gap-6 rounded-card border-2 border-accent bg-surface p-6 tablet:flex"
      data-testid="next-step"
    >
      <div className="min-w-0 flex-1">
        <p className="text-micro font-bold tracking-[0.06em] text-accent uppercase">
          {stage.key === "complete" ? "All done" : `Next step · ${stage.step} of ${stage.steps.length}`}
        </p>
        <h2 className="mt-1.5 text-section">{stage.headline}</h2>
        <p className="mt-1.5 max-w-prose text-secondary">{sentence}</p>
      </div>
      {button && <div className="flex w-72 shrink-0 flex-col gap-2">{button}</div>}
    </section>
  );
}

/** Phone: the sentence and button that open under the current step. */
export function NextStepInline({ sentence, button }: { sentence: string; button: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-secondary">{sentence}</p>
      {button}
    </div>
  );
}

/** Seven slim segments for list rows; the step text beside it carries the meaning. */
export function StepBar({ stage, className }: { stage: JobStage; className?: string }) {
  const complete = stage.key === "complete";
  return (
    <div className={cn("flex gap-1", className)} aria-hidden>
      {stage.steps.map((step, index) => (
        <span
          key={step.key}
          className={cn(
            "h-2 flex-1 rounded-full",
            complete || step.state === "done"
              ? "bg-sage-base"
              : step.state === "current"
                ? "bg-accent"
                : step.state === "skipped"
                  ? "bg-border/60"
                  : "bg-border",
            index === 0 && "min-w-2",
          )}
        />
      ))}
    </div>
  );
}

/**
 * The one button for a job's next step. Links go to the screen that does it;
 * making an invoice or extending posts to the quote, which redirects or toasts.
 */
export function JobActionButton({
  stage,
  quoteId,
  size = "lg",
  variant = "primary",
  className,
}: {
  stage: JobStage;
  quoteId: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const navigation = useNavigation();
  const action = stage.action;
  if (!action || !stage.actionLabel) return null;
  const label = stage.actionLabel;
  const link = (to: string) => (
    <Button asChild size={size} variant={variant} className={className}>
      <Link to={to}>{label}</Link>
    </Button>
  );
  const post = (fields: Record<string, string>) => {
    const busy =
      navigation.state !== "idle" &&
      navigation.formAction === `/quotes/${quoteId}` &&
      Object.entries(fields).every(([k, v]) => navigation.formData?.get(k) === v);
    return (
      <Form method="post" action={`/quotes/${quoteId}`} className={cn("contents", className)}>
        {Object.entries(fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Button type="submit" size={size} variant={variant} loading={busy} className={className}>
          {label}
        </Button>
      </Form>
    );
  };
  switch (action.kind) {
    case "continue_quote":
      return link(`/quotes/${quoteId}`);
    case "review_changes":
      return link(`/quotes/${quoteId}#conversation`);
    case "extend_quote":
      return post({ intent: "extend" });
    case "create_invoice":
      return post({ intent: "create_invoice", kind: action.invoiceKind });
    case "open_invoice":
      return link(`/invoices/${action.invoiceId}`);
    case "record_payment":
      return link(`/invoices/${action.invoiceId}?pay=1`);
  }
}
