import * as React from "react";
import { useFetcher } from "react-router";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Combobox, type ComboboxOption } from "~/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TextField } from "~/components/ui/field";
import type { loader as clientsLoader } from "~/routes/api.clients";

type CreateResponse =
  { ok: true; client: { value: string; label: string } } | { ok: false; errors: Record<string, string> };

/**
 * The reusable client picker (SPEC 6.8 builder): searchable, avatars, and
 * "Create '<name>'" that asks for email and phone, saves without leaving the
 * page and selects the new client (FR-CLI-01). Posts `name` as a hidden input.
 */
export function ClientCombobox({
  name = "clientId",
  defaultValue = null,
  onChange,
  error,
  label = "Client",
}: {
  name?: string;
  defaultValue?: string | null;
  /** Called with the client id and its display name. */
  onChange?: (clientId: string | null, name: string | null) => void;
  error?: string;
  label?: string;
}) {
  const list = useFetcher<typeof clientsLoader>();
  const [value, setValue] = React.useState<string | null>(defaultValue);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<ComboboxOption[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [createErrors, setCreateErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (list.state === "idle" && !list.data) list.load("/api/clients");
  }, [list]);

  function select(next: string | null, name?: string) {
    setValue(next);
    const known = [
      ...((list.data && "options" in list.data ? list.data.options : undefined) ?? []),
      ...created,
    ];
    onChange?.(next, name ?? known.find((o) => o.value === next)?.label ?? null);
  }

  async function createClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    setSaving(true);
    setCreateErrors({});
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const result = (await response.json()) as CreateResponse;
      if (!result.ok) {
        setCreateErrors(result.errors);
        return;
      }
      setCreated((c) => [...c, result.client]);
      select(result.client.value, result.client.label);
      setDraft(null);
    } catch {
      setCreateErrors({ form: "Couldn't save the client. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  const loaded = (list.data && "options" in list.data ? list.data.options : undefined) ?? [];
  const options: ComboboxOption[] = [
    ...loaded,
    ...created.filter((c) => !loaded.some((o) => o.value === c.value)),
  ].map((o) => ({ ...o, icon: <Avatar name={o.label} size="sm" /> }));

  return (
    <>
      <input type="hidden" name={name} value={value ?? ""} />
      <Combobox
        label={label}
        options={options}
        value={value}
        onValueChange={(next) => select(next)}
        placeholder={list.state === "loading" && !list.data ? "Loading clients…" : "Choose a client"}
        searchPlaceholder="Search clients"
        emptyText="No clients match"
        onCreate={(query) => {
          setCreateErrors({});
          setDraft(query);
        }}
        error={error}
      />
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New client</DialogTitle>
            <DialogDescription>Saved straight away; you can add sites and notes later.</DialogDescription>
          </DialogHeader>
          {/* A separate form (in a portal), so it never submits the page's form. */}
          <form onSubmit={createClient} className="flex flex-col gap-4" noValidate>
            <TextField
              label="Name"
              name="displayName"
              defaultValue={draft ?? ""}
              required
              autoFocus
              error={createErrors.displayName}
            />
            <TextField
              label="Email"
              name="email"
              type="email"
              autoComplete="off"
              error={createErrors.email}
            />
            <TextField
              label="Phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              error={createErrors.phone}
            />
            {createErrors.form && (
              <p role="alert" className="text-label font-semibold text-danger-ink">
                {createErrors.form}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Create client
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
