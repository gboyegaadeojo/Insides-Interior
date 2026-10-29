import { Camera, FileText, ImageUp, RotateCw, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "~/components/ui/button";
import { RECEIPT_ACCEPT, RECEIPT_MAX_BYTES } from "../constants";

// FR-EXP-01: a receipt is uploaded the moment it's taken or chosen, with real
// progress (XHR upload events). "Stored" shows only after the server answers
// that R2 has it; a failure says so and offers Retry. The stored key rides in
// a hidden field so the expense form saves it.

type State =
  | { kind: "empty" }
  | { kind: "uploading"; file: File; percent: number; preview: string | null }
  | { kind: "stored"; key: string; url: string; pdf: boolean }
  | { kind: "failed"; file: File; message: string };

export interface StoredReceipt {
  key: string;
  url: string;
  pdf: boolean;
}

function upload(file: File, onProgress: (percent: number) => void) {
  return new Promise<StoredReceipt>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/expenses/receipt");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new Error("The upload didn't finish. Check your connection."));
    xhr.onload = () => {
      const body = xhr.response as {
        key?: string;
        url?: string;
        contentType?: string;
        error?: string;
      } | null;
      if (xhr.status === 200 && body?.key && body.url) {
        resolve({ key: body.key, url: body.url, pdf: body.contentType === "application/pdf" });
      } else {
        reject(new Error(body?.error ?? "The receipt couldn't be stored. Try again."));
      }
    };
    const form = new FormData();
    form.append("receipt", file);
    xhr.send(form);
  });
}

export function ReceiptField({
  initial,
  pendingFile,
  error,
  onBusyChange,
}: {
  initial: StoredReceipt | null;
  /** A photo taken before the sheet opened (camera first on touch). */
  pendingFile?: File | null;
  error?: string;
  /** Lets the form disable Save while an upload is in flight. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [state, setState] = React.useState<State>(
    initial ? { kind: "stored", ...initial } : { kind: "empty" },
  );
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const run = React.useRef(0);

  const start = React.useCallback(
    async (file: File) => {
      const id = ++run.current;
      if (file.size > RECEIPT_MAX_BYTES) {
        setState({ kind: "failed", file, message: "The receipt must be 10 MB or smaller." });
        return;
      }
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setState({ kind: "uploading", file, percent: 0, preview });
      onBusyChange?.(true);
      try {
        const stored = await upload(file, (percent) => {
          if (run.current === id) setState((s) => (s.kind === "uploading" ? { ...s, percent } : s));
        });
        if (run.current === id) setState({ kind: "stored", ...stored });
      } catch (e) {
        if (run.current === id) setState({ kind: "failed", file, message: (e as Error).message });
      } finally {
        if (preview) URL.revokeObjectURL(preview);
        if (run.current === id) onBusyChange?.(false);
      }
    },
    [onBusyChange],
  );

  React.useEffect(() => {
    // Started after the effect so the first state change is not synchronous within it.
    if (pendingFile) void Promise.resolve().then(() => start(pendingFile));
  }, [pendingFile, start]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void start(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-label font-semibold" id="receipt-label">
        Receipt
      </p>
      <input type="hidden" name="receiptKey" value={state.kind === "stored" ? state.key : ""} />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={pick}
      />
      <input
        ref={fileRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="receipt-file"
        onChange={pick}
      />

      {state.kind === "stored" && (
        <div className="flex items-center gap-3 rounded-card border border-border p-2">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control bg-roseclay-tint">
            {state.pdf ? (
              <FileText className="size-7 text-roseclay-base" aria-hidden />
            ) : (
              <img src={state.url} alt="Receipt photo" className="size-full object-cover" />
            )}
          </span>
          <p className="min-w-0 flex-1 text-label font-semibold text-sage-ink" role="status">
            Receipt stored
          </p>
          <Button type="button" variant="ghost" onClick={() => setState({ kind: "empty" })}>
            <Trash2 aria-hidden />
            Remove
          </Button>
        </div>
      )}

      {state.kind === "uploading" && (
        <div className="flex items-center gap-3 rounded-card border border-border p-2">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control bg-roseclay-tint">
            {state.preview ? (
              <img src={state.preview} alt="" className="size-full object-cover opacity-70" />
            ) : (
              <FileText className="size-7 text-roseclay-base" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-label font-semibold" aria-live="polite">
              Uploading receipt… {state.percent}%
            </p>
            <div
              role="progressbar"
              aria-labelledby="receipt-label"
              aria-valuenow={state.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"
            >
              <div
                className="h-full rounded-full bg-roseclay-base motion-safe:transition-[width] motion-safe:duration-fast"
                style={{ width: `${state.percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {state.kind === "failed" && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-danger-base bg-danger-tint p-3"
        >
          <p className="text-label font-semibold text-danger-ink">{state.message}</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void start(state.file)}>
              <RotateCw aria-hidden />
              Retry
            </Button>
            <Button type="button" variant="ghost" onClick={() => setState({ kind: "empty" })}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(state.kind === "empty" || state.kind === "stored") && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => cameraRef.current?.click()}>
            <Camera aria-hidden />
            {state.kind === "stored" ? "Retake photo" : "Take photo"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => fileRef.current?.click()}>
            <ImageUp aria-hidden />
            Choose file
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-label font-semibold text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
