import { BellRing, Check, Download, Mail, Share, Smartphone } from "lucide-react";
import * as React from "react";
import { Link, useFetcher } from "react-router";
import { SectionHeader } from "~/components/settings/section-header";
import { RouteErrorBoundary } from "~/components/shell/route-error";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { toast } from "~/components/ui/toast";
import { emailedOwners } from "~/features/email/service";
import { pushDevices, sendTestAlert } from "~/features/notifications/service";
import {
  canPromptInstall,
  currentSubscription,
  isInstalled,
  onInstallChange,
  type Platform,
  platform,
  promptInstall,
  pushSupported,
  turnOffAlerts,
  turnOnAlerts,
} from "~/lib/pwa";
import { assertSameOrigin, requireUser } from "~/server/session";
import type { Route } from "./+types/notifications";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await requireUser(context.cloudflare.env, request);
  const [devices, owners] = await Promise.all([pushDevices(ctx), emailedOwners(ctx.db, ctx.user.businessId)]);
  return {
    vapidPublicKey: ctx.env.VAPID_PUBLIC_KEY ?? "",
    devices: devices.length,
    owners: owners.map((o) => ({ name: o.name, email: o.email })),
    isOwner: ctx.user.role === "owner",
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  assertSameOrigin(request);
  const ctx = await requireUser(context.cloudflare.env, request);
  const form = await request.formData();
  if (form.get("intent") === "test") {
    await sendTestAlert(ctx);
    return { ok: true, message: "Test alert sent. It should arrive in a few seconds." };
  }
  throw new Response("Unknown action", { status: 400 });
}

/** Every event that emails the owners; none of these can be switched off (owner request). */
const ALWAYS_EMAILED = [
  "A client approves a quote",
  "A client asks for a change or sends a message",
  "A client opens a quote or an invoice",
  "An invoice is drafted for you when a quote is approved",
  "An email to a client bounces or is marked as spam",
  "The Monday summary of what's owed",
];

type AlertState = "loading" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

async function alertState(): Promise<AlertState> {
  if (!pushSupported()) {
    // iPhone and iPad only offer alerts to an app added to the Home Screen.
    return platform() === "ios" && !isInstalled() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  return (await currentSubscription()) ? "on" : "off";
}

export default function NotificationSettings({ loaderData }: Route.ComponentProps) {
  // Install state and platform come from the browser; the server renders "not installed".
  const install = React.useSyncExternalStore(
    onInstallChange,
    () => `${isInstalled() ? 1 : 0}${canPromptInstall() ? 1 : 0}`,
    () => "00",
  );
  const installed = install[0] === "1";
  const canInstall = install[1] === "1";
  const device = React.useSyncExternalStore<Platform>(
    () => () => {},
    platform,
    () => "desktop",
  );
  const [alerts, setAlerts] = React.useState<AlertState>("loading");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const test = useFetcher<typeof action>();

  React.useEffect(() => {
    let live = true;
    alertState()
      .then((state) => live && setAlerts(state))
      .catch(() => live && setAlerts("unsupported"));
    return () => {
      live = false;
    };
  }, []);

  React.useEffect(() => {
    if (test.state === "idle" && test.data?.ok) toast(test.data.message, { tone: "success" });
  }, [test.state, test.data]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const result = await turnOnAlerts(loaderData.vapidPublicKey);
      setAlerts(result === "granted" ? "on" : result === "denied" ? "blocked" : "off");
    } catch {
      setError("Alerts couldn't be turned on. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await turnOffAlerts();
      setAlerts("off");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="App and alerts"
        description="Install the app on this device and get alerts the moment something happens."
      />

      <Card>
        <CardHeader>
          <CardTitle>Install the app</CardTitle>
          <CardDescription>
            Opens full screen from your Home Screen, Dock or Start menu, like any app.
          </CardDescription>
        </CardHeader>
        {installed ? (
          <p className="flex items-center gap-2 font-medium text-sage-ink">
            <Check className="size-5" aria-hidden />
            Installed on this device
          </p>
        ) : canInstall ? (
          <Button onClick={() => void promptInstall()}>
            <Download aria-hidden />
            Install Insides Interior
          </Button>
        ) : (
          <InstallSteps device={device} />
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alerts on this device</CardTitle>
          <CardDescription>
            A notification on screen when a client opens, approves or replies, and when money arrives.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-3" aria-live="polite">
          {alerts === "loading" && <p className="text-secondary">Checking this device…</p>}
          {alerts === "unsupported" && (
            <p className="text-secondary">This browser can't show alerts. You'll still get every email.</p>
          )}
          {alerts === "needs-install" && (
            <p className="text-secondary">
              On iPhone and iPad, alerts work once the app is on your Home Screen (see above). Open it from
              there, then come back to this page.
            </p>
          )}
          {alerts === "blocked" && (
            <p className="text-secondary">
              Alerts are blocked for this site. Allow notifications for it in your browser or device settings,
              then reload this page.
            </p>
          )}
          {alerts === "off" && (
            <Button onClick={enable} loading={busy} className="self-start">
              {!busy && <BellRing aria-hidden />}
              Turn on alerts
            </Button>
          )}
          {alerts === "on" && (
            <>
              <p className="flex items-center gap-2 font-medium text-sage-ink">
                <Check className="size-5" aria-hidden />
                Alerts are on for this device
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  loading={test.state !== "idle"}
                  onClick={() => test.submit({ intent: "test" }, { method: "post" })}
                >
                  Send a test alert
                </Button>
                <Button variant="ghost" onClick={disable} loading={busy}>
                  Turn off on this device
                </Button>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-label font-semibold text-danger-ink">
              {error}
            </p>
          )}
          <p className="text-label text-secondary">
            {loaderData.devices === 0
              ? "No device has alerts on yet."
              : `${loaderData.devices} device${loaderData.devices === 1 ? " has" : "s have"} alerts on.`}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-5 text-secondary" aria-hidden />
            Emails the owners always get
          </CardTitle>
          <CardDescription>
            These are always on, so nothing important is missed. They go to every owner:
          </CardDescription>
        </CardHeader>
        <ul className="mb-4 flex flex-col gap-1" aria-label="Owners who get these emails">
          {loaderData.owners.map((o) => (
            <li key={o.email} className="flex flex-wrap gap-x-2">
              <span className="font-semibold">{o.name}</span>
              <span className="text-secondary">{o.email}</span>
            </li>
          ))}
        </ul>
        <p className="mb-4 text-label font-normal text-secondary">
          {loaderData.isOwner ? (
            <>
              To add someone, invite them as an Owner in{" "}
              <Link to="/settings/team" className="font-semibold text-accent underline underline-offset-2">
                Team
              </Link>
              . Staff don't get these emails.
            </>
          ) : (
            "Staff don't get these emails; an owner can change who has access in Team."
          )}
        </p>
        <ul className="flex flex-col gap-2">
          {ALWAYS_EMAILED.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-sage-base" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function InstallSteps({ device }: { device: Platform }) {
  const steps: Record<Platform, React.ReactNode[]> = {
    ios: [
      <>
        Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> Share in Safari's
        toolbar.
      </>,
      "Choose Add to Home Screen, then Add.",
      "Open Insides from your Home Screen.",
    ],
    android: [
      "Open the ⋮ menu in Chrome.",
      "Choose Install app (or Add to Home screen).",
      "Open Insides from your apps.",
    ],
    "mac-safari": [
      "In Safari's menu bar, choose File.",
      "Choose Add to Dock, then Add.",
      "Open Insides from your Dock.",
    ],
    desktop: [
      "In Chrome or Edge, click the install icon at the right of the address bar.",
      "Or open the browser menu and choose Install Insides Interior.",
      "Open it from your Start menu, Dock or desktop.",
    ],
  };
  return (
    <ol className="flex flex-col gap-2">
      {steps[device].map((step, n) => (
        <li key={n} className="flex items-start gap-3">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-label font-semibold">
            {n + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
      <li className="flex items-start gap-3 text-label text-secondary">
        <Smartphone className="size-4 shrink-0" aria-hidden />
        On a phone or tablet, open this page there to install it on that device.
      </li>
    </ol>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
