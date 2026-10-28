// Seed data as SQL (SPEC 14.4 phase 2), shared by scripts/seed.ts and the
// integration tests. Every insert is INSERT OR IGNORE on fixed ids, so seeding
// twice changes nothing.

export const SEED_IDS = {
  business: "biz_main",
  gst: "tax_gst",
  pst: "tax_mb_pst",
  quoteSeq: "seq_quote",
  invoiceSeq: "seq_invoice",
  owner: "usr_owner",
  e2eOwner: "usr_e2e_owner",
} as const;

export const E2E_OWNER_EMAIL = "e2e-owner@example.com";

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;

export function seedStatements(opts: {
  ownerEmail?: string;
  ownerName?: string;
  businessName?: string;
  e2e?: boolean;
}): string[] {
  const now = Date.now();
  const iso = q(new Date(now).toISOString());
  const biz = q(SEED_IDS.business);
  const statements = [
    `INSERT OR IGNORE INTO business (id, legal_name, trading_name, timezone, currency, brand_color, created_at, updated_at) VALUES (${biz}, ${q(opts.businessName ?? "Insides Interior Limited")}, 'Insides Interior', 'America/Winnipeg', 'CAD', '#0F766E', ${iso}, ${iso})`,
    `INSERT OR IGNORE INTO settings (business_id, updated_at) VALUES (${biz}, ${iso})`,
    `INSERT OR IGNORE INTO tax_rate (id, business_id, name, rate_bp, applies_to, is_default, position, created_at, updated_at) VALUES (${q(SEED_IDS.gst)}, ${biz}, 'GST', 500, 'both', 1, 0, ${iso}, ${iso})`,
    `INSERT OR IGNORE INTO tax_rate (id, business_id, name, rate_bp, applies_to, is_default, position, created_at, updated_at) VALUES (${q(SEED_IDS.pst)}, ${biz}, 'PST (MB RST)', 700, 'both', 1, 1, ${iso}, ${iso})`,
    `INSERT OR IGNORE INTO sequence (id, business_id, kind, prefix, next_value, created_at, updated_at) VALUES (${q(SEED_IDS.quoteSeq)}, ${biz}, 'quote', 'Q-', 1001, ${iso}, ${iso})`,
    `INSERT OR IGNORE INTO sequence (id, business_id, kind, prefix, next_value, created_at, updated_at) VALUES (${q(SEED_IDS.invoiceSeq)}, ${biz}, 'invoice', 'INV-', 1001, ${iso}, ${iso})`,
  ];
  const owner = (id: string, email: string, name: string) =>
    `INSERT OR IGNORE INTO user (id, name, email, email_verified, role, business_id, created_at, updated_at) VALUES (${q(id)}, ${q(name)}, ${q(email.toLowerCase())}, 1, 'owner', ${biz}, ${now}, ${now})`;
  if (opts.ownerEmail) statements.push(owner(SEED_IDS.owner, opts.ownerEmail, opts.ownerName ?? "Owner"));
  if (opts.e2e) statements.push(owner(SEED_IDS.e2eOwner, E2E_OWNER_EMAIL, "Test Owner"));
  return statements;
}
