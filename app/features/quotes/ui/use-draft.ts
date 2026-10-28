import * as React from "react";
import type { SaveState } from "~/components/ui/save-status";
import type { DocLine, DocSection } from "~/components/doc/document-renderer";

// Builder state and truthful autosave (FR-QT-06): edits go through a reducer,
// a save is sent after 2 s of inactivity, only one request is in flight, and
// the status says "Saved" only after the server confirms. A stale version
// comes back as a conflict instead of overwriting the other tab.

export interface DraftHeader {
  title: string | null;
  clientId: string | null;
  siteId: string | null;
  validUntil: string | null;
  depositType: "percent" | "amount" | null;
  depositValue: number | null;
}

export type Discount = { type: "percent"; bp: number } | { type: "amount"; cents: number };

export interface DraftLine extends DocLine {
  itemId?: string;
  itemType?: "service" | "product" | "fee" | "allowance";
}

export interface DraftSection extends Omit<DocSection, "lines"> {
  lines: DraftLine[];
}

export interface Draft {
  header: DraftHeader;
  sections: DraftSection[];
  documentDiscount?: Discount;
  notes?: string;
  terms?: string;
}

export type DraftAction =
  | { type: "header"; patch: Partial<DraftHeader> }
  | { type: "addSection"; section: DraftSection }
  | { type: "renameSection"; sectionId: string; title: string }
  | { type: "removeSection"; sectionId: string }
  | { type: "moveSection"; from: number; to: number }
  | { type: "addLines"; sectionId: string; lines: DraftLine[] }
  | { type: "updateLine"; sectionId: string; lineId: string; patch: Partial<DraftLine> }
  | { type: "removeLine"; sectionId: string; lineId: string }
  | { type: "moveLine"; sectionId: string; from: number; to: number }
  | { type: "documentDiscount"; discount: Discount | undefined }
  | { type: "text"; field: "notes" | "terms"; value: string }
  | { type: "replace"; draft: Draft };

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function mapSection(draft: Draft, sectionId: string, fn: (s: DraftSection) => DraftSection): Draft {
  return { ...draft, sections: draft.sections.map((s) => (s.id === sectionId ? fn(s) : s)) };
}

export function draftReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case "header":
      return { ...draft, header: { ...draft.header, ...action.patch } };
    case "addSection":
      return { ...draft, sections: [...draft.sections, action.section] };
    case "renameSection":
      return mapSection(draft, action.sectionId, (s) => ({ ...s, title: action.title }));
    case "removeSection":
      return draft.sections.length <= 1
        ? draft
        : { ...draft, sections: draft.sections.filter((s) => s.id !== action.sectionId) };
    case "moveSection":
      return { ...draft, sections: move(draft.sections, action.from, action.to) };
    case "addLines":
      return mapSection(draft, action.sectionId, (s) => ({ ...s, lines: [...s.lines, ...action.lines] }));
    case "updateLine":
      return mapSection(draft, action.sectionId, (s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === action.lineId ? { ...l, ...action.patch } : l)),
      }));
    case "removeLine":
      return mapSection(draft, action.sectionId, (s) => ({
        ...s,
        lines: s.lines.filter((l) => l.id !== action.lineId),
      }));
    case "moveLine":
      return mapSection(draft, action.sectionId, (s) => ({
        ...s,
        lines: move(s.lines, action.from, action.to),
      }));
    case "documentDiscount":
      return { ...draft, documentDiscount: action.discount };
    case "text":
      return { ...draft, [action.field]: action.value };
    case "replace":
      return action.draft;
  }
}

export interface SaveResponse {
  ok: true;
  version: number;
  savedAt: string;
  taxRates: { id: string; name: string; rateBp: number }[];
}
type SaveError = { ok: false; conflict?: { serverVersion: number }; error?: string; field?: string };

const AUTOSAVE_DELAY_MS = 2000;

export function useDraft(opts: { quoteId: string; initial: Draft; version: number; savedAt: string }) {
  const [draft, rawDispatch] = React.useReducer(draftReducer, opts.initial);
  const [status, setStatus] = React.useState<SaveState>({ state: "saved", at: new Date(opts.savedAt) });
  const [conflict, setConflict] = React.useState<{ serverVersion: number } | null>(null);
  const [fieldError, setFieldError] = React.useState<{ field: string; message: string } | null>(null);
  const draftRef = React.useRef(draft);
  const versionRef = React.useRef(opts.version);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = React.useRef(false);
  const again = React.useRef(false);

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const save = React.useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    setStatus({ state: "saving" });
    const { header, ...content } = draftRef.current;
    const sent = draftRef.current;
    try {
      const response = await fetch(`/api/quotes/${opts.quoteId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: versionRef.current, header, content }),
      });
      const result = (await response.json()) as SaveResponse | SaveError;
      if (result.ok) {
        versionRef.current = result.version;
        setFieldError(null);
        // Saved only describes what's on the server: if more edits came in, say so.
        setStatus(
          draftRef.current === sent ? { state: "saved", at: new Date(result.savedAt) } : { state: "unsaved" },
        );
      } else if (result.conflict) {
        setConflict(result.conflict);
        setStatus({ state: "error", message: "Not saved: a newer version exists" });
        again.current = false;
      } else {
        if (result.field) setFieldError({ field: result.field, message: result.error ?? "Check this field" });
        setStatus({ state: "error", message: result.error ?? "Couldn't save. Retry?" });
      }
    } catch {
      setStatus({ state: "error", message: "Couldn't save. Check your connection." });
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        timer.current = setTimeout(() => void save(), 0);
      } else if (draftRef.current !== sent) {
        timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
      }
    }
  }, [opts.quoteId]);

  const dispatch = React.useCallback(
    (action: DraftAction) => {
      rawDispatch(action);
      setStatus({ state: "unsaved" });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    },
    [save],
  );

  React.useEffect(() => () => clearTimeout(timer.current), []);

  /** Keep my version: overwrite the newer one (after the owner chose to). */
  const overwrite = React.useCallback(() => {
    if (!conflict) return;
    versionRef.current = conflict.serverVersion;
    setConflict(null);
    void save();
  }, [conflict, save]);

  const dirty = status.state !== "saved";
  return { draft, dispatch, status, conflict, overwrite, retry: save, saveNow: save, dirty, fieldError };
}
