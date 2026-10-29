import { ArrowRight, Building2, FileText, Sparkles, UserPlus } from "lucide-react";
import { BUSINESS_TZ, LOCALE } from "~/domain/locale";
import { Link } from "react-router";
import { IconChip } from "~/components/ui/icon-chip";
import type { AppHandle } from "~/lib/route-handle";
import { requireUser } from "~/server/session";
import type { Route } from "./+types/_app._index";

export const handle: AppHandle = { module: "home", title: "Home" };

export function meta() {
  return [
    { title: "Home · Insides Interior" },
    { name: "description", content: "Quotes and invoicing for Insides Interior Limited." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUser(context.cloudflare.env, request);
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat(LOCALE, { hour: "numeric", hourCycle: "h23", timeZone: BUSINESS_TZ }).format(now),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: BUSINESS_TZ,
  }).format(now);
  return { greeting, date };
}

const STEPS = [
  {
    title: "Business details",
    description: "Logo, brand colour, tax numbers and payment instructions.",
    to: "/settings",
    module: "home",
    icon: Building2,
    tone: "teal",
  },
  {
    title: "Add your first client",
    description: "Contacts and site addresses, ready for quoting.",
    to: "/clients",
    module: "clients",
    icon: UserPlus,
    tone: "terracotta",
  },
  {
    title: "Create your first quote",
    description: "Build it room by room and send it for approval.",
    to: "/quotes",
    module: "quotes",
    icon: FileText,
    tone: "plum",
  },
] as const;

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-sheet border border-border bg-surface-2 px-6 py-7 tablet:px-10 tablet:py-10">
        <p className="text-micro font-semibold tracking-[0.12em] text-secondary uppercase">
          {loaderData.date}
        </p>
        <h2 className="mt-3 font-display text-display">{loaderData.greeting}</h2>
        <p className="mt-3 max-w-xl text-secondary">
          Welcome to your new studio app. Three quick steps and you're ready to send your first quote.
        </p>
      </section>

      <section
        aria-labelledby="setup-heading"
        className="rounded-sheet border border-border bg-surface shadow-card"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 tablet:px-6">
          <Sparkles className="size-4.5 text-teal-ink" aria-hidden />
          <h2 id="setup-heading" className="font-display text-title">
            Get set up
          </h2>
        </div>
        <ol className="grid divide-y divide-border wide:grid-cols-3 wide:divide-x wide:divide-y-0">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Link
                to={step.to}
                className="group flex h-full min-h-28 flex-col gap-3 px-5 py-5 transition-colors duration-fast ease-out hover:bg-surface-2 tablet:px-6"
              >
                <span className="flex items-center justify-between">
                  <IconChip icon={step.icon} tone={step.tone} size="md" />
                  <span className="font-display text-section text-tertiary tabular">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </span>
                <span>
                  <span className="sr-only">Step {index + 1}: </span>
                  <span className="flex items-center gap-1.5 font-semibold">
                    {step.title}
                    <ArrowRight
                      className="size-4 text-tertiary transition-transform duration-fast ease-out group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                  <span className="mt-1 block text-label font-normal text-secondary">{step.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
