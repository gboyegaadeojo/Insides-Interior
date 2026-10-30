import { MapPin, Plus } from "lucide-react";
import * as React from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Select, TextField } from "~/components/ui/field";
import { DEFAULT_CITY, DEFAULT_STATE } from "~/domain/locale";
import type { loader as clientsLoader } from "~/routes/api.clients";

export interface SiteOption {
  id: string;
  label: string;
  address: string;
}

/**
 * Site picker that loads the chosen client's job addresses (FR-CLI-02). A quote
 * or invoice can be for a different place than the client's own address, so a
 * new job address can be added right here; it's saved on the client and chosen.
 * Uncontrolled inside forms (posts `siteId`), or controlled via value/onChange.
 */
export function SiteSelect({
  clientId,
  defaultValue,
  value,
  onChange,
  error,
}: {
  clientId: string | null;
  defaultValue?: string | null;
  value?: string | null;
  onChange?: (site: SiteOption | null) => void;
  error?: string;
}) {
  const fetcher = useFetcher<typeof clientsLoader>();
  const [adding, setAdding] = React.useState(false);
  const [chosen, setChosen] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (clientId) fetcher.load(`/api/clients?sites=${encodeURIComponent(clientId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the client changes
  }, [clientId]);
  const sites: SiteOption[] =
    (fetcher.data && "sites" in fetcher.data ? fetcher.data.sites : undefined) ?? [];
  const controlled = value !== undefined;

  function created(site: SiteOption) {
    setAdding(false);
    setChosen(site.id);
    if (clientId) fetcher.load(`/api/clients?sites=${encodeURIComponent(clientId)}`);
    onChange?.(site);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        label="Job address"
        name="siteId"
        {...(controlled ? { value: value ?? "" } : { defaultValue: chosen ?? defaultValue ?? "" })}
        onChange={(e) => onChange?.(sites.find((s) => s.id === e.target.value) ?? null)}
        key={controlled ? clientId : `${clientId}:${sites.length}:${chosen ?? ""}`}
        disabled={!clientId || fetcher.state === "loading"}
        error={error}
      >
        <option value="">{clientId ? "Same as the client's address" : "Choose a client first"}</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
            {s.address ? `: ${s.address}` : ""}
          </option>
        ))}
      </Select>
      {clientId && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-1 text-label font-semibold text-accent hover:underline pointer-fine:min-h-8"
        >
          <Plus className="size-4" strokeWidth={2.4} aria-hidden />
          New job address
        </button>
      )}
      {clientId && (
        <NewSiteDialog clientId={clientId} open={adding} onOpenChange={setAdding} onCreated={created} />
      )}
    </div>
  );
}

function NewSiteDialog({
  clientId,
  open,
  onOpenChange,
  onCreated,
}: {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (site: SiteOption) => void;
}) {
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    body.set("intent", "site");
    body.set("clientId", clientId);
    setSaving(true);
    setErrors({});
    try {
      const res = await fetch("/api/clients", { method: "POST", body });
      const json = (await res.json()) as
        { ok: true; site: SiteOption } | { ok: false; errors: Record<string, string> };
      if (json.ok) onCreated(json.site);
      else setErrors(json.errors);
    } catch {
      setErrors({ form: "The address wasn't saved. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="size-5 text-secondary" aria-hidden />
            New job address
          </DialogTitle>
          <DialogDescription>
            Where this job happens. It's saved on the client for next time; their main address doesn't change.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <TextField
            label="Name"
            name="label"
            required
            placeholder="e.g. Lekki site, Cottage"
            error={errors.label}
          />
          <TextField
            label="Street address"
            name="line1"
            placeholder="12 Admiralty Way"
            error={errors.line1}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="City" name="city" defaultValue={DEFAULT_CITY} error={errors.city} />
            <TextField label="State" name="state" defaultValue={DEFAULT_STATE} error={errors.state} />
          </div>
          {errors.form && (
            <p role="alert" className="text-label font-semibold text-danger-ink">
              {errors.form}
            </p>
          )}
          <div className="mt-1 flex flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save and use it
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
