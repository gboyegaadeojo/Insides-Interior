import { cn } from "~/lib/utils";

/**
 * A miniature client document in the business brand colour (FR-SET-09 live
 * preview). Client documents use the brand colour plus neutrals only
 * (DS-COL-08); the brand value is the owner's, so it is applied inline.
 */
export function BrandPreview({
  brandColor,
  onBrand,
  businessName,
  logoUrl,
  className,
}: {
  brandColor: string;
  /** Text colour used on the brand colour (white or near-black). */
  onBrand: string;
  businessName: string;
  logoUrl?: string;
  className?: string;
}) {
  return (
    <div
      data-theme="light"
      aria-label="Sample quote in your brand colour"
      role="img"
      className={cn("rounded-card border border-border bg-surface p-5 text-primary shadow-card", className)}
    >
      <div className="flex items-start justify-between gap-4">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-8 max-w-40 object-contain" />
        ) : (
          <span className="font-display text-section">{businessName}</span>
        )}
        <div className="text-right">
          <p className="font-display text-section" style={{ color: brandColor }}>
            Quote
          </p>
          <p className="text-micro text-secondary">Q-1042</p>
        </div>
      </div>
      <div className="mt-3 h-0.5 rounded-full" style={{ background: brandColor }} />
      <p className="mt-4 font-display text-label font-semibold" style={{ color: brandColor }}>
        Living room
      </p>
      <div className="mt-2 flex justify-between text-label font-normal">
        <span>Drapery fabric · 4.5 yd</span>
        <span className="tabular">$192.38</span>
      </div>
      <div className="mt-1 flex justify-between text-label font-normal">
        <span>Design consultation · 3 h</span>
        <span className="tabular">$285.00</span>
      </div>
      <div
        className="mt-4 flex justify-between rounded-control px-3 py-2 font-semibold"
        style={{ background: brandColor, color: onBrand }}
      >
        <span>Total</span>
        <span className="tabular">$534.67</span>
      </div>
      <div
        className="mt-3 flex h-10 items-center justify-center rounded-control font-semibold"
        style={{ background: brandColor, color: onBrand }}
      >
        Approve quote
      </div>
    </div>
  );
}
