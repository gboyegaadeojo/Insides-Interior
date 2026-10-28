import { FolderKanban, Plus } from "lucide-react";
import * as React from "react";
import {
  data,
  Form,
  Link,
  Outlet,
  redirect,
  useActionData,
  useLocation,
  useNavigation,
  useSearchParams,
} from "react-router";
import { ModuleHeader } from "~/components/shell/module-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Button } from "~/components/ui/button";
import { TextField } from "~/components/ui/field";
import { ProjectProgressBar } from "~/components/ui/progress-bar";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { EmptyState } from "~/components/ui/states";
import { MoneyText } from "~/components/ui/text";
import { formatCents } from "~/domain/money";
import { ClientCombobox } from "~/features/clients/ui/client-combobox";
import { projectSchema } from "~/features/projects/schema";
import { createProject, listProjects, PROJECT_PAGE_SIZE, projectSummary } from "~/features/projects/service";
import { SiteSelect } from "~/features/projects/ui/site-select";
import { ServiceError } from "~/features/settings/service";
import { type FieldErrors, parseForm } from "~/lib/form";
import type { AppHandle } from "~/lib/route-handle";
import { useSearchSheet } from "~/lib/use-search-sheet";
import { signedFileUrl } from "~/server/files";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.projects";

export const handle: AppHandle = { module: "projects", title: "Projects" };

export function meta() {
  return [{ title: "Projects · Insides Interior" }];
}

const FILTERS = ["active", "completed", "archived"] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const url = new URL(request.url);
  const status = FILTERS.find((f) => f === url.searchParams.get("status")) ?? "active";
  const limit = Math.max(PROJECT_PAGE_SIZE, Number(url.searchParams.get("show")) || 0);
  const [rows, summary] = await Promise.all([
    listProjects(ctx, { status, limit: limit + 1 }),
    projectSummary(ctx, { status }),
  ]);
  return {
    status,
    summary,
    hasMore: rows.length > limit,
    limit,
    projects: await Promise.all(
      rows.slice(0, limit).map(async (p) => ({
        ...p,
        coverUrl: p.coverPhotoKey ? await signedFileUrl(ctx.env, p.coverPhotoKey) : null,
      })),
    ),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const parsed = parseForm(projectSchema, await request.formData());
  if (!parsed.ok) return data({ errors: parsed.errors }, { status: 400 });
  try {
    const id = await createProject(ctx, parsed.data);
    return redirect(`/projects/${id}`);
  } catch (error) {
    if (error instanceof ServiceError)
      return data({ errors: { [error.field]: error.message } }, { status: 400 });
    throw error;
  }
}

export default function Projects({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const sheet = useSearchSheet("new");
  const actionData = useActionData<{ errors: FieldErrors }>();
  const navigation = useNavigation();
  const [clientId, setClientId] = React.useState<string | null>(params.get("client"));

  if (pathname !== "/projects" && pathname !== "/projects/") return <Outlet />;

  const { summary } = loaderData;

  return (
    <>
      <ModuleHeader
        eyebrow="Projects"
        summary={
          summary.count === 0
            ? "No projects here"
            : `${summary.count} ${loaderData.status} · ${formatCents(summary.contractCents)} contracted · ${formatCents(summary.toBillCents)} to bill`
        }
        action={
          <Button size="lg" variant="tinted" onClick={() => sheet.show()}>
            <Plus aria-hidden />
            New project
          </Button>
        }
      />
      <SegmentedControl
        label="Project status"
        className="mb-4"
        value={loaderData.status}
        onValueChange={(status) =>
          setParams(status === "active" ? {} : { status }, { preventScrollReset: true })
        }
        segments={[
          { value: "active", label: "Active" },
          { value: "completed", label: "Completed" },
          { value: "archived", label: "Archived" },
        ]}
      />
      {loaderData.projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          tone="saffron"
          title={loaderData.status === "active" ? "No active projects" : `No ${loaderData.status} projects`}
          description="Approving a quote creates a project automatically. You can also start one for a client yourself."
          action={
            loaderData.status === "active" ? (
              <Button variant="tinted" onClick={() => sheet.show()}>
                <Plus aria-hidden />
                Start a project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3" aria-label="Projects">
          {loaderData.projects.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="block overflow-hidden rounded-card border border-border bg-surface shadow-card transition-transform duration-fast ease-out active:scale-[0.99]"
              >
                <div className="aspect-[16/7] bg-gradient-to-br from-saffron-tint to-surface">
                  {p.coverUrl && (
                    <img src={p.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
                  )}
                </div>
                <div className="flex flex-col gap-2 p-4">
                  <span className="font-display text-section">{p.name}</span>
                  <span className="text-label font-normal text-secondary">
                    {p.clientName}
                    {p.siteLabel && ` · ${p.siteLabel}`}
                  </span>
                  <span className="flex items-baseline justify-between">
                    <span className="text-label font-semibold text-secondary">Contract</span>
                    <MoneyText cents={p.contractCents} className="font-semibold" />
                  </span>
                  <ProjectProgressBar {...p.progress} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {loaderData.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary">
            <Link
              to={`?${new URLSearchParams({ ...Object.fromEntries(params), show: String(loaderData.limit + PROJECT_PAGE_SIZE) })}`}
              preventScrollReset
              replace
            >
              Show more
            </Link>
          </Button>
        </div>
      )}

      <Sheet open={sheet.open} onOpenChange={sheet.onOpenChange}>
        <SheetContent
          title="New project"
          description="A job for one client and site. Quotes, invoices and expenses attach to it."
          footer={
            <Button
              type="submit"
              form="new-project"
              size="lg"
              className="w-full"
              loading={navigation.state !== "idle" && navigation.formAction === "/projects"}
            >
              Create project
            </Button>
          }
        >
          <Form id="new-project" method="post" action="/projects" className="flex flex-col gap-4">
            <TextField
              label="Project name"
              name="name"
              required
              error={actionData?.errors.name}
              placeholder="e.g. Main floor drapery"
            />
            <ClientCombobox
              defaultValue={clientId}
              onChange={setClientId}
              error={actionData?.errors.clientId}
            />
            <SiteSelect clientId={clientId} error={actionData?.errors.siteId} />
          </Form>
        </SheetContent>
      </Sheet>
    </>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
