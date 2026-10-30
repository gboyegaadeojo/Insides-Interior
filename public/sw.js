/* global self, URL */
/* Insides Interior service worker (owner request: installable app with alerts).
   It shows push alerts and opens the right screen when one is tapped. It does
   not cache pages: the app needs the network for live figures, and a stale
   offline copy of a quote or invoice would be worse than none. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Insides Interior", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* A push without a readable payload still shows a generic alert. */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      data: { url: data.url },
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (new URL(win.url).origin === self.location.origin && "focus" in win) {
          win.navigate(url);
          return win.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
