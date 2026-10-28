import {
  Archive,
  ArchiveRestore,
  ImageUp,
  LayoutTemplate,
  Library,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { data, Form, Link, useActionData, useNavigation, useSearchParams, useSubmit } from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Button } from "~/components/ui/button";
import { Select, TextField } from "~/components/ui/field";
import { TONE } from "~/components/ui/hue";
import { IconChip } from "~/components/ui/icon-chip";
import { ItemTypeChip } from "~/components/ui/item-type-chip";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { EmptyState } from "~/components/ui/states";
import { MoneyText } from "~/components/ui/text";
import { toast } from "~/components/ui/toast";
import { formatQuantity } from "~/domain/money";
import { itemSchema, ITEM_TYPES, templateSchema } from "~/features/catalogue/schema";
import {
  archiveTemplate,
  countItems,
  createItem,
  ITEM_PAGE_SIZE,
  listItems,
  listTemplates,
  removeItemPhoto,
  saveItemPhoto,
  saveTemplate,
  setItemArchived,
  updateItem,
} from "~/features/catalogue/service";
import { ItemFields } from "~/features/catalogue/ui/item-form";
import { activeTaxRates, ServiceError } from "~/features/settings/service";
import { type FieldErrors, parseForm } from "~/lib/form";
import type { AppHandle } from "~/lib/route-handle";
import { useSearchSheet } from "~/lib/use-search-sheet";
import { cn } from "~/lib/utils";
import { signedFileUrl } from "~/server/files";
import { assertSameOrigin, requireUser } from "~/server/session";
import { HUES, PALETTE } from "~/styles/tokens";
import type { Route } from "./+types/_app.catalogue";

export const handle: AppHandle = { module: "catalogue", title: "Catalogue" };

export function meta() {
  return [{ title: "Catalogue · Insides Interior" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const view = url.searchParams.get("view") === "templates" ? "templates" : "items";
  const query = url.searchParams.get("q") ?? "";
  const type = ITEM_TYPES.find((t) => t === url.searchParams.get("type"));
  const archived = url.searchParams.get("archived") === "1";
  const limit = Math.max(ITEM_PAGE_SIZE, Number(url.searchParams.get("show")) || 0);
  const [rows, totalItems, allItems, templates, taxRates] = await Promise.all([
    listItems(ctx, { query, type, archived, limit: limit + 1 }),
    countItems(ctx),
    // Only the room-template editor needs every item.
    view === "templates" ? listItems(ctx, { limit: 2000 }) : [],
    listTemplates(ctx),
    activeTaxRates(ctx),
  ]);
  const withPhotos = await Promise.all(
    rows.slice(0, limit).map(async (item) => ({
      ...item,
      photoUrl: item.photoKey ? await signedFileUrl(ctx.env, item.photoKey) : null,
    })),
  );
  return {
    view,
    query,
    type: type ?? null,
    archived,
    items: withPhotos,
    hasMore: rows.length > limit,
    limit,
    allItems: allItems.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      unit: i.unit,
      priceCents: i.priceCents,
    })),
    templates,
    taxRates: taxRates.map((r) => ({ id: r.id, name: r.name, rateBp: r.rateBp, isDefault: r.isDefault })),
    totalItems,
  };
}

type Result =
  { ok: true; message: string; intent: string } | { ok: false; intent: string; errors: FieldErrors };

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = String(form.get("id") ?? "");
  const fail = (errors: FieldErrors) => data<Result>({ ok: false, intent, errors }, { status: 400 });
  const done = (message: string) => data<Result>({ ok: true, intent, message });
  try {
    switch (intent) {
      case "create-item":
      case "update-item": {
        const parsed = parseForm(itemSchema, form, ["taxIds"]);
        if (!parsed.ok) return fail(parsed.errors);
        if (intent === "create-item") await createItem(ctx, parsed.data);
        else await updateItem(ctx, id, parsed.data);
        return done(intent === "create-item" ? "Item added to your catalogue" : "Item saved");
      }
      case "archive-item":
      case "restore-item":
        await setItemArchived(ctx, id, intent === "archive-item");
        return done(intent === "archive-item" ? "Item archived" : "Item restored");
      case "photo": {
        const file = form.get("photo");
        if (!(file instanceof File) || file.size === 0) return fail({ photo: "Choose a photo" });
        await saveItemPhoto(ctx, id, file);
        return done("Photo updated");
      }
      case "remove-photo":
        await removeItemPhoto(ctx, id);
        return done("Photo removed");
      case "save-template": {
        const parsed = parseForm(templateSchema, form, ["lines"]);
        if (!parsed.ok) return fail(parsed.errors);
        await saveTemplate(ctx, id || null, parsed.data);
        return done("Room template saved");
      }
      case "archive-template":
        await archiveTemplate(ctx, id);
        return done("Room template removed");
      default:
        throw new Response("Unknown action", { status: 400 });
    }
  } catch (error) {
    if (error instanceof ServiceError) return fail({ [error.field]: error.message });
    throw error;
  }
}

export default function Catalogue({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const actionData = useActionData<Result>();
  const item = useSearchSheet("item");
  const template = useSearchSheet("template");
  const lastResult = React.useRef<Result | undefined>(undefined);

  React.useEffect(() => {
    if (!actionData || actionData === lastResult.current) return;
    lastResult.current = actionData;
    if (!actionData.ok) return;
    toast(actionData.message, { tone: "success" });
    if (["create-item", "update-item", "archive-item", "restore-item"].includes(actionData.intent))
      item.onOpenChange(false);
    if (["save-template", "archive-template"].includes(actionData.intent)) template.onOpenChange(false);
  }, [actionData, item, template]);

  const editing = loaderData.items.find((i) => i.id === item.value) ?? null;
  const editingTemplate = loaderData.templates.find((t) => t.id === template.value) ?? null;

  return (
    <>
      <ModuleHeader
        eyebrow="Catalogue"
        summary={`${loaderData.totalItems} item${loaderData.totalItems === 1 ? "" : "s"} · ${loaderData.templates.length} room template${loaderData.templates.length === 1 ? "" : "s"}`}
        action={
          <Button
            size="lg"
            variant="tinted"
            onClick={() => (loaderData.view === "templates" ? template.show("new") : item.show("new"))}
          >
            <Plus aria-hidden />
            {loaderData.view === "templates" ? "New template" : "New item"}
          </Button>
        }
      />
      <SegmentedControl
        label="Catalogue view"
        className="mb-4"
        value={loaderData.view}
        onValueChange={(view) =>
          setParams(view === "templates" ? { view } : {}, { preventScrollReset: true })
        }
        segments={[
          { value: "items", label: "Items", count: loaderData.totalItems },
          { value: "templates", label: "Room templates", count: loaderData.templates.length },
        ]}
      />
      {loaderData.view === "items" ? (
        <ItemsView {...loaderData} onOpen={(id) => item.show(id)} params={params} />
      ) : (
        <TemplatesView templates={loaderData.templates} onOpen={(id) => template.show(id)} />
      )}

      <Sheet open={item.open} onOpenChange={item.onOpenChange}>
        <SheetContent
          title={editing ? "Edit item" : "New item"}
          footer={
            <SubmitButton form="item-form" intent={editing ? "update-item" : "create-item"}>
              {editing ? "Save item" : "Add to catalogue"}
            </SubmitButton>
          }
        >
          <Form id="item-form" method="post" key={editing?.id ?? "new"}>
            <input type="hidden" name="intent" value={editing ? "update-item" : "create-item"} />
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <ItemFields
              values={editing ?? undefined}
              taxRates={loaderData.taxRates}
              errors={
                actionData && !actionData.ok && actionData.intent.endsWith("-item") ? actionData.errors : {}
              }
            />
          </Form>
          {editing && (
            <ItemExtras
              item={editing}
              errors={actionData && !actionData.ok && actionData.intent === "photo" ? actionData.errors : {}}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={template.open} onOpenChange={template.onOpenChange}>
        <SheetContent
          title={editingTemplate ? "Edit room template" : "New room template"}
          description="A set of items you add to a quote in one tap. Prices are copied when inserted."
          footer={
            <SubmitButton form="template-form" intent="save-template">
              Save template
            </SubmitButton>
          }
        >
          <TemplateForm
            key={editingTemplate?.id ?? "new"}
            template={editingTemplate}
            items={loaderData.allItems}
            errors={
              actionData && !actionData.ok && actionData.intent === "save-template" ? actionData.errors : {}
            }
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function SubmitButton({
  form,
  intent,
  children,
}: {
  form: string;
  intent: string;
  children: React.ReactNode;
}) {
  const navigation = useNavigation();
  return (
    <Button
      type="submit"
      form={form}
      size="lg"
      className="w-full"
      loading={navigation.formData?.get("intent") === intent}
    >
      {children}
    </Button>
  );
}

function ItemsView({
  items,
  query,
  type,
  archived,
  totalItems,
  hasMore,
  limit,
  params,
  onOpen,
}: Route.ComponentProps["loaderData"] & { params: URLSearchParams; onOpen: (id: string) => void }) {
  const submit = useSubmit();
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const filterLink = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    p.delete("item");
    return `?${p}`;
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 wide:flex-row wide:items-center">
        <Form
          method="get"
          role="search"
          className="flex-1"
          onChange={(e) => {
            const form = e.currentTarget;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => submit(form, { replace: true, preventScrollReset: true }), 250);
          }}
        >
          {type && <input type="hidden" name="type" value={type} />}
          {archived && <input type="hidden" name="archived" value="1" />}
          <label className="relative block">
            <span className="sr-only">Search catalogue</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-secondary"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search name, supplier or SKU"
              className="h-11 w-full rounded-control border border-tertiary bg-surface pr-3 pl-10 text-body placeholder:text-secondary"
            />
          </label>
        </Form>
        <nav aria-label="Filter by type" className="flex flex-wrap gap-2">
          <Link
            to={filterLink({ type: null })}
            aria-current={!type ? "true" : undefined}
            className={cn(
              "inline-flex h-11 items-center rounded-full border px-4 font-semibold",
              !type ? "border-sage-base bg-sage-tint text-sage-ink" : "border-border bg-surface",
            )}
          >
            All
          </Link>
          {ITEM_TYPES.map((t) => (
            <Link
              key={t}
              to={filterLink({ type: t })}
              aria-current={type === t ? "true" : undefined}
              className={cn(
                "inline-flex h-11 items-center rounded-full border px-2",
                type === t ? "border-sage-base bg-sage-tint" : "border-border bg-surface",
              )}
            >
              <ItemTypeChip type={t} />
            </Link>
          ))}
          <Link
            to={filterLink({ archived: archived ? null : "1" })}
            className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 font-semibold text-sage-ink hover:bg-sage-tint"
          >
            <Archive className="size-4" aria-hidden />
            {archived ? "Active" : "Archived"}
          </Link>
        </nav>
      </div>

      {items.length === 0 ? (
        totalItems === 0 && !archived ? (
          <EmptyState
            icon={Library}
            tone="sage"
            title="Your catalogue is empty"
            description="Add the services, fabrics, fees and allowances you quote most. They drop into quotes with their price and taxes."
            action={
              <Button asChild variant="tinted">
                <Link to={filterLink({ item: "new" })}>
                  <Plus aria-hidden />
                  Add your first item
                </Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Search}
            tone="sage"
            title="No items match"
            description="Try another word, or clear the filters."
            action={
              <Button asChild variant="secondary">
                <Link to="?">Clear filters</Link>
              </Button>
            }
          />
        )
      ) : (
        <ul
          className="grid gap-3 tablet:grid-cols-2 wide:grid-cols-3 desktop:grid-cols-4"
          aria-label="Catalogue items"
        >
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex h-full w-full items-center gap-3 rounded-card border border-border bg-surface p-3 text-left shadow-card transition-transform duration-fast ease-out active:scale-[0.99] tablet:flex-col tablet:items-stretch"
              >
                <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control bg-sage-tint tablet:aspect-[4/3] tablet:h-auto tablet:w-full">
                  {item.photoUrl ? (
                    <img src={item.photoUrl} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <Library className="size-7 text-sage-base" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <ItemTypeChip type={item.type} />
                  <span className="mt-1 block truncate font-semibold">{item.name}</span>
                  <span className="block text-label font-normal text-secondary">
                    <MoneyText cents={item.priceCents} /> / {item.unit}
                    {item.archivedAt && " · archived"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary">
            <Link to={filterLink({ show: String(limit + ITEM_PAGE_SIZE) })} preventScrollReset replace>
              Show more
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}

function ItemExtras({
  item,
  errors,
}: {
  item: Route.ComponentProps["loaderData"]["items"][number];
  errors: FieldErrors;
}) {
  const navigation = useNavigation();
  const pending = navigation.formData?.get("intent");
  return (
    <div className="mt-6 flex flex-col gap-4 border-t border-border pt-4">
      <div>
        <p className="mb-2 text-label font-semibold">Photo</p>
        <div className="flex items-center gap-3">
          <span className="flex size-20 items-center justify-center overflow-hidden rounded-control bg-sage-tint">
            {item.photoUrl ? (
              <img src={item.photoUrl} alt={`Photo of ${item.name}`} className="size-full object-cover" />
            ) : (
              <Library className="size-7 text-sage-base" aria-hidden />
            )}
          </span>
          <Form method="post" encType="multipart/form-data" className="flex flex-1 flex-col gap-2">
            <input type="hidden" name="intent" value="photo" />
            <input type="hidden" name="id" value={item.id} />
            <label htmlFor="item-photo" className="sr-only">
              Choose a photo
            </label>
            <input
              id="item-photo"
              name="photo"
              type="file"
              accept="image/*"
              className="block w-full text-label file:mr-3 file:h-11 file:rounded-control file:border-0 file:bg-sage-tint file:px-4 file:font-semibold file:text-sage-ink"
            />
            {errors.photo && (
              <p role="alert" className="text-label font-semibold text-danger-ink">
                {errors.photo}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" loading={pending === "photo"}>
                {pending !== "photo" && <ImageUp aria-hidden />}
                Upload
              </Button>
            </div>
          </Form>
        </div>
        {item.photoKey && (
          <Form method="post" className="mt-2">
            <input type="hidden" name="intent" value="remove-photo" />
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" variant="ghost" loading={pending === "remove-photo"}>
              <Trash2 aria-hidden />
              Remove photo
            </Button>
          </Form>
        )}
      </div>
      <Form method="post">
        <input type="hidden" name="intent" value={item.archivedAt ? "restore-item" : "archive-item"} />
        <input type="hidden" name="id" value={item.id} />
        <Button
          type="submit"
          variant="ghost"
          loading={pending === "archive-item" || pending === "restore-item"}
        >
          {item.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {item.archivedAt ? "Restore item" : "Archive item"}
        </Button>
      </Form>
    </div>
  );
}

function TemplatesView({
  templates,
  onOpen,
}: {
  templates: Route.ComponentProps["loaderData"]["templates"];
  onOpen: (id: string) => void;
}) {
  if (templates.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        tone="sage"
        title="No room templates yet"
        description="Save a set of items you often quote together, like a Primary bedroom refresh, and add it to a quote in one tap."
        action={
          <Button variant="tinted" onClick={() => onOpen("new")}>
            <Plus aria-hidden />
            Create a template
          </Button>
        }
      />
    );
  }
  return (
    <ul className="grid gap-3 tablet:grid-cols-2 desktop:grid-cols-3" aria-label="Room templates">
      {templates.map((t) => {
        const hue = (HUES as readonly string[]).includes(t.color)
          ? (t.color as (typeof HUES)[number])
          : "sage";
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onOpen(t.id)}
              className={cn(
                "flex min-h-36 w-full flex-col justify-between gap-3 rounded-sheet p-4 text-left transition-transform duration-fast ease-out active:scale-[0.99]",
                TONE[hue].soft,
              )}
            >
              <IconChip icon={LayoutTemplate} tone={hue} filled size="lg" />
              <span>
                <span className="block font-display text-section">{t.name}</span>
                <span className="block text-label font-normal">
                  {t.lines.length} item{t.lines.length === 1 ? "" : "s"}
                  {t.lines.length > 0 &&
                    `: ${t.lines
                      .slice(0, 3)
                      .map((l) => l.name)
                      .join(", ")}${t.lines.length > 3 ? "…" : ""}`}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TemplateForm({
  template,
  items,
  errors,
}: {
  template: Route.ComponentProps["loaderData"]["templates"][number] | null;
  items: Route.ComponentProps["loaderData"]["allItems"];
  errors: FieldErrors;
}) {
  const [color, setColor] = React.useState(template?.color ?? "sage");
  const [lines, setLines] = React.useState(
    (template?.lines ?? []).map((l) => ({ itemId: l.itemId, qty: formatQuantity(l.qtyMilli) })),
  );
  const [adding, setAdding] = React.useState("");
  const navigation = useNavigation();
  const byId = new Map(items.map((i) => [i.id, i]));

  return (
    <>
      <Form id="template-form" method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="save-template" />
        {template && <input type="hidden" name="id" value={template.id} />}
        <TextField
          label="Name"
          name="name"
          defaultValue={template?.name ?? ""}
          required
          error={errors.name}
          placeholder="e.g. Primary bedroom refresh"
        />
        <fieldset>
          <legend className="mb-1.5 text-label font-semibold">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {HUES.map((hue) => (
              <label key={hue} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  value={hue}
                  checked={color === hue}
                  onChange={() => setColor(hue)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "block size-11 rounded-full ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-teal-base",
                    TONE[hue].base,
                  )}
                />
                <span className="sr-only">{PALETTE[hue].label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <p className="mb-1.5 text-label font-semibold">Items</p>
          {lines.length === 0 && <p className="mb-2 text-secondary">No items yet. Add some below.</p>}
          <ol className="flex flex-col gap-2">
            {lines.map((line, index) => {
              const item = byId.get(line.itemId);
              return (
                <li
                  key={`${line.itemId}-${index}`}
                  className="flex items-center gap-2 rounded-card border border-border p-2"
                >
                  <input type="hidden" name="lines" value={`${line.itemId}:${line.qty}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{item?.name ?? "Removed item"}</span>
                    {item && (
                      <span className="text-label font-normal text-secondary">
                        <MoneyText cents={item.priceCents} /> / {item.unit}
                      </span>
                    )}
                  </span>
                  <label className="sr-only" htmlFor={`qty-${index}`}>
                    Quantity for {item?.name}
                  </label>
                  <input
                    id={`qty-${index}`}
                    value={line.qty}
                    onChange={(e) =>
                      setLines((ls) => ls.map((l, i) => (i === index ? { ...l, qty: e.target.value } : l)))
                    }
                    inputMode="decimal"
                    className="h-11 w-20 rounded-control border border-tertiary bg-surface px-2 text-right tabular"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${item?.name ?? "item"}`}
                    onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ol>
          {errors.lines && (
            <p role="alert" className="mt-2 text-label font-semibold text-danger-ink">
              {errors.lines}
            </p>
          )}
        </div>
      </Form>
      <div className="mt-3 flex items-end gap-2">
        <Select
          label="Add an item"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          fieldClassName="flex-1"
        >
          <option value="">Choose…</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="secondary"
          disabled={!adding}
          onClick={() => {
            setLines((ls) => [...ls, { itemId: adding, qty: "1" }]);
            setAdding("");
          }}
        >
          <Plus aria-hidden />
          Add
        </Button>
      </div>
      {template && (
        <Form method="post" className="mt-6 border-t border-border pt-4">
          <input type="hidden" name="intent" value="archive-template" />
          <input type="hidden" name="id" value={template.id} />
          <Button
            type="submit"
            variant="ghost"
            loading={navigation.formData?.get("intent") === "archive-template"}
          >
            <Trash2 aria-hidden />
            Remove template
          </Button>
        </Form>
      )}
    </>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
