import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("health", "routes/health.ts"),
  // Phase 0 PDF spike (SPEC 10.4). Remove once the real portal print route exists.
  route("spike/pdf-sample", "routes/spike.pdf-sample.tsx"),
  route("spike/pdf", "routes/spike.pdf.ts"),
] satisfies RouteConfig;
