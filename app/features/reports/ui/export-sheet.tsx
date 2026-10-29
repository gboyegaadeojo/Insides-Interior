import { Download, FileSpreadsheet } from "lucide-react";
import * as React from "react";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/field";
import { Sheet, SheetContent } from "~/components/ui/sheet";
import { zip, type ZipEntry } from "~/lib/zip";
import { EXPORT_KINDS, type ExportKind } from "../constants";

// FR-RPT-05: one ZIP for the accountant with the CSVs and the invoice PDFs of a
// period. Built in the browser from the export routes, one PDF at a time, with
// progress; a PDF that can't be fetched is listed in a note inside the ZIP.

const KIND_LABEL: Record<ExportKind, string> = {
  invoices: "Invoices (CSV)",
  payments: "Payments (CSV)",
  expenses: "Expenses (CSV)",
};

function save(bytes: Uint8Array | string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportSheet({
  open,
  onOpenChange,
  from: initialFrom,
  to: initialTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: string;
  to: string;
}) {
  const [from, setFrom] = React.useState(initialFrom);
  const [to, setTo] = React.useState(initialTo);
  const [kinds, setKinds] = React.useState<Set<ExportKind>>(new Set(EXPORT_KINDS));
  const [pdfs, setPdfs] = React.useState(true);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  const range = new URLSearchParams({ from, to }).toString();
  const invalid = !from || !to || from > to;

  async function build() {
    setError(null);
    setDone(null);
    try {
      const entries: ZipEntry[] = [];
      for (const kind of EXPORT_KINDS) {
        if (!kinds.has(kind)) continue;
        setProgress(`Preparing ${kind}…`);
        const res = await fetch(`/reports/export/${kind}.csv?${range}`);
        if (!res.ok) throw new Error(`The ${kind} file couldn't be made.`);
        entries.push({ name: `${kind}-${from}-to-${to}.csv`, data: new Uint8Array(await res.arrayBuffer()) });
      }
      const missing: string[] = [];
      if (pdfs) {
        setProgress("Finding invoices…");
        const res = await fetch(`/reports/export/pdfs?${range}`);
        if (!res.ok) throw new Error("The list of invoices couldn't be loaded.");
        const { pdfs: list } = (await res.json()) as {
          pdfs: { id: string; number: string; filename: string }[];
        };
        for (const [n, pdf] of list.entries()) {
          setProgress(`Adding invoice PDF ${n + 1} of ${list.length}…`);
          const file = await fetch(`/invoices/${pdf.id}/pdf`).catch(() => null);
          if (file?.ok)
            entries.push({
              name: `invoices/${pdf.filename}`,
              data: new Uint8Array(await file.arrayBuffer()),
            });
          else missing.push(pdf.number);
        }
        if (missing.length) {
          entries.push({
            name: "README-missing-pdfs.txt",
            data: `These invoice PDFs couldn't be added. Download them from each invoice in the app:\r\n${missing.join("\r\n")}\r\n`,
          });
        }
      }
      if (entries.length === 0) throw new Error("Choose at least one thing to export.");
      setProgress("Making the ZIP…");
      save(zip(entries), `insides-export-${from}-to-${to}.zip`, "application/zip");
      setDone(
        missing.length
          ? `Downloaded. ${missing.length} PDF${missing.length === 1 ? "" : "s"} couldn't be added; the ZIP lists them.`
          : "Downloaded.",
      );
    } catch (e) {
      setError((e as Error).message || "The export didn't finish. Try again.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Export for your accountant"
        description="CSV files open in Excel. Amounts are in naira; dates are YYYY-MM-DD."
        footer={
          <Button size="lg" className="w-full" onClick={build} loading={progress !== null} disabled={invalid}>
            {progress === null && <Download aria-hidden />}
            {progress ?? "Download ZIP"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <DateField label="From" value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
            <DateField
              label="To"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              min={from}
              error={invalid && from && to ? "The end date is before the start" : undefined}
            />
          </div>
          <fieldset>
            <legend className="mb-2 text-label font-semibold">Include</legend>
            <div className="flex flex-col gap-1">
              {EXPORT_KINDS.map((kind) => (
                <label key={kind} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={kinds.has(kind)}
                    onChange={(e) =>
                      setKinds((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(kind);
                        else next.delete(kind);
                        return next;
                      })
                    }
                  />
                  {KIND_LABEL[kind]}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={pdfs}
                  onChange={(e) => setPdfs(e.target.checked)}
                />
                Invoice PDFs
              </label>
            </div>
          </fieldset>
          <div aria-live="polite">
            {done && <p className="font-semibold text-sage-ink">{done}</p>}
            {error && (
              <p role="alert" className="font-semibold text-danger-ink">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-label font-semibold">Or download one file</p>
            <div className="flex flex-wrap gap-2">
              {EXPORT_KINDS.map((kind) => (
                <Button key={kind} asChild variant="secondary" aria-disabled={invalid}>
                  <a href={invalid ? undefined : `/reports/export/${kind}.csv?${range}`} download>
                    <FileSpreadsheet aria-hidden />
                    {KIND_LABEL[kind]}
                  </a>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
