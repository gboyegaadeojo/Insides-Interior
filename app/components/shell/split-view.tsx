import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * List/detail split view (DS-NAV-05): side by side from tablet landscape up
 * (list 360–420px), push navigation below that: the detail replaces the list
 * when `showDetail` is true. Routes drive `showDetail` so Back restores the list
 * and its scroll position.
 */
export function SplitView({
  list,
  detail,
  showDetail,
  emptyDetail,
  className,
}: {
  list: React.ReactNode;
  detail?: React.ReactNode;
  showDetail: boolean;
  /** Shown in the detail pane on wide screens when nothing is selected. */
  emptyDetail?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("wide:grid wide:grid-cols-[minmax(360px,420px)_1fr] wide:gap-6", className)}>
      <div className={cn("@container min-w-0", showDetail && "hidden wide:block")}>{list}</div>
      <div className={cn("@container min-w-0", !showDetail && "hidden wide:block")}>
        {showDetail ? detail : emptyDetail}
      </div>
    </div>
  );
}
