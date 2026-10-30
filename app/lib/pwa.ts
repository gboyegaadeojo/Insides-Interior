// The installable app and its alerts (owner request), in the browser only.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredInstall: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Registers the service worker and keeps Chrome/Edge/Android's install prompt for later. */
export function setUpPwa() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((error) => console.error("service worker", error));
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event as InstallPromptEvent;
    for (const notify of listeners) notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    for (const notify of listeners) notify();
  });
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function canPromptInstall() {
  return deferredInstall !== null;
}

/** Shows the browser's own install dialog (where it offers one). */
export async function promptInstall() {
  if (!deferredInstall) return false;
  await deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  for (const notify of listeners) notify();
  return outcome === "accepted";
}

export function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type Platform = "ios" | "android" | "mac-safari" | "desktop";

export function platform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports as a Mac; touch tells them apart.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Edg\//.test(ua)) return "mac-safari";
  return "desktop";
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64url: string) {
  const padded =
    base64url.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((base64url.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Asks permission, subscribes this browser and tells the server. */
export async function turnOnAlerts(vapidPublicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(vapidPublicKey) as BufferSource,
    }));
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!res.ok) throw new Error("The server didn't save this device");
  return "granted" as const;
}

export async function turnOffAlerts() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await fetch("/api/push", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  await subscription.unsubscribe();
}
