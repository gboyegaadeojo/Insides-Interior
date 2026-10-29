import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { Toaster } from "~/components/ui/toast";
import { useNonce } from "~/lib/nonce";
import { readPreferences } from "~/lib/preferences";
import { themeColors } from "~/lib/theme-color";
import type { Route } from "./+types/root";
import "./app.css";
// The document styles load with the shell, so a document never flashes unstyled
// while its route chunk arrives (found by the a11y sweep, phase 10).
import "./components/doc/document.css";

export function loader({ request }: Route.LoaderArgs) {
  return { preferences: readPreferences(request.headers.get("Cookie")) };
}

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "icon", href: "/icons/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
  { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const theme = data?.preferences.theme ?? "system";
  const colors = themeColors();
  const nonce = useNonce();
  return (
    <html lang="en-NG" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {theme === "system" ? (
          <>
            <meta name="theme-color" media="(prefers-color-scheme: light)" content={colors.light} />
            <meta name="theme-color" media="(prefers-color-scheme: dark)" content={colors.dark} />
          </>
        ) : (
          <meta name="theme-color" content={theme === "dark" ? colors.dark : colors.light} />
        )}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Insides" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Toaster />
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "An unexpected error occurred. Please try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Page not found" : "Error";
    details = error.status === 404 ? "The page you asked for doesn't exist." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="font-display text-display">{message}</h1>
      <p className="mt-2 text-secondary">{details}</p>
      <a
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-control bg-action px-4 font-semibold text-action-on"
      >
        Go to Home
      </a>
      {stack && (
        <pre className="mt-4 overflow-x-auto rounded-card bg-surface-2 p-4 text-micro">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
