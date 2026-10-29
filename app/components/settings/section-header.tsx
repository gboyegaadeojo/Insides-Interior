import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";

/** Section heading with a Back link to the list on phone and tablet portrait. */
export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <Link
        to="/settings"
        className="mb-2 -ml-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 font-semibold text-accent wide:hidden"
      >
        <ChevronLeft className="size-5" aria-hidden />
        Settings
      </Link>
      <h2 className="font-display text-title">{title}</h2>
      {description && <p className="mt-1 text-secondary">{description}</p>}
    </div>
  );
}
