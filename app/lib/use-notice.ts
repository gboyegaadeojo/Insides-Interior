import * as React from "react";
import { useSearchParams } from "react-router";
import { toast } from "~/components/ui/toast";

/**
 * Shows `?notice=` as a success toast once and drops it from the URL. Actions
 * that redirect to another screen (accepting change requests opens the draft
 * revision) say what happened this way.
 */
export function useNotice() {
  const [params, setParams] = useSearchParams();
  const notice = params.get("notice");
  React.useEffect(() => {
    if (!notice) return;
    toast(notice, { tone: "success" });
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("notice");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [notice, setParams]);
}
