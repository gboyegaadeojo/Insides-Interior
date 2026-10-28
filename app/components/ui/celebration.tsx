import * as React from "react";
import { cn } from "~/lib/utils";

const PIECE_TONES = [
  "bg-teal-base",
  "bg-plum-base",
  "bg-indigo-base",
  "bg-saffron-base",
  "bg-sage-base",
  "bg-roseclay-base",
];
const PIECES = 28;

/**
 * A short stamp plus confetti for meaningful moments (DS-MOT-04): "Approved" or
 * "Paid". Skipped entirely when `enabled` is false (Settings) and reduced to the
 * stamp alone under prefers-reduced-motion (DS-MOT-05).
 */
export function Celebration({
  show,
  label,
  enabled = true,
  onDone,
}: {
  show: boolean;
  label: "Approved" | "Paid";
  enabled?: boolean;
  onDone?: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const pieces = React.useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        tone: PIECE_TONES[i % PIECE_TONES.length]!,
        x: ((i * 37) % 100) - 50,
        delay: (i % 7) * 30,
        rotate: (i * 47) % 360,
      })),
    [],
  );

  React.useEffect(() => {
    if (!show || !enabled) return;
    const timer = setTimeout(() => onDone?.(), reduced ? 1200 : 1400);
    return () => clearTimeout(timer);
  }, [show, enabled, reduced, onDone]);

  if (!show || !enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center" aria-hidden>
      {!reduced &&
        pieces.map((p, i) => (
          <span
            key={i}
            className={cn("absolute top-1/2 left-1/2 h-3 w-1.5 rounded-sm", p.tone)}
            style={{
              animation: `confetti var(--duration-celebrate) var(--easing-out) ${p.delay}ms both`,
              ["--x" as string]: `${p.x}vw`,
              ["--r" as string]: `${p.rotate}deg`,
            }}
          />
        ))}
      <span
        className="rounded-card border-4 border-sage-base bg-surface px-6 py-2 font-display text-display tracking-wide text-sage-ink uppercase shadow-sheet"
        style={{ animation: reduced ? undefined : "stamp var(--duration-celebrate) var(--easing-out) both" }}
      >
        {label}
      </span>
      <style>{`
        @keyframes confetti {
          0% { transform: translate(-50%, -50%) rotate(0); opacity: 1; }
          100% { transform: translate(calc(-50% + var(--x)), 40vh) rotate(var(--r)); opacity: 0; }
        }
        @keyframes stamp {
          0% { transform: scale(1.6) rotate(-12deg); opacity: 0; }
          40% { transform: scale(0.95) rotate(-8deg); opacity: 1; }
          100% { transform: scale(1) rotate(-8deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    // Server render: assume reduced motion so nothing animates before hydration.
    () => true,
  );
}
