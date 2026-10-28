import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  FileText,
  FolderKanban,
  History,
  Mail,
  MapPin,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  Trash2,
  UserRound,
} from "lucide-react";
import * as React from "react";
import { data, Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { DEFAULT_CITY, DEFAULT_STATE } from "~/domain/locale";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { TextField } from "~/components/ui/field";
import { IconChip } from "~/components/ui/icon-chip";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { EmptyState } from "~/components/ui/states";
import { StatusBadge } from "~/components/ui/status-badge";
import { MoneyText } from "~/components/ui/text";
import { toast } from "~/components/ui/toast";
import { clientSchema, contactSchema, siteSchema } from "~/features/clients/schema";
import {
  archiveSite,
  formatAddress,
  getClient,
  removeContact,
  saveContact,
  saveSite,
  setClientArchived,
  updateClient,
} from "~/features/clients/service";
import { ClientFields } from "~/features/clients/ui/client-form";
import { NewQuoteButton } from "~/features/quotes/ui/new-quote-button";
import { ServiceError } from "~/features/settings/service";
import { activityLabel, relativeTime } from "~/lib/activity-label";
import { type FieldErrors, parseForm } from "~/lib/form";
import { useSearchSheet } from "~/lib/use-search-sheet";
import { cn } from "~/lib/utils";
import { assertSameOrigin, requireOwner, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.clients.$id";

export function meta({ data: d }: Route.MetaArgs) {
  return [{ title: `${d?.client.displayName ?? "Client"} · Insides Interior` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const detail = await getClient(ctx, params.id);
  if (!detail) throw new Response("Not found", { status: 404 });
  return { ...detail, canArchive: ctx.user.role === "owner" };
}

type Result = { ok: true; message: string } | { ok: false; intent: string; errors: FieldErrors };

export async function action({ request, params, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const env = context.cloudflare.env;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const ctx =
    intent === "archive" || intent === "restore"
      ? await requireOwner(env, request)
      : await requireUser(env, request);
  const fail = (errors: FieldErrors) => data<Result>({ ok: false, intent, errors }, { status: 400 });
  try {
    switch (intent) {
      case "update": {
        const parsed = parseForm(clientSchema, form);
        if (!parsed.ok) return fail(parsed.errors);
        await updateClient(ctx, params.id, parsed.data);
        return data<Result>({ ok: true, message: "Client saved" });
      }
      case "contact": {
        const parsed = parseForm(contactSchema, form);
        if (!parsed.ok) return fail(parsed.errors);
        await saveContact(ctx, params.id, parsed.data);
        return data<Result>({ ok: true, message: "Contact saved" });
      }
      case "remove-contact":
        await removeContact(ctx, params.id, String(form.get("contactId")));
        return data<Result>({ ok: true, message: "Contact removed" });
      case "site": {
        const parsed = parseForm(siteSchema, form);
        if (!parsed.ok) return fail(parsed.errors);
        await saveSite(ctx, params.id, parsed.data);
        return data<Result>({ ok: true, message: "Site saved" });
      }
      case "remove-site":
        await archiveSite(ctx, params.id, String(form.get("siteId")));
        return data<Result>({ ok: true, message: "Site removed" });
      case "archive":
      case "restore":
        await setClientArchived(ctx, params.id, intent === "archive");
        return data<Result>({
          ok: true,
          message: intent === "archive" ? "Client archived" : "Client restored",
        });
      default:
        throw new Response("Unknown action", { status: 400 });
    }
  } catch (error) {
    if (error instanceof ServiceError) return fail({ [error.field]: error.message });
    throw error;
  }
}

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "documents", label: "Documents" },
  { value: "projects", label: "Projects" },
  { value: "messages", label: "Messages" },
  { value: "notes", label: "Notes" },
  { value: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export default function ClientProfile({ loaderData }: Route.ComponentProps) {
  const { client, contacts, sites, projects, quotes, invoices, timeline, balance, canArchive } = loaderData;
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get("tab"))?.value ?? "overview") as Tab;
  const edit = useSearchSheet("edit");
  const actionData = useActionData<Result>();
  const navigation = useNavigation();
  const pendingIntent = navigation.formData?.get("intent");
  const lastResult = React.useRef<Result | undefined>(undefined);

  React.useEffect(() => {
    if (!actionData || actionData === lastResult.current) return;
    lastResult.current = actionData;
    if (actionData.ok) {
      toast(actionData.message, { tone: "success" });
      if (actionData.message === "Client saved") edit.onOpenChange(false);
    }
  }, [actionData, edit]);

  const errorsFor = (intent: string) =>
    actionData && !actionData.ok && actionData.intent === intent ? actionData.errors : {};
  const backParams = new URLSearchParams(params);
  backParams.delete("tab");
  backParams.delete("edit");

  return (
    <article aria-labelledby="client-name" className="flex flex-col gap-4">
      <Link
        to={`/clients${backParams.toString() ? `?${backParams}` : ""}`}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-control px-2 font-semibold text-terracotta-ink wide:hidden"
      >
        <ChevronLeft className="size-5" aria-hidden />
        Clients
      </Link>

      <Card className="flex flex-col gap-4 tablet:flex-row tablet:items-center">
        <Avatar name={client.displayName} size="xl" />
        <div className="min-w-0 flex-1">
          <h2 id="client-name" className="font-display text-title">
            {client.displayName}
          </h2>
          {client.company && <p className="text-secondary">{client.company}</p>}
          {client.archivedAt && <p className="mt-1 text-label font-semibold text-secondary">Archived</p>}
          {client.tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Tags">
              {client.tags.map((t) => (
                <li
                  key={t}
                  className="rounded-full bg-terracotta-tint px-2.5 py-0.5 text-micro font-semibold text-terracotta-ink"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-4 text-right tablet:text-right">
          <div>
            <dt className="text-label font-semibold text-secondary">Outstanding</dt>
            <dd className="text-section font-semibold">
              <MoneyText cents={balance.outstandingCents} />
            </dd>
          </div>
          <div>
            <dt className="text-label font-semibold text-secondary">Billed</dt>
            <dd>
              <MoneyText cents={balance.billedCents} />
            </dd>
          </div>
          <div>
            <dt className="text-label font-semibold text-secondary">Paid</dt>
            <dd>
              <MoneyText cents={balance.paidCents} />
            </dd>
          </div>
        </dl>
      </Card>

      <div className="flex flex-wrap gap-2">
        {!client.archivedAt && <NewQuoteButton clientId={client.id} size="md" variant="primary" />}
        <Button variant="secondary" onClick={() => edit.show()}>
          <Pencil aria-hidden />
          Edit
        </Button>
        {canArchive && (
          <Form method="post">
            <input type="hidden" name="intent" value={client.archivedAt ? "restore" : "archive"} />
            <Button
              type="submit"
              variant="ghost"
              loading={pendingIntent === "archive" || pendingIntent === "restore"}
            >
              {client.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {client.archivedAt ? "Restore" : "Archive"}
            </Button>
          </Form>
        )}
      </div>

      <SegmentedControl
        label="Client sections"
        value={tab}
        onValueChange={(next) =>
          setParams(
            (p) => {
              p.set("tab", next);
              return p;
            },
            { replace: true, preventScrollReset: true },
          )
        }
        segments={TABS.map((t) => ({
          ...t,
          count:
            t.value === "documents"
              ? quotes.length + invoices.length
              : t.value === "projects"
                ? projects.length
                : undefined,
        }))}
      />

      {tab === "overview" && (
        <div className="grid gap-4 desktop:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-section font-semibold">Contact</h3>
            <ul className="flex flex-col gap-2">
              {client.email && (
                <li className="flex items-center gap-2">
                  <Mail className="size-4 text-secondary" aria-hidden />
                  <a
                    href={`mailto:${client.email}`}
                    className="text-terracotta-ink underline-offset-2 hover:underline"
                  >
                    {client.email}
                  </a>
                  {client.emailBouncedAt && (
                    <span className="text-micro font-semibold text-danger-ink">bounced</span>
                  )}
                </li>
              )}
              {client.phone && (
                <li className="flex items-center gap-2">
                  <Phone className="size-4 text-secondary" aria-hidden />
                  <a
                    href={`tel:${client.phone}`}
                    className="text-terracotta-ink underline-offset-2 hover:underline"
                  >
                    {client.phone}
                  </a>
                </li>
              )}
              {formatAddress(client.billingAddress) && (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-1 size-4 text-secondary" aria-hidden />
                  <span>{formatAddress(client.billingAddress)}</span>
                </li>
              )}
              {!client.email && !client.phone && !formatAddress(client.billingAddress) && (
                <li className="text-secondary">No contact details yet.</li>
              )}
            </ul>
          </Card>

          <ContactsCard contacts={contacts} errors={errorsFor("contact")} pendingIntent={pendingIntent} />
          <SitesCard sites={sites} errors={errorsFor("site")} pendingIntent={pendingIntent} />
        </div>
      )}

      {tab === "documents" &&
        (quotes.length + invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            tone="plum"
            title="No quotes or invoices yet"
            description="Quotes and invoices for this client will be listed here."
            action={client.archivedAt ? undefined : <NewQuoteButton clientId={client.id} size="md" />}
          />
        ) : (
          <Card padding="compact">
            <ul className="divide-y divide-border">
              {[
                ...quotes.map((q) => ({ ...q, kind: "Quote" })),
                ...invoices.map((i) => ({ ...i, title: null, kind: "Invoice" })),
              ].map((doc) => (
                <li key={doc.id} className="flex min-h-11 items-center gap-3 py-2">
                  {doc.kind === "Quote" ? (
                    <Link
                      to={`/quotes/${doc.id}`}
                      className="flex-1 font-semibold text-plum-ink underline-offset-2 hover:underline"
                    >
                      {doc.kind} {doc.number ?? "draft"}
                      {doc.title && <span className="font-normal text-secondary"> · {doc.title}</span>}
                    </Link>
                  ) : (
                    <span className="flex-1">
                      {doc.kind} {doc.number ?? "draft"}
                      {doc.title && <span className="text-secondary"> · {doc.title}</span>}
                    </span>
                  )}
                  <StatusBadge status={doc.status} size="sm" />
                </li>
              ))}
            </ul>
          </Card>
        ))}

      {tab === "projects" &&
        (projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            tone="saffron"
            title="No projects yet"
            description="Approving a quote creates a project. You can also start one by hand."
            action={
              <Button asChild variant="secondary">
                <Link to={`/projects?new=1&client=${client.id}`}>
                  <Plus aria-hidden />
                  New project
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/projects/${p.id}`}
                  className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-surface px-4 py-2 hover:bg-surface-2"
                >
                  <IconChip icon={FolderKanban} tone="saffron" size="sm" />
                  <span className="flex-1 font-semibold">{p.name}</span>
                  <span className="text-label font-normal text-secondary capitalize">{p.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {tab === "messages" && (
        <EmptyState
          icon={MessageSquareText}
          tone="ocean"
          title="No messages yet"
          description="Messages and change requests from this client's quotes and invoices will appear here."
        />
      )}

      {tab === "notes" &&
        (client.notes ? (
          <Card>
            <p className="whitespace-pre-line">{client.notes}</p>
          </Card>
        ) : (
          <EmptyState
            icon={StickyNote}
            tone="saffron"
            title="No notes"
            description="Keep preferences, access instructions or measurements here. Only your team sees them."
            action={
              <Button variant="secondary" onClick={() => edit.show()}>
                <Pencil aria-hidden />
                Add notes
              </Button>
            }
          />
        ))}

      {tab === "activity" &&
        (timeline.length === 0 ? (
          <EmptyState icon={History} tone="ocean" title="No activity yet" />
        ) : (
          <Card padding="compact">
            <ol className="flex flex-col">
              {timeline.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
                >
                  <History className="size-4 text-secondary" aria-hidden />
                  <span className="flex-1">{activityLabel(entry.action, entry.data)}</span>
                  <time dateTime={entry.at} className="text-label font-normal text-secondary">
                    {relativeTime(entry.at)}
                  </time>
                </li>
              ))}
            </ol>
          </Card>
        ))}

      <Sheet open={edit.open} onOpenChange={edit.onOpenChange}>
        <SheetContent
          title="Edit client"
          footer={
            <Button
              type="submit"
              form="edit-client"
              size="lg"
              className="w-full"
              loading={pendingIntent === "update"}
            >
              Save changes
            </Button>
          }
        >
          <Form id="edit-client" method="post">
            <input type="hidden" name="intent" value="update" />
            <ClientFields values={client} errors={errorsFor("update")} />
          </Form>
        </SheetContent>
      </Sheet>
    </article>
  );
}

function ContactsCard({
  contacts,
  errors,
  pendingIntent,
}: {
  contacts: Route.ComponentProps["loaderData"]["contacts"];
  errors: FieldErrors;
  pendingIntent: FormDataEntryValue | null | undefined;
}) {
  // The form closes by itself once the new person appears in the list (a
  // failed save keeps it open with its errors).
  const [openedAt, setOpenedAt] = React.useState<number | null>(null);
  const adding = openedAt !== null && contacts.length === openedAt;
  const setAdding = (open: boolean) => setOpenedAt(open ? contacts.length : null);
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-section font-semibold">People</h3>
        {!adding && (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add person
          </Button>
        )}
      </div>
      {contacts.length === 0 && !adding && (
        <p className="text-secondary">Add a partner, assistant or site contact.</p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <Avatar name={c.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {c.name}
                {c.isPrimary && (
                  <span className="ml-2 rounded-full bg-sage-tint px-2 text-micro text-sage-ink">
                    Primary
                  </span>
                )}
              </span>
              <span className="block truncate text-label font-normal text-secondary">
                {[c.role, c.email, c.phone].filter(Boolean).join(" · ") || "No details"}
              </span>
            </span>
            <Form method="post">
              <input type="hidden" name="intent" value="remove-contact" />
              <input type="hidden" name="contactId" value={c.id} />
              <Button type="submit" variant="ghost" size="icon" aria-label={`Remove ${c.name}`}>
                <Trash2 aria-hidden />
              </Button>
            </Form>
          </li>
        ))}
      </ul>
      {adding && (
        <Form method="post" className="mt-3 grid gap-3 rounded-card bg-surface-2 p-3 tablet:grid-cols-2">
          <input type="hidden" name="intent" value="contact" />
          <TextField label="Name" name="name" required error={errors.name} autoFocus />
          <TextField label="Role" name="role" placeholder="e.g. Partner" />
          <TextField label="Email" name="email" type="email" error={errors.email} />
          <TextField label="Phone" name="phone" type="tel" inputMode="tel" error={errors.phone} />
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name="isPrimary" className="size-5 accent-[var(--teal-base)]" />
            Primary contact
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pendingIntent === "contact"}>
              <UserRound aria-hidden />
              Save person
            </Button>
          </div>
        </Form>
      )}
    </Card>
  );
}

function SitesCard({
  sites,
  errors,
  pendingIntent,
}: {
  sites: Route.ComponentProps["loaderData"]["sites"];
  errors: FieldErrors;
  pendingIntent: FormDataEntryValue | null | undefined;
}) {
  const [openedAt, setOpenedAt] = React.useState<number | null>(null);
  const adding = openedAt !== null && sites.length === openedAt;
  const setAdding = (open: boolean) => setOpenedAt(open ? sites.length : null);
  return (
    <Card className={cn("desktop:col-span-2")}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-section font-semibold">Job addresses</h3>
        {!adding && (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add job address
          </Button>
        )}
      </div>
      {sites.length === 0 && !adding && (
        <p className="text-secondary">Job addresses, chosen per quote: home, cottage, office…</p>
      )}
      <ul className="grid gap-2 tablet:grid-cols-2">
        {sites.map((s) => (
          <li key={s.id} className="flex items-start gap-3 rounded-card border border-border p-3">
            <IconChip icon={MapPin} tone="terracotta" size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{s.label}</span>
              <span className="block text-label font-normal text-secondary">
                {formatAddress(s.address) || "No address"}
              </span>
            </span>
            <Form method="post">
              <input type="hidden" name="intent" value="remove-site" />
              <input type="hidden" name="siteId" value={s.id} />
              <Button type="submit" variant="ghost" size="icon" aria-label={`Remove ${s.label}`}>
                <Trash2 aria-hidden />
              </Button>
            </Form>
          </li>
        ))}
      </ul>
      {adding && (
        <Form method="post" className="mt-3 grid gap-3 rounded-card bg-surface-2 p-3 tablet:grid-cols-2">
          <input type="hidden" name="intent" value="site" />
          <TextField
            label="Address name"
            name="label"
            placeholder="e.g. Home, Cottage"
            required
            error={errors.label}
            autoFocus
          />
          <TextField label="Street address" name="line1" />
          <TextField label="City" name="city" defaultValue={DEFAULT_CITY} />
          <TextField label="State" name="state" defaultValue={DEFAULT_STATE} />
          <TextField label="Postcode (optional)" name="postalCode" error={errors.postalCode} />
          <div className="flex items-end justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pendingIntent === "site"}>
              Save address
            </Button>
          </div>
        </Form>
      )}
    </Card>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
