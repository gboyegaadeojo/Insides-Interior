import * as React from "react";
import { cn } from "~/lib/utils";

const PAPER_WIDTH_PX = 816; // 8.5in at 96 CSS px per inch

/**
 * Shows the document at a fixed US Letter paper ratio scaled to fit its
 * container (DS-SPC-06), with height reserved so nothing shifts (DS-PERF).
 */
export function Paper({ children, className }: { children: React.ReactNode; className?: string }) {
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [height, setHeight] = React.useState<number | undefined>(undefined);

  React.useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const update = () => {
      const s = Math.min(1, o.clientWidth / PAPER_WIDTH_PX);
      setScale(s);
      setHeight(i.offsetHeight * s);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(o);
    observer.observe(i);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outer} className={cn("w-full overflow-hidden", className)} style={{ height }}>
      <div
        ref={inner}
        className="origin-top-left rounded-control shadow-sheet"
        style={{ width: PAPER_WIDTH_PX, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
