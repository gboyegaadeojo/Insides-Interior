import { Mail, MailX, Send, ShieldCheck, UserCheck, UserPlus, UserRound, UserX } from "lucide-react";
import * as React from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { SectionHeader } from "~/components/settings/section-header";
import { SettingsForm, useIntentErrors } from "~/components/settings/settings-form";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { TextField } from "~/components/ui/field";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { toast } from "~/components/ui/toast";
import { runIntent, runService } from "~/features/settings/action";
import { inviteSchema } from "~/features/settings/schema";
import {
  inviteMember,
  listTeam,
  resendInvite,
  setBusinessEmails,
  setMemberDisabled,
  setMemberRole,
} from "~/features/team/service";
import type { ActionResult } from "~/lib/form";
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
  if (verb === "owner" || verb === "staff")
    return runService(
      intent,
      () => setMemberRole(ctx, userId, verb),
      verb === "owner" ? "Now an owner" : "Now staff",
    );
  if (verb === "emails-on" || verb === "emails-off")
    return runService(
      intent,
      () => setBusinessEmails(ctx, userId, verb === "emails-on"),
      verb === "emails-on" ? "They'll get the business emails" : "Business emails stopped",
    );
  throw new Response("Unknown action", { status: 400 });
}

export default function TeamSettings({ loaderData }: Route.ComponentProps) {
  const errors = useIntentErrors("invite");
  const navigation = useNavigation();
  const pendingIntent = navigation.formData?.get("intent");
  const [role, setRole] = React.useState<"staff" | "owner">("staff");
  const result = useActionData<ActionResult>();
  const lastResult = React.useRef<ActionResult | undefined>(undefined);

  // Results of the buttons on each person (the invite form shows its own).
  React.useEffect(() => {
    if (!result || result === lastResult.current || result.intent === "invite") return;
    lastResult.current = result;
    if (result.ok) toast(result.message, { tone: "success" });
    else toast(Object.values(result.errors)[0] ?? "That didn't work", { tone: "error" });
  }, [result]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Team"
        description="Owners have full access and can get the business emails. Staff can quote, invoice and record payments; they can't change settings, void invoices or delete payments."
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
                {member.role === "owner" && !member.disabledAt && (
                  <p className="flex items-center gap-1.5 text-label font-normal text-secondary">
                    {member.businessEmails ? (
                      <Mail className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <MailX className="size-4 shrink-0" aria-hidden />
                    )}
                    {member.businessEmails ? "Gets the business emails" : "Doesn't get the business emails"}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {member.role === "owner" && !member.disabledAt && (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value={`${member.businessEmails ? "emails-off" : "emails-on"}:${member.id}`}
                    />
                    <Button
                      type="submit"
                      variant="ghost"
                      loading={
                        pendingIntent === `${member.businessEmails ? "emails-off" : "emails-on"}:${member.id}`
                      }
                    >
                      {member.businessEmails ? <MailX aria-hidden /> : <Mail aria-hidden />}
                      {member.businessEmails ? "Stop emails" : "Send emails"}
                    </Button>
                  </Form>
                )}
                {member.id !== loaderData.me && (
                  <>
                    {!member.disabledAt && (
                      <Form method="post">
                        <input type="hidden" name="intent" value={`resend:${member.id}`} />
                        <Button
                          type="submit"
                          variant="ghost"
                          loading={pendingIntent === `resend:${member.id}`}
                        >
                          {pendingIntent !== `resend:${member.id}` && <Send aria-hidden />}
                          Send link
                        </Button>
                      </Form>
                    )}
                    {!member.disabledAt && (
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value={`${member.role === "owner" ? "staff" : "owner"}:${member.id}`}
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          loading={
                            pendingIntent === `${member.role === "owner" ? "staff" : "owner"}:${member.id}`
                          }
                        >
                          {member.role === "owner" ? <UserRound aria-hidden /> : <ShieldCheck aria-hidden />}
                          {member.role === "owner" ? "Make staff" : "Make owner"}
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
                  </>
                )}
              </div>
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
        <RoleSummary role={role} />
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

const ROLE_CAN: Record<"owner" | "staff", { can: string[]; cannot: string[] }> = {
  owner: {
    can: [
      "Everything staff can do",
      "Change settings, branding, tax and email wording",
      "Invite people, change their role and turn off their access",
      "Void invoices and delete payments",
      "Get the business emails: approvals, client messages, bounces and the Monday summary",
    ],
    cannot: [],
  },
  staff: {
    can: [
      "Create and send quotes and invoices",
      "Record payments and expenses",
      "Look after clients, projects and the catalogue",
      "Reply to client messages and change requests",
    ],
    cannot: ["Change settings or the team", "Void invoices or delete payments", "Get the owner emails"],
  },
};

/** What the chosen role can do, shown under the Access choice. */
function RoleSummary({ role }: { role: "owner" | "staff" }) {
  const { can, cannot } = ROLE_CAN[role];
  return (
    <div className="rounded-control bg-surface-2 p-4" aria-live="polite">
      <p className="text-label font-semibold">{role === "owner" ? "An owner can" : "Staff can"}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {can.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <UserCheck className="mt-0.5 size-4 shrink-0 text-sage-base" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
      {cannot.length > 0 && (
        <>
          <p className="mt-3 text-label font-semibold">Staff can't</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {cannot.map((item) => (
              <li key={item} className="flex items-start gap-2 text-secondary">
                <UserX className="mt-0.5 size-4 shrink-0" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
