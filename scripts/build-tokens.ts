// Writes app/styles/tokens.css from app/styles/tokens.ts. Run with `npm run tokens`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../app/styles/tokens.ts";

const out = fileURLToPath(new URL("../app/styles/tokens.css", import.meta.url));
writeFileSync(out, renderTokensCss());
console.log(`wrote ${out}`);
