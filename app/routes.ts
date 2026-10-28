import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  layout("routes/_app.tsx", [
    index("routes/_app._index.tsx"),
    route("quotes", "routes/_app.quotes.tsx"),
    route("invoices", "routes/_app.invoices.tsx"),
    route("clients", "routes/_app.clients.tsx"),
    route("inbox", "routes/_app.inbox.tsx"),
    route("projects", "routes/_app.projects.tsx"),
    route("catalogue", "routes/_app.catalogue.tsx"),
    route("expenses", "routes/_app.expenses.tsx"),
    route("payments", "routes/_app.payments.tsx"),
    route("reports", "routes/_app.reports.tsx"),
    route("settings", "routes/_app.settings.tsx"),
    route("more", "routes/_app.more.tsx"),
  ]),
  route("design", "routes/design.tsx"),
  route("health", "routes/health.ts"),
  route("api/preferences", "routes/api.preferences.ts"),
  // Phase 0 PDF spike (SPEC 10.4). Remove once the real portal print route exists.
  route("spike/pdf-sample", "routes/spike.pdf-sample.tsx"),
  route("spike/pdf", "routes/spike.pdf.ts"),
] satisfies RouteConfig;
