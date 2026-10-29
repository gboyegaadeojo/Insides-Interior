import { Camera, FileText, Plus, Receipt as ReceiptIcon, Search, Tag, Trash2, Wallet } from "lucide-react";
import * as React from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { DateField, Select, Textarea, TextField } from "~/components/ui/field";
import { type Receipt, ReceiptViewer } from "~/components/ui/receipt-viewer";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { EmptyState } from "~/components/ui/states";
import { MoneyText } from "~/components/ui/text";
import { toast } from "~/components/ui/toast";
import { ToneChip } from "~/components/ui/tone-chip";
import { CURRENCY_SYMBOL } from "~/domain/locale";
import { formatCents, formatCentsPlain } from "~/domain/money";
import { expenseNetCents } from "~/domain/reports";
import {
  categoryOf,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY,
  EXPENSE_PAGE_SIZE,
  type ExpenseCategory,
} from "~/features/expenses/constants";
import { billExpensesSchema, expenseSchema } from "~/features/expenses/schema";
import {
  billExpenses,
  createExpense,
  deleteExpense,
  expenseProjects,
  expenseSummary,
  listExpenses,
  updateExpense,
} from "~/features/expenses/service";
import { ReceiptField } from "~/features/expenses/ui/receipt-field";
import { ServiceError } from "~/features/settings/service";
import { businessToday, formatDate } from "~/lib/dates";
import { type FieldErrors, parseForm } from "~/lib/form";
import type { AppHandle } from "~/lib/route-handle";
import { useSearchSheet } from "~/lib/use-search-sheet";
import { cn } from "~/lib/utils";
import { signedFileUrl } from "~/server/files";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.expenses";

export const handle: AppHandle = { module: "expenses", title: "Expenses" };

export function meta() {
  return [{ title: "Expenses · Insides Interior" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const category = EXPENSE_CATEGORIES.find((c) => c === url.searchParams.get("category")) ?? null;
  const projectId = url.searchParams.get("project") || null;
  const query = url.searchParams.get("q") ?? "";
  const limit = Math.max(EXPENSE_PAGE_SIZE, Number(url.searchParams.get("show")) || 0);
  const filters = { category, projectId, query };
  const [list, summary, all, projects, unbilled] = await Promise.all([
    listExpenses(ctx, { ...filters, limit }),
    expenseSummary(ctx, filters),
    expenseSummary(ctx),
    expenseProjects(ctx),
    listExpenses(ctx, { unbilled: true, limit: 200 }),
  ]);
  const expenses = await Promise.all(
    list.expenses.map(async (e) => ({
      ...e,
      receiptUrl: e.receiptKey ? await signedFileUrl(ctx.env, e.receiptKey) : null,
      receiptPdf: e.receiptKey?.endsWith(".pdf") ?? false,
    })),
  );
  // "Ready to bill": billable expenses not yet on a live invoice, by project (FR-EXP-02).
  const ready = new Map<
    string,
    { projectId: string; projectName: string; clientName: string; ids: string[]; cents: number }
  >();
  for (const e of unbilled.expenses) {
    if (!e.projectId) continue;
    const group = ready.get(e.projectId) ?? {
      projectId: e.projectId,
      projectName: e.projectName ?? "Project",
      clientName: e.clientName ?? "",
      ids: [],
      cents: 0,
    };
    group.ids.push(e.id);
    group.cents += expenseNetCents(e);
    ready.set(e.projectId, group);
  }
  return {
    expenses,
    hasMore: list.hasMore,
    limit,
    summary,
    totalCount: all.count,
    monthNetCents: all.monthNetCents,
    projects,
    category,
    projectId,
    query,
    today: businessToday(),
    ready: [...ready.values()],
    unbilled: unbilled.expenses.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      supplier: e.supplier,
      date: e.date,
      netCents: expenseNetCents(e),
    })),
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
      case "create":
      case "update": {
        const parsed = parseForm(expenseSchema, form);
        if (!parsed.ok) return fail(parsed.errors);
        if (intent === "create") await createExpense(ctx, parsed.data);
        else await updateExpense(ctx, id, parsed.data);
        return done(intent === "create" ? "Expense saved" : "Expense updated");
      }
      case "delete":
        await deleteExpense(ctx, id);
        return done("Expense deleted");
      case "bill": {
        const parsed = parseForm(billExpensesSchema, form, ["expenseIds"]);
        if (!parsed.ok) return fail(parsed.errors);
        const invoiceId = await billExpenses(ctx, parsed.data);
        return redirect(`/invoices/${invoiceId}`);
      }
      default:
        throw new Response("Unknown action", { status: 400 });
    }
  } catch (error) {
    if (error instanceof ServiceError)
      return fail({ [error.field === "receipt" ? "receiptKey" : error.field]: error.message });
    throw error;
  }
}

type Row = Route.ComponentProps["loaderData"]["expenses"][number];

export default function Expenses({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const actionData = useActionData<Result>();
  const sheet = useSearchSheet("expense");
  const bill = useSearchSheet("bill");
  const [viewer, setViewer] = React.useState<number | null>(null);
  const [cameraFile, setCameraFile] = React.useState<File | null>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const lastResult = React.useRef<Result | undefined>(undefined);

  React.useEffect(() => {
    if (!actionData || actionData === lastResult.current) return;
    lastResult.current = actionData;
    if (!actionData.ok) return;
    toast(actionData.message, { tone: "success" });
    sheet.onOpenChange(false);
  }, [actionData, sheet]);

  const editing = loaderData.expenses.find((e) => e.id === sheet.value) ?? null;
  const withReceipts = loaderData.expenses.filter((e) => e.receiptUrl);
  const receipts: Receipt[] = withReceipts.map((e) => ({
    url: e.receiptUrl!,
    title: `${e.supplier}, ${formatDate(e.date)}`,
    pdf: e.receiptPdf,
  }));
  const billing = loaderData.ready.find((g) => g.projectId === bill.value) ?? null;
  const filtered = Boolean(loaderData.category || loaderData.projectId || loaderData.query);

  /** DS-SCR Expenses: "Log expense" opens the camera first on touch devices. */
  function logExpense() {
    setCameraFile(null);
    if (window.matchMedia("(pointer: coarse)").matches) cameraRef.current?.click();
    sheet.show("new");
  }

  return (
    <>
      <ModuleHeader
        eyebrow="Expenses"
        summary={
          loaderData.totalCount === 0
            ? "Nothing logged yet"
            : `${formatCents(loaderData.monthNetCents)} spent this month, before VAT`
        }
        action={
          <Button size="lg" variant="tinted" onClick={logExpense}>
            <Camera aria-hidden />
            Log expense
          </Button>
        }
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) setCameraFile(file);
        }}
      />

      {loaderData.ready.length > 0 && (
        <section
          aria-labelledby="ready-heading"
          className="mb-5 rounded-card border border-border bg-surface p-4 shadow-card"
        >
          <h2 id="ready-heading" className="font-semibold">
            Ready to bill
          </h2>
          <ul className="mt-2 divide-y divide-border">
            {loaderData.ready.map((g) => (
              <li key={g.projectId} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{g.projectName}</span>
                  <span className="block text-label text-secondary">
                    {g.clientName} · {g.ids.length} expense{g.ids.length === 1 ? "" : "s"} ·{" "}
                    {formatCents(g.cents)} at cost
                  </span>
                </span>
                <Button variant="secondary" onClick={() => bill.show(g.projectId)}>
                  Add to invoice
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loaderData.totalCount > 0 && <Filters {...loaderData} params={params} />}

      {loaderData.expenses.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Search}
            tone="roseclay"
            title="No expenses match"
            description="Try another word, or clear the filters."
            action={
              <Button asChild variant="secondary">
                <Link to="/expenses">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Wallet}
            tone="roseclay"
            title="No expenses yet"
            description="Photograph a receipt as you pay. Tag it to a project and bill it on the client's next invoice."
            action={
              <Button variant="tinted" onClick={logExpense}>
                <Camera aria-hidden />
                Log your first expense
              </Button>
            }
          />
        )
      ) : (
        <>
          {filtered && (
            <p className="mb-3 text-label text-secondary">
              {loaderData.summary.count} expense{loaderData.summary.count === 1 ? "" : "s"} ·{" "}
              {formatCents(loaderData.summary.netCents)} before VAT
            </p>
          )}
          <ul
            className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card"
            aria-label="Expenses"
          >
            {loaderData.expenses.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                onOpen={() => sheet.show(e.id)}
                onReceipt={() => setViewer(withReceipts.findIndex((x) => x.id === e.id))}
              />
            ))}
          </ul>
        </>
      )}
      {loaderData.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary">
            <Link
              to={`?${new URLSearchParams({ ...Object.fromEntries(params), show: String(loaderData.limit + EXPENSE_PAGE_SIZE) })}`}
              preventScrollReset
              replace
            >
              Show more
            </Link>
          </Button>
        </div>
      )}

      <ReceiptViewer
        receipts={receipts}
        index={viewer}
        onIndexChange={setViewer}
        onClose={() => setViewer(null)}
      />

      <Sheet open={sheet.open} onOpenChange={sheet.onOpenChange}>
        <SheetContent
          title={editing ? "Edit expense" : "Log expense"}
          description={
            editing ? undefined : "Amounts in naira. VAT is the part of the amount that was VAT, if any."
          }
        >
          <ExpenseForm
            key={editing?.id ?? `new-${cameraFile?.name ?? ""}`}
            expense={editing}
            projects={loaderData.projects}
            today={loaderData.today}
            pendingFile={editing ? null : cameraFile}
            defaultProject={loaderData.projectId}
            errors={
              actionData && !actionData.ok && ["create", "update", "delete"].includes(actionData.intent)
                ? actionData.errors
                : {}
            }
          />
        </SheetContent>
      </Sheet>

      <Sheet open={bill.open} onOpenChange={bill.onOpenChange}>
        <SheetContent
          title="Add expenses to an invoice"
          description="They go on this project's draft invoice as lines you can still edit. Nothing is sent."
        >
          {billing ? (
            <BillForm
              group={billing}
              expenses={loaderData.unbilled.filter((e) => e.projectId === billing.projectId)}
              errors={actionData && !actionData.ok && actionData.intent === "bill" ? actionData.errors : {}}
            />
          ) : (
            <p className="text-secondary">Nothing left to bill on this project.</p>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Filters({
  category,
  projectId,
  query,
  projects,
  params,
}: Route.ComponentProps["loaderData"] & { params: URLSearchParams }) {
  const submit = useSubmit();
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <Form
      method="get"
      role="search"
      className="mb-4 grid gap-3 tablet:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      onChange={(e) => {
        const form = e.currentTarget;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => submit(form, { replace: true, preventScrollReset: true }), 250);
      }}
    >
      {params.get("show") && <input type="hidden" name="show" value={params.get("show")!} />}
      <label className="relative block self-end">
        <span className="sr-only">Search expenses</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-secondary"
          aria-hidden
        />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search supplier or note"
          className="h-11 w-full rounded-control border border-tertiary bg-surface pr-3 pl-10 text-body placeholder:text-secondary"
        />
      </label>
      <Select label="Category" name="category" defaultValue={category ?? ""} fieldClassName="min-w-0">
        <option value="">All categories</option>
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {EXPENSE_CATEGORY[c].label}
          </option>
        ))}
      </Select>
      <Select label="Project" name="project" defaultValue={projectId ?? ""} fieldClassName="min-w-0">
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </Form>
  );
}

function ExpenseRow({
  expense: e,
  onOpen,
  onReceipt,
}: {
  expense: Row;
  onOpen: () => void;
  onReceipt: () => void;
}) {
  const cat = categoryOf(e.category);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 tablet:px-4">
      {e.receiptUrl ? (
        <button
          type="button"
          onClick={onReceipt}
          className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-control bg-roseclay-tint outline-offset-2"
          aria-label={`View receipt from ${e.supplier}`}
        >
          {e.receiptPdf ? (
            <FileText className="size-6 text-roseclay-base" aria-hidden />
          ) : (
            <img src={e.receiptUrl} alt="" loading="lazy" className="size-full object-cover" />
          )}
        </button>
      ) : (
        <span
          className="flex size-14 shrink-0 items-center justify-center rounded-control bg-surface-2"
          title="No receipt"
        >
          <ReceiptIcon className="size-6 text-tertiary" aria-hidden />
          <span className="sr-only">No receipt</span>
        </span>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{e.supplier}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <ToneChip tone={cat.tone} label={cat.label} icon={Tag} />
            {e.billed ? (
              <ToneChip
                tone="indigo"
                label={`Billed${e.billedInvoiceNumber ? ` on ${e.billedInvoiceNumber}` : " (draft)"}`}
              />
            ) : (
              e.billable && <ToneChip tone="saffron" label="Billable" />
            )}
          </span>
          <span className="mt-0.5 block truncate text-label text-secondary">
            {formatDate(e.date)}
            {e.projectName && ` · ${e.projectName}`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <MoneyText cents={e.amountCents} className="block font-semibold" />
          {e.vatCents > 0 && (
            <span className="block text-label text-secondary">
              VAT <MoneyText cents={e.vatCents} />
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function ExpenseForm({
  expense,
  projects,
  today,
  pendingFile,
  defaultProject,
  errors,
}: {
  expense: Row | null;
  projects: Route.ComponentProps["loaderData"]["projects"];
  today: string;
  pendingFile: File | null;
  defaultProject: string | null;
  errors: FieldErrors;
}) {
  const navigation = useNavigation();
  const pending = navigation.formData?.get("intent");
  const [uploading, setUploading] = React.useState(false);
  const [projectId, setProjectId] = React.useState(expense?.projectId ?? defaultProject ?? "");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const submit = useSubmit();
  const money = (cents: number | undefined) => (cents ? formatCentsPlain(cents) : "");

  return (
    <>
      <Form method="post" className="flex flex-col gap-4" id="expense-form">
        <input type="hidden" name="intent" value={expense ? "update" : "create"} />
        {expense && <input type="hidden" name="id" value={expense.id} />}
        <ReceiptField
          initial={
            expense?.receiptUrl
              ? { key: expense.receiptKey!, url: expense.receiptUrl, pdf: expense.receiptPdf }
              : null
          }
          pendingFile={pendingFile}
          error={errors.receiptKey}
          onBusyChange={setUploading}
        />
        <div className="grid gap-4 tablet:grid-cols-2">
          <TextField
            label="Supplier"
            name="supplier"
            required
            defaultValue={expense?.supplier ?? ""}
            placeholder="e.g. Balogun Market"
            error={errors.supplier}
            autoComplete="off"
          />
          <DateField
            label="Date paid"
            name="date"
            required
            defaultValue={expense?.date ?? today}
            max={today}
            error={errors.date}
          />
          <TextField
            label={`Amount paid (${CURRENCY_SYMBOL})`}
            name="amountCents"
            required
            inputMode="decimal"
            defaultValue={money(expense?.amountCents)}
            placeholder="12,500.00"
            hint="The total on the receipt, VAT included."
            error={errors.amountCents}
            className="text-right tabular"
          />
          <TextField
            label={`VAT paid (${CURRENCY_SYMBOL})`}
            name="vatCents"
            inputMode="decimal"
            defaultValue={money(expense?.vatCents)}
            placeholder="0.00"
            hint="Leave empty if the receipt shows no VAT."
            error={errors.vatCents}
            className="text-right tabular"
          />
          <Select
            label="Category"
            name="category"
            required
            defaultValue={expense?.category ?? ""}
            error={errors.category}
          >
            <option value="" disabled>
              Choose…
            </option>
            {EXPENSE_CATEGORIES.map((c: ExpenseCategory) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY[c].label}
              </option>
            ))}
          </Select>
          <Select
            label="Project"
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            error={errors.projectId}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.clientName})
              </option>
            ))}
          </Select>
        </div>
        <label className={cn("flex min-h-11 items-start gap-3", !projectId && "text-secondary")}>
          <input
            type="checkbox"
            name="billable"
            defaultChecked={expense?.billable ?? false}
            disabled={!projectId}
            className="mt-0.5 size-5 accent-[var(--teal-base)]"
          />
          <span>
            <span className="block font-semibold">Bill this to the client</span>
            <span className="block text-label text-secondary">
              {projectId
                ? "Add it to the project's next invoice, at cost or with a markup."
                : "Choose a project first."}
            </span>
          </span>
        </label>
        <Textarea
          label="Note"
          name="note"
          defaultValue={expense?.note ?? ""}
          error={errors.note}
          className="min-h-20"
        />
        {errors.form && (
          <p role="alert" className="text-label font-semibold text-danger-ink">
            {errors.form}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={uploading}
          loading={pending === "create" || pending === "update"}
        >
          {uploading ? "Waiting for the receipt…" : "Save expense"}
        </Button>
      </Form>
      {expense && (
        <div className="mt-6 border-t border-border pt-4">
          {expense.billed ? (
            <p className="text-label text-secondary">
              On invoice{" "}
              <Link
                to={`/invoices/${expense.billedInvoiceId}`}
                className="font-semibold text-indigo-ink underline"
              >
                {expense.billedInvoiceNumber ?? "draft"}
              </Link>
              . Remove its line there to change the amount or delete it.
            </p>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              loading={pending === "delete"}
            >
              <Trash2 aria-hidden />
              Delete expense
            </Button>
          )}
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete this expense?"
            description={`${expense.supplier}, ${formatCents(expense.amountCents)} on ${formatDate(expense.date)}. It leaves your reports; the receipt is kept.`}
            confirmLabel="Delete expense"
            destructive
            onConfirm={() => submit({ intent: "delete", id: expense.id }, { method: "post" })}
          />
        </div>
      )}
    </>
  );
}

function BillForm({
  group,
  expenses,
  errors,
}: {
  group: Route.ComponentProps["loaderData"]["ready"][number];
  expenses: Route.ComponentProps["loaderData"]["unbilled"];
  errors: FieldErrors;
}) {
  const navigation = useNavigation();
  return (
    <Form method="post" className="flex flex-col gap-4">
      <input type="hidden" name="intent" value="bill" />
      <p>
        <span className="font-semibold">{group.projectName}</span>
        <span className="text-secondary"> · {group.clientName}</span>
      </p>
      <fieldset>
        <legend className="mb-2 text-label font-semibold">Expenses</legend>
        <ul className="flex flex-col gap-2">
          {expenses.map((e) => (
            <li key={e.id}>
              <label className="flex min-h-11 items-center gap-3 rounded-card border border-border px-3 py-2">
                <input type="checkbox" name="expenseIds" value={e.id} defaultChecked className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{e.supplier}</span>
                  <span className="block text-label text-secondary">{formatDate(e.date)}</span>
                </span>
                <MoneyText cents={e.netCents} />
              </label>
            </li>
          ))}
        </ul>
        {errors.expenseIds && (
          <p role="alert" className="mt-2 text-label font-semibold text-danger-ink">
            {errors.expenseIds}
          </p>
        )}
      </fieldset>
      <TextField
        label="Markup (%)"
        name="markupBp"
        inputMode="decimal"
        defaultValue="0"
        hint="0 bills at cost (amount less VAT). 15 adds 15%."
        error={errors.markupBp}
        className="text-right tabular"
      />
      {errors.form && (
        <p role="alert" className="text-label font-semibold text-danger-ink">
          {errors.form}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={navigation.formData?.get("intent") === "bill"}
      >
        <Plus aria-hidden />
        Add to draft invoice
      </Button>
    </Form>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
