import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the token utilities from app/app.css; otherwise it reads
// `text-label` as a colour and drops a real colour such as `text-teal-on`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "section", "body", "compact", "label", "kpi", "micro"],
      radius: ["control", "card", "sheet"],
      shadow: ["card", "sheet"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
