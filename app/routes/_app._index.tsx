import { Building2, FileText, Sparkles, UserPlus } from "lucide-react";
import { BUSINESS_TZ, LOCALE } from "~/domain/locale";
import { Link } from "react-router";
import { IconChip } from "~/components/ui/icon-chip";
import type { AppHandle } from "~/lib/route-handle";
import { cn } from "~/lib/utils";
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
      <section className="rounded-sheet border border-border bg-gradient-to-br from-teal-tint via-surface to-plum-tint p-6 shadow-card tablet:p-8">
        <p className="text-label font-semibold text-teal-ink">{loaderData.date}</p>
        <h2 className="mt-2 font-display text-display">{loaderData.greeting}</h2>
        <p className="mt-2 max-w-xl text-secondary">
          Welcome to your new studio app. Three quick steps and you're ready to send your first quote.
        </p>
      </section>

      <section
        aria-labelledby="setup-heading"
        className="rounded-sheet border border-border bg-surface p-5 shadow-card tablet:p-6"
      >
        <div className="mb-4 flex items-center gap-3">
          <IconChip icon={Sparkles} tone="saffron" />
          <h2 id="setup-heading" className="text-section font-semibold">
            Get set up
          </h2>
        </div>
        <ol className="grid gap-3 wide:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} data-module={step.module}>
              <Link
                to={step.to}
                className={cn(
                  "flex h-full min-h-24 items-start gap-4 rounded-card bg-mod-tint p-4 text-mod-ink transition-transform duration-fast ease-out active:scale-[0.99]",
                )}
              >
                <IconChip icon={step.icon} tone={step.tone} filled size="lg" />
                <span>
                  <span className="text-label font-semibold">Step {index + 1}</span>
                  <span className="block text-section font-semibold">{step.title}</span>
                  <span className="mt-0.5 block text-label font-normal">{step.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
