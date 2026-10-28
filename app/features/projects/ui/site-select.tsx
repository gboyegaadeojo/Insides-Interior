import * as React from "react";
import { useFetcher } from "react-router";
import { Select } from "~/components/ui/field";
import type { loader as clientsLoader } from "~/routes/api.clients";

export interface SiteOption {
  id: string;
  label: string;
  address: string;
}

/**
 * Site picker that loads the chosen client's job addresses (FR-CLI-02).
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
  React.useEffect(() => {
    if (clientId) fetcher.load(`/api/clients?sites=${encodeURIComponent(clientId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the client changes
  }, [clientId]);
  const sites: SiteOption[] =
    (fetcher.data && "sites" in fetcher.data ? fetcher.data.sites : undefined) ?? [];
  const controlled = value !== undefined;
  return (
    <Select
      label="Site"
      name="siteId"
      {...(controlled ? { value: value ?? "" } : { defaultValue: defaultValue ?? "" })}
      onChange={(e) => onChange?.(sites.find((s) => s.id === e.target.value) ?? null)}
      key={controlled ? clientId : `${clientId}:${sites.length}`}
      disabled={!clientId || fetcher.state === "loading"}
      hint={
        clientId && sites.length === 0 && fetcher.state === "idle"
          ? "No sites yet; add them on the client's profile"
          : undefined
      }
      error={error}
    >
      <option value="">{clientId ? "No specific site" : "Choose a client first"}</option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
          {s.address ? `: ${s.address}` : ""}
        </option>
      ))}
    </Select>
  );
}
