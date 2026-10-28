import { Banknote, BellRing, Copy, FileText, Inbox, Plus, Receipt, Send, Trash2, Users } from "lucide-react";
import * as React from "react";
import { Link } from "react-router";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Celebration } from "~/components/ui/celebration";
import { Combobox } from "~/components/ui/combobox";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { DateField, Select, Textarea, TextField } from "~/components/ui/field";
import { TONE } from "~/components/ui/hue";
import { IconChip } from "~/components/ui/icon-chip";
import { ITEM_TYPES, ItemTypeChip } from "~/components/ui/item-type-chip";
import { KpiCard } from "~/components/ui/kpi-card";
import { MoneyField, QuantityField } from "~/components/ui/number-fields";
import { SaveStatus } from "~/components/ui/save-status";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet";
import { EmptyState, ErrorState, Loading, Skeleton } from "~/components/ui/states";
import { STATUSES, StatusBadge } from "~/components/ui/status-badge";
import { SwipeRow } from "~/components/ui/swipe-row";
import { MoneyText } from "~/components/ui/text";
import { toast } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import { HUES, MOTION, NEUTRALS, PALETTE, RADII, STATUS_EXTRA, TYPE_SCALE } from "~/styles/tokens";
import { requireOwner } from "~/server/session";
import type { Route } from "./+types/design";

// /design (SPEC 6.11): every token and component in every state, light and dark.
// Refactored from legacy/src/routes/design-system.tsx (SPEC 2.5). Owner and
// developer only: owner sign-in required.

export function meta() {
  return [{ title: "Design system · Insides Interior" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireOwner(context.cloudflare.env, request);
  const theme = new URL(request.url).searchParams.get("theme");
  return { themes: theme === "light" || theme === "dark" ? [theme] : (["light", "dark"] as const) };
}

export default function Design({ loaderData }: Route.ComponentProps) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-[var(--gutter)] py-4 pt-safe">
        <h1 className="flex-1 font-display text-title">Design system</h1>
        <nav aria-label="Theme" className="flex gap-2">
          <Link
            className="inline-flex h-11 items-center rounded-control px-3 font-semibold hover:bg-surface-2"
            to="/design"
          >
            Both
          </Link>
          <Link
            className="inline-flex h-11 items-center rounded-control px-3 font-semibold hover:bg-surface-2"
            to="/design?theme=light"
          >
            Light
          </Link>
          <Link
            className="inline-flex h-11 items-center rounded-control px-3 font-semibold hover:bg-surface-2"
            to="/design?theme=dark"
          >
            Dark
          </Link>
          <Link
            className="inline-flex h-11 items-center rounded-control px-3 font-semibold hover:bg-surface-2"
            to="/"
          >
            App
          </Link>
        </nav>
      </header>
      <div className={cn("grid", loaderData.themes.length === 2 && "desktop:grid-cols-2")}>
        {loaderData.themes.map((theme) => (
          <section
            key={theme}
            data-theme={theme}
            data-module="home"
            aria-label={`${theme} theme`}
            className="min-w-0 bg-canvas px-[var(--gutter)] py-8 text-primary"
          >
            <p className="mb-6 text-label font-semibold tracking-wide text-secondary uppercase">{theme}</p>
            <Showcase />
          </section>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 font-display text-title">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-10 shrink-0 rounded-control border border-border", className)} aria-hidden />
      <span className="text-label">{name}</span>
    </div>
  );
}

const NEUTRAL_BG: Record<string, string> = {
  canvas: "bg-canvas",
  surface: "bg-surface",
  "surface-2": "bg-surface-2",
  "surface-3": "bg-surface-3",
  border: "bg-border",
  "text-primary": "bg-primary",
  "text-secondary": "bg-secondary",
  "text-tertiary": "bg-tertiary",
};

const TYPE_CLASS: Record<keyof typeof TYPE_SCALE, string> = {
  display: "font-display text-display",
  title: "font-display text-title",
  section: "text-section font-semibold",
  body: "text-body",
  compact: "text-compact",
  label: "text-label font-semibold",
  kpi: "tabular text-kpi font-[650]",
  micro: "text-micro font-medium",
};

const CLIENTS = [
  { value: "1", label: "Amelia Chen", description: "Wolseley" },
  { value: "2", label: "Kwame Mensah", description: "St. Boniface" },
  { value: "3", label: "Sophie Tremblay", description: "River Heights" },
];

function Showcase() {
  const [money, setMoney] = React.useState<number | null>(4275);
  const [qty, setQty] = React.useState<number | null>(4500);
  const [client, setClient] = React.useState<string | null>("1");
  const [clients, setClients] = React.useState(CLIENTS);
  const [segment, setSegment] = React.useState<"all" | "draft" | "sent" | "approved">("all");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [celebrate, setCelebrate] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  return (
    <>
      <Section title="Neutrals">
        <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
          {Object.keys(NEUTRALS).map((name) => (
            <Swatch key={name} name={name} className={NEUTRAL_BG[name]!} />
          ))}
        </div>
      </Section>

      <Section title="Studio palette">
        <div className="grid gap-3 tablet:grid-cols-2">
          {HUES.map((hue) => (
            <div
              key={hue}
              className="flex items-center gap-3 rounded-card border border-border bg-surface p-3"
            >
              <span className={cn("size-10 rounded-control", TONE[hue].base)} aria-hidden />
              <span
                className={cn(
                  "flex h-10 flex-1 items-center rounded-control px-3 font-semibold",
                  TONE[hue].soft,
                )}
              >
                {PALETTE[hue].label} ink on tint
              </span>
              <span
                className={cn("flex h-10 items-center rounded-control px-3 font-semibold", TONE[hue].solid)}
              >
                On base
              </span>
            </div>
          ))}
          {(Object.keys(STATUS_EXTRA) as (keyof typeof STATUS_EXTRA)[]).map((key) => (
            <div
              key={key}
              className="flex items-center gap-3 rounded-card border border-border bg-surface p-3"
            >
              <span className={cn("size-10 rounded-control", TONE[key].base)} aria-hidden />
              <span
                className={cn(
                  "flex h-10 flex-1 items-center rounded-control px-3 font-semibold",
                  TONE[key].soft,
                )}
              >
                {STATUS_EXTRA[key].label} ink on tint
              </span>
              <span
                className={cn("flex h-10 items-center rounded-control px-3 font-semibold", TONE[key].solid)}
              >
                On base
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="flex flex-col gap-3">
          {(Object.keys(TYPE_SCALE) as (keyof typeof TYPE_SCALE)[]).map((name) => (
            <div key={name} className="flex flex-wrap items-baseline gap-x-4">
              <span className="w-20 text-micro text-secondary">{name}</span>
              <span className={TYPE_CLASS[name]}>
                {name === "kpi" ? "$18,420.00" : "Walnut & linen, room by room"}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Spacing, radii, elevation, motion">
        <div className="flex flex-wrap items-end gap-2">
          {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((step) => (
            <span key={step} className="flex flex-col items-center gap-1">
              <span
                className="block bg-teal-base"
                style={{ width: step * 4, height: step * 4 }}
                aria-hidden
              />
              <span className="text-micro text-secondary">{step * 4}</span>
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-4">
          {Object.entries(RADII).map(([name, px]) => (
            <div
              key={name}
              className={cn(
                "flex size-24 items-center justify-center border border-border bg-surface text-micro shadow-card",
                name === "control" && "rounded-control",
                name === "card" && "rounded-card",
                name === "sheet" && "rounded-sheet shadow-sheet",
              )}
            >
              {name} {px}px
            </div>
          ))}
        </div>
        <ul className="mt-4 flex flex-wrap gap-2">
          {Object.entries(MOTION).map(([name, ms]) => (
            <li key={name} className="rounded-full bg-surface-2 px-3 py-1 text-micro">
              motion-{name} {ms}ms
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tinted">Tinted</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">
            <Trash2 aria-hidden /> Delete
          </Button>
          <Button size="lg">
            <Send aria-hidden /> Send quote
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="icon" variant="secondary" aria-label="Add">
            <Plus aria-hidden />
          </Button>
          <Button
            variant="secondary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
          >
            Try loading
          </Button>
        </div>
      </Section>

      <Section title="Icon chips, item types, avatars">
        <div className="flex flex-wrap gap-2">
          {HUES.map((hue) => (
            <IconChip key={hue} icon={FileText} tone={hue} />
          ))}
          {HUES.map((hue) => (
            <IconChip key={`${hue}-filled`} icon={FileText} tone={hue} filled />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ITEM_TYPES.map((type) => (
            <ItemTypeChip key={type} type={type} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            "Amelia Chen",
            "Kwame Mensah",
            "Sophie Tremblay",
            "Raj Patel",
            "Olivia Brown",
            "Ngozi Okafor",
            "Liam Murphy",
            "Emma Wilson",
          ].map((name) => (
            <Avatar key={name} name={name} />
          ))}
          <Avatar name="Insides Interior" size="lg" />
          <Avatar name="Amelia Chen" size="xl" />
        </div>
      </Section>

      <Section title="Status badges">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <StatusBadge
              key={status}
              status={status}
              percentPaid={status === "partially_paid" ? 40 : undefined}
            />
          ))}
          <StatusBadge status="sent" revision={2} />
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid gap-4 tablet:grid-cols-2">
          <TextField label="Client name" placeholder="e.g. Amelia Chen" required />
          <TextField label="Email" type="email" defaultValue="amelia@" error="Enter a valid email address" />
          <MoneyField label="Unit price" value={money} onValueChange={setMoney} hint="Before tax" />
          <QuantityField label="Quantity" value={qty} onValueChange={setQty} hint="Up to 3 decimals" />
          <DateField label="Valid until" defaultValue="2026-11-30" />
          <Select label="Unit" defaultValue="yd">
            <option value="h">Hours</option>
            <option value="yd">Yards</option>
            <option value="ea">Each</option>
          </Select>
          <Combobox
            label="Client"
            options={clients.map((c) => ({ ...c, icon: <Avatar name={c.label} size="sm" /> }))}
            value={client}
            onValueChange={setClient}
            searchPlaceholder="Search clients"
            onCreate={(name) => {
              const created = { value: String(clients.length + 1), label: name, description: "New client" };
              setClients([...clients, created]);
              setClient(created.value);
            }}
          />
          <TextField label="Disabled" defaultValue="Locked after sending" disabled />
          <Textarea
            label="Notes"
            placeholder="Anything the installer should know"
            fieldClassName="tablet:col-span-2"
          />
        </div>
        <p className="mt-3 text-secondary">
          Stored values: <span className="tabular">{money ?? "empty"}</span> cents,{" "}
          <span className="tabular">{qty ?? "empty"}</span> thousandths.
        </p>
      </Section>

      <Section title="Segmented control">
        <SegmentedControl
          label="Status"
          value={segment}
          onValueChange={setSegment}
          segments={[
            { value: "all", label: "All", count: 12 },
            { value: "draft", label: "Draft", count: 3 },
            { value: "sent", label: "Sent", count: 5 },
            { value: "approved", label: "Approved", count: 4 },
          ]}
        />
      </Section>

      <Section title="KPI cards">
        <div className="grid gap-3 tablet:grid-cols-2">
          <KpiCard label="Outstanding" value="$18,420.00" detail="9 invoices" tone="indigo" icon={Receipt} />
          <KpiCard label="Quotes awaiting" value="4" detail="$12,980.00" tone="plum" icon={FileText} />
          <KpiCard label="Paid this month" value="$6,310.00" tone="sage" icon={Banknote} />
          <KpiCard label="Overdue" value="$2,140.00" detail="2 invoices" tone="danger" icon={BellRing} />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-3">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">Open sheet</Button>
            </SheetTrigger>
            <SheetContent
              title="New client"
              description="Bottom sheet on phone, right sheet on tablet."
              footer={
                <Button className="w-full" size="lg">
                  Save client
                </Button>
              }
            >
              <div className="flex flex-col gap-4">
                <TextField label="Name" />
                <TextField label="Email" type="email" />
                <TextField label="Phone" type="tel" inputMode="tel" />
              </div>
            </SheetContent>
          </Sheet>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send quote Q-1042?</DialogTitle>
                <DialogDescription>
                  Amelia will get an email with a link to view and approve it.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary">Back</Button>
                <Button>Send</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Confirm dialog
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Void invoice INV-1042?"
            description="The invoice keeps its number and is marked Void. This can't be undone."
            confirmLabel="Void invoice"
            destructive
            onConfirm={() => new Promise((resolve) => setTimeout(resolve, 800))}
          />
          <Button
            variant="secondary"
            onClick={() => toast("Line removed", { undo: () => toast("Line restored") })}
          >
            Toast with Undo
          </Button>
          <Button variant="secondary" onClick={() => setCelebrate(true)}>
            Celebration
          </Button>
          <Celebration show={celebrate} label="Approved" onDone={() => setCelebrate(false)} />
        </div>
      </Section>

      <Section title="Save status">
        <div className="flex flex-wrap gap-4">
          <SaveStatus status={{ state: "saved", at: new Date("2026-10-28T15:04:00Z") }} />
          <SaveStatus status={{ state: "saving" }} />
          <SaveStatus status={{ state: "unsaved" }} />
          <SaveStatus status={{ state: "error" }} />
        </div>
      </Section>

      <Section title="Rows">
        <div className="flex flex-col gap-2">
          <SwipeRow
            actions={[
              { label: "Payment", icon: Banknote, tone: "sage", onSelect: () => toast("Record payment") },
              { label: "Remind", icon: BellRing, tone: "saffron", onSelect: () => toast("Reminder sent") },
              { label: "Duplicate", icon: Copy, tone: "indigo", onSelect: () => toast("Duplicated") },
            ]}
          >
            <div className="flex items-center gap-3 p-3">
              <Avatar name="Amelia Chen" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">INV-1042 · Amelia Chen</p>
                <p className="text-label font-normal text-secondary">Due Nov 12</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <MoneyText cents={53467} className="font-semibold" />
                <StatusBadge status="due_soon" size="sm" />
              </div>
            </div>
          </SwipeRow>
        </div>
      </Section>

      <Section title="States">
        <div className="grid gap-4">
          <Loading>
            <Card>
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="mt-3 h-4 w-2/3" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </Card>
          </Loading>
          <EmptyState
            icon={Inbox}
            tone="ocean"
            title="No conversations yet"
            description="Messages and change requests from clients will collect here."
          />
          <EmptyState
            icon={Users}
            tone="terracotta"
            title="No results"
            description="No clients match “Smith”. Try another name or clear the filter."
            action={<Button variant="secondary">Clear filter</Button>}
          />
          <ErrorState message="We couldn't load your invoices." onRetry={() => toast("Retrying…")} />
          <Card>
            <CardHeader>
              <CardTitle>Card</CardTitle>
              <CardDescription>Surface, 1px border, one soft shadow.</CardDescription>
            </CardHeader>
            <p>
              Total <MoneyText cents={53467} className="font-semibold" />
            </p>
          </Card>
        </div>
      </Section>
    </>
  );
}
