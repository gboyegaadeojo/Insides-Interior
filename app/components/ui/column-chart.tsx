import * as React from "react";
import { cn } from "~/lib/utils";
import { SegmentedControl } from "./segmented-control";

// Grouped column chart (SPEC 6.8 Reports, DS-COL-09, FR-RPT-04): series in a
// fixed order with their module hue, a legend always (identity never colour
// alone), the latest values labelled directly, an exact-value tooltip on hover
// and keyboard focus, and a table view of the same numbers. Teal and Rose clay
// are close for protanopes, so every series after the first carries a hatch.

export type ChartTone = "teal" | "roseclay" | "plum" | "indigo" | "ocean" | "sage" | "saffron" | "terracotta";

export interface ChartSeries {
  key: string;
  label: string;
  tone: ChartTone;
  values: number[];
}

const FILL: Record<ChartTone, string> = {
  teal: "var(--teal-base)",
  roseclay: "var(--roseclay-base)",
  plum: "var(--plum-base)",
  indigo: "var(--indigo-base)",
  ocean: "var(--ocean-base)",
  sage: "var(--sage-base)",
  saffron: "var(--saffron-base)",
  terracotta: "var(--terracotta-base)",
};

/** Clean axis steps: 1, 2 or 5 × 10^n, about four of them. */
function niceMax(max: number) {
  if (max <= 0) return { top: 4, step: 1 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return { top: Math.ceil(max / step) * step, step };
}

const W = 640;
const H = 240;
const PAD = { top: 20, right: 8, bottom: 28, left: 56 };

export function ColumnChart({
  title,
  categories,
  series,
  format,
  formatAxis,
  className,
}: {
  /** Names the chart for screen readers and the table caption. */
  title: string;
  /** Category labels (e.g. "Oct"), one per value. */
  categories: string[];
  series: ChartSeries[];
  /** Exact value, e.g. formatCents. */
  format: (value: number) => string;
  /** Compact axis value, e.g. "₦1.2M". */
  formatAxis: (value: number) => string;
  className?: string;
}) {
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const [active, setActive] = React.useState<number | null>(null);
  // useId has colons, which url(#…) references cannot contain.
  const id = React.useId().replaceAll(":", "");
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const { top, step } = niceMax(max);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(categories.length, 1);
  const gap = 2;
  const barW = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length);
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => PAD.top + plotH - (Math.max(v, 0) / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, n) => n * step);
  const last = categories.length - 1;

  return (
    <figure className={cn("flex flex-col gap-3", className)} aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <figcaption id={`${id}-title`} className="sr-only">
          {title}
        </figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {series.map((s, n) => (
            <li key={s.key} className="flex items-center gap-2 text-label text-secondary">
              <svg className="size-3.5" viewBox="0 0 14 14" aria-hidden>
                <defs>
                  <pattern
                    id={`${id}-key${n}`}
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="2.5" height="6" fill="var(--surface)" opacity="0.55" />
                  </pattern>
                </defs>
                <rect width="14" height="14" rx="3" fill={FILL[s.tone]} />
                {n > 0 && <rect width="14" height="14" rx="3" fill={`url(#${id}-key${n})`} />}
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
        <SegmentedControl
          label={`${title}: view`}
          value={view}
          onValueChange={(v) => setView(v as "chart" | "table")}
          segments={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
      </div>

      {view === "chart" ? (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full overflow-visible"
            role="group"
            aria-label={`${title}. Use the Table view for every value.`}
            onPointerLeave={() => setActive(null)}
          >
            <defs>
              <pattern
                id={`${id}-hatch`}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="2.5" height="6" fill="var(--surface)" opacity="0.55" />
              </pattern>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-secondary text-micro tabular"
                >
                  {formatAxis(t)}
                </text>
              </g>
            ))}
            {categories.map((label, c) => {
              const x0 = PAD.left + band * c + (band - groupW) / 2;
              const describe = `${label}: ${series.map((s) => `${s.label} ${format(s.values[c] ?? 0)}`).join(", ")}`;
              return (
                <g
                  key={label + c}
                  tabIndex={0}
                  role="img"
                  aria-label={describe}
                  className="outline-none focus-visible:[&>rect.hit]:stroke-teal-base"
                  onPointerEnter={() => setActive(c)}
                  onFocus={() => setActive(c)}
                  onBlur={() => setActive(null)}
                >
                  <rect
                    className="hit"
                    x={PAD.left + band * c}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill={active === c ? "var(--surface-2)" : "transparent"}
                    strokeWidth="2"
                    rx="6"
                  />
                  {series.map((s, n) => {
                    const v = s.values[c] ?? 0;
                    const h = Math.max(0, y(0) - y(v));
                    const x = x0 + n * (barW + gap);
                    const r = Math.min(4, h, barW / 2);
                    // Rounded data end, square at the baseline.
                    const d = h
                      ? `M${x},${y(0)}V${y(v) + r}Q${x},${y(v)} ${x + r},${y(v)}H${x + barW - r}Q${x + barW},${y(v)} ${x + barW},${y(v) + r}V${y(0)}Z`
                      : "";
                    return (
                      <g key={s.key}>
                        {d && <path d={d} fill={FILL[s.tone]} />}
                        {d && n > 0 && <path d={d} fill={`url(#${id}-hatch)`} />}
                      </g>
                    );
                  })}
                  <text
                    x={PAD.left + band * c + band / 2}
                    y={H - 8}
                    textAnchor="middle"
                    className="fill-secondary text-micro"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            {/* Direct labels on the latest period only (selective, never every bar). */}
            {last >= 0 &&
              series.map((s, n) => {
                const v = s.values[last] ?? 0;
                if (v <= 0) return null;
                const x0 = PAD.left + band * last + (band - groupW) / 2 + n * (barW + gap) + barW / 2;
                return (
                  <text
                    key={s.key}
                    x={x0}
                    y={y(v) - 6}
                    textAnchor="middle"
                    className="pointer-events-none fill-primary text-micro font-semibold tabular"
                  >
                    {formatAxis(v)}
                  </text>
                );
              })}
          </svg>
          {active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-control border border-border bg-surface px-3 py-2 shadow-sheet"
              style={{
                left: `${((PAD.left + band * active + band / 2) / W) * 100}%`,
                transform: active > categories.length / 2 ? "translateX(-100%)" : undefined,
              }}
            >
              <p className="text-label font-semibold">{categories[active]}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-label text-secondary">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: FILL[s.tone] }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="font-semibold text-primary tabular">{format(s.values[active] ?? 0)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-border text-label text-secondary">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Period
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-2 pl-3 text-right font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((label, c) => (
                <tr key={label + c} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    {label}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="py-2 pl-3 text-right tabular">
                      {format(s.values[c] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/** "₦1.2M", "₦450K", "₦0" from kobo, for chart axes. */
export function compactNaira(cents: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}
