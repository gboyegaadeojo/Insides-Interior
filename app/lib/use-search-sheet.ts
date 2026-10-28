import { useSearchParams } from "react-router";

/**
 * A sheet whose open state lives in the URL (`?new=1`, `?edit=<id>`), so it
 * survives rotation, Split View and reloads (DS-PLT-02) and Back closes it.
 */
export function useSearchSheet(param: string) {
  const [params, setParams] = useSearchParams();
  const value = params.get(param);
  return {
    value,
    open: value !== null,
    show(next = "1") {
      setParams((p) => {
        p.set(param, next);
        return p;
      });
    },
    onOpenChange(open: boolean) {
      if (open) return;
      setParams(
        (p) => {
          p.delete(param);
          return p;
        },
        { replace: true, preventScrollReset: true },
      );
    },
  };
}
