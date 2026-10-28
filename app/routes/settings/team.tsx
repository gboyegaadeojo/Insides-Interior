import { Send, UserCheck, UserPlus, UserX } from "lucide-react";
import * as React from "react";
import { Form, useNavigation } from "react-router";
import { SectionHeader } from "~/components/settings/section-header";
import { SettingsForm, useIntentErrors } from "~/components/settings/settings-form";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { TextField } from "~/components/ui/field";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { runIntent, runService } from "~/features/settings/action";
import { inviteSchema } from "~/features/settings/schema";
import { inviteMember, listTeam, resendInvite, setMemberDisabled } from "~/features/team/service";
import { cn } from "~/lib/utils";
import { assertSameOrigin, requireOwner } from "~/server/session";
import type { Route } from "./+types/team";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireOwner(context.cloudflare.env, request);
  return { team: await listTeam(ctx), me: ctx.user.id };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireOwner(context.cloudflare.env, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "invite") {
    return runIntent(
      intent,
      inviteSchema,
      form,
      (input) => inviteMember(ctx, request, input),
      "Invitation sent",
    );
  }
  const [verb, userId] = intent.split(":") as [string, string];
  if (verb === "resend")
    return runService(intent, () => resendInvite(ctx, request, userId), "Sign-in link sent");
  if (verb === "disable")
    return runService(intent, () => setMemberDisabled(ctx, userId, true), "Access turned off");
  if (verb === "enable")
    return runService(intent, () => setMemberDisabled(ctx, userId, false), "Access turned back on");
  throw new Response("Unknown action", { status: 400 });
}

export default function TeamSettings({ loaderData }: Route.ComponentProps) {
  const errors = useIntentErrors("invite");
  const navigation = useNavigation();
  const pendingIntent = navigation.formData?.get("intent");
  const [role, setRole] = React.useState<"staff" | "owner">("staff");

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Team"
        description="Owners have full access. Staff can quote, invoice and record payments; they can't change settings, void invoices or delete payments."
      />
      <Card>
        <CardHeader>
          <CardTitle>People with access</CardTitle>
          <CardDescription>There's no sign-up page: only people listed here can sign in.</CardDescription>
        </CardHeader>
        <ul className="divide-y divide-border">
          {loaderData.team.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={member.name} />
              <div className="min-w-0 flex-1">
                <p className={cn("font-semibold", member.disabledAt && "text-secondary line-through")}>
                  {member.name}
                  {member.id === loaderData.me && <span className="font-normal text-secondary"> (you)</span>}
                </p>
                <p className="truncate text-label font-normal text-secondary">
                  {member.email} · {member.role === "owner" ? "Owner" : "Staff"}
                  {member.disabledAt
                    ? " · access off"
                    : !member.emailVerified
                      ? " · invited, not signed in yet"
                      : ""}
                </p>
              </div>
              {member.id !== loaderData.me && (
                <div className="flex gap-2">
                  {!member.disabledAt && (
                    <Form method="post">
                      <input type="hidden" name="intent" value={`resend:${member.id}`} />
                      <Button type="submit" variant="ghost" loading={pendingIntent === `resend:${member.id}`}>
                        {pendingIntent !== `resend:${member.id}` && <Send aria-hidden />}
                        Send link
                      </Button>
                    </Form>
                  )}
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value={`${member.disabledAt ? "enable" : "disable"}:${member.id}`}
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      loading={pendingIntent === `${member.disabledAt ? "enable" : "disable"}:${member.id}`}
                    >
                      {member.disabledAt ? <UserCheck aria-hidden /> : <UserX aria-hidden />}
                      {member.disabledAt ? "Turn access on" : "Turn access off"}
                    </Button>
                  </Form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <SettingsForm intent="invite" title="Invite someone" submitLabel="Send invitation">
        <div className="flex flex-col gap-2">
          <span className="text-label font-semibold">Access</span>
          <SegmentedControl
            label="Access"
            value={role}
            onValueChange={setRole}
            segments={[
              { value: "staff", label: "Staff" },
              { value: "owner", label: "Owner (full access)" },
            ]}
          />
          <input type="hidden" name="role" value={role} />
        </div>
        <div className="grid gap-4 tablet:grid-cols-2">
          <TextField label="Name" name="name" autoComplete="off" error={errors.name} required />
          <TextField
            label="Email"
            name="email"
            type="email"
            autoComplete="off"
            error={errors.email}
            required
          />
        </div>
        <p className="flex items-center gap-2 text-label font-normal text-secondary">
          <UserPlus className="size-4" aria-hidden />
          They'll get an email with a sign-in link.
        </p>
      </SettingsForm>
    </div>
  );
}
