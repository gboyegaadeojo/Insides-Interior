import { Archive, CheckCircle2, ChevronLeft, FileText, History, ImageUp, RotateCcw } from "lucide-react";
import { shrinkInputFile } from "~/lib/shrink-image";
import * as React from "react";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ProjectProgressBar } from "~/components/ui/progress-bar";
import { EmptyState } from "~/components/ui/states";
import { StatusBadge } from "~/components/ui/status-badge";
import { MoneyText } from "~/components/ui/text";
import { toast } from "~/components/ui/toast";
import { formatAddress } from "~/features/clients/service";
import { projectStatusSchema } from "~/features/projects/schema";
import { getProject, saveProjectCover, setProjectStatus } from "~/features/projects/service";
import { ServiceError } from "~/features/settings/service";
import { activityLabel, relativeTime } from "~/lib/activity-label";
import { parseForm } from "~/lib/form";
import type { AppHandle } from "~/lib/route-handle";
import { signedFileUrl } from "~/server/files";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/_app.projects.$id";

export const handle: AppHandle = { module: "projects", title: "Project" };

export function meta({ data: d }: Route.MetaArgs) {
  return [{ title: `${d?.project.name ?? "Project"} · Insides Interior` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const detail = await getProject(ctx, params.id);
  if (!detail) throw new Response("Not found", { status: 404 });
  return {
    ...detail,
    coverUrl: detail.project.coverPhotoKey
      ? await signedFileUrl(ctx.env, detail.project.coverPhotoKey)
      : null,
  };
}

type Result = { ok: true; message: string } | { ok: false; error: string };

export async function action({ request, params, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "cover") {
      const file = form.get("cover");
      if (!(file instanceof File) || file.size === 0)
        return data<Result>({ ok: false, error: "Choose a photo" }, { status: 400 });
      await saveProjectCover(ctx, params.id, file);
      return data<Result>({ ok: true, message: "Cover photo updated" });
    }
    const parsed = parseForm(projectStatusSchema, form);
    if (!parsed.ok) throw new Response("Unknown action", { status: 400 });
    await setProjectStatus(ctx, params.id, parsed.data.status);
    const words = {
      active: "Project reopened",
      completed: "Project marked complete",
      archived: "Project archived",
    } as const;
    return data<Result>({ ok: true, message: words[parsed.data.status] });
  } catch (error) {
    if (error instanceof ServiceError)
      return data<Result>({ ok: false, error: error.message }, { status: 400 });
    throw error;
  }
}

export default function ProjectDetail({ loaderData }: Route.ComponentProps) {
  const {
    project,
    clientName,
    site,
    progress,
    contractCents,
    invoicedCents,
    paidCents,
    expensesCents,
    marginCents,
    quotes,
    invoices,
    activity,
    coverUrl,
  } = loaderData;
  const actionData = useActionData<Result>();
  const navigation = useNavigation();
  const pending = navigation.formData?.get("intent") ?? navigation.formData?.get("status");
  const last = React.useRef<Result | undefined>(undefined);

  React.useEffect(() => {
    if (!actionData || actionData === last.current) return;
    last.current = actionData;
    toast(actionData.ok ? actionData.message : actionData.error, {
      tone: actionData.ok ? "success" : "error",
    });
  }, [actionData]);

  const figures = [
    { label: "Contract value", cents: contractCents },
    { label: "Invoiced", cents: invoicedCents },
    { label: "Paid", cents: paidCents },
    { label: "Left to bill", cents: progress.remainingToBillCents },
    { label: "Expenses", cents: expensesCents },
    { label: "Margin (paid − expenses)", cents: marginCents },
  ];

  return (
    <article aria-labelledby="project-name" className="flex flex-col gap-4">
      <Link
        to="/projects"
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-control px-2 font-semibold text-saffron-ink"
      >
        <ChevronLeft className="size-5" aria-hidden />
        Projects
      </Link>
      <Card padding="none" className="overflow-hidden">
        <div className="aspect-[16/6] bg-gradient-to-br from-saffron-tint to-surface">
          {coverUrl && (
            <img src={coverUrl} alt={`Cover photo for ${project.name}`} className="size-full object-cover" />
          )}
        </div>
        <div className="flex flex-col gap-3 p-5 tablet:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="project-name" className="font-display text-title">
                {project.name}
              </h2>
              <p className="text-secondary">
                <Link
                  to={`/clients/${project.clientId}`}
                  className="font-semibold text-terracotta-ink underline-offset-2 hover:underline"
                >
                  {clientName}
                </Link>
                {site &&
                  ` · ${site.label}${formatAddress(site.address) ? `, ${formatAddress(site.address)}` : ""}`}
              </p>
            </div>
            <span className="rounded-full bg-saffron-tint px-3 py-1 text-micro font-semibold text-saffron-ink capitalize">
              {project.status}
            </span>
          </div>
          <ProjectProgressBar {...progress} />
        </div>
      </Card>

      <dl className="grid grid-cols-2 gap-3 tablet:grid-cols-3">
        {figures.map((f) => (
          <Card key={f.label} padding="compact">
            <dt className="text-label font-semibold text-secondary">{f.label}</dt>
            <dd className="mt-1 text-section font-semibold">
              <MoneyText cents={f.cents} />
            </dd>
          </Card>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        {project.status !== "completed" && (
          <Form method="post">
            <input type="hidden" name="status" value="completed" />
            <Button type="submit" variant="secondary" loading={pending === "completed"}>
              <CheckCircle2 aria-hidden />
              Mark complete
            </Button>
          </Form>
        )}
        {project.status !== "active" && (
          <Form method="post">
            <input type="hidden" name="status" value="active" />
            <Button type="submit" variant="secondary" loading={pending === "active"}>
              <RotateCcw aria-hidden />
              Reopen
            </Button>
          </Form>
        )}
        {project.status !== "archived" && (
          <Form method="post">
            <input type="hidden" name="status" value="archived" />
            <Button type="submit" variant="ghost" loading={pending === "archived"}>
              <Archive aria-hidden />
              Archive
            </Button>
          </Form>
        )}
      </div>

      <Card>
        <h3 className="mb-3 text-section font-semibold">Cover photo</h3>
        <Form
          method="post"
          encType="multipart/form-data"
          className="flex flex-col gap-2 tablet:flex-row tablet:items-center"
        >
          <input type="hidden" name="intent" value="cover" />
          <label htmlFor="cover" className="sr-only">
            Choose a cover photo
          </label>
          <input
            id="cover"
            name="cover"
            type="file"
            accept="image/*"
            onChange={shrinkInputFile}
            className="block flex-1 text-label file:mr-3 file:h-11 file:rounded-control file:border-0 file:bg-surface-2 file:px-4 file:font-semibold file:text-primary"
          />
          <Button type="submit" variant="secondary" loading={pending === "cover"}>
            {pending !== "cover" && <ImageUp aria-hidden />}
            Upload
          </Button>
        </Form>
      </Card>

      <div className="grid gap-4 desktop:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-section font-semibold">Quotes and invoices</h3>
          {quotes.length + invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              tone="plum"
              title="Nothing attached yet"
              description="Quotes and invoices for this project will be listed here."
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-border">
              {quotes.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-2">
                  <span>Quote {q.number ?? "draft"}</span>
                  <StatusBadge status={q.status} size="sm" />
                </li>
              ))}
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="capitalize">
                    {i.kind} invoice {i.number ?? "draft"}
                  </span>
                  <StatusBadge status={i.status} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="mb-3 text-section font-semibold">Activity</h3>
          <ol>
            {activity.map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
                <History className="size-4 text-secondary" aria-hidden />
                <span className="flex-1">{activityLabel(a.action, a.data)}</span>
                <time dateTime={a.at} className="text-label font-normal text-secondary">
                  {relativeTime(a.at)}
                </time>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </article>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
