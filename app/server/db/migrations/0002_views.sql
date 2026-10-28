-- Derived balances (SPEC 8.3): computed from source rows, never stored on the parent.

-- Client lifetime billed, paid and outstanding (FR-CLI-03). Billed counts the
-- current revision of every sent, non-void invoice; paid counts payments that
-- aren't deleted; credits are overpayments applied to invoices.
CREATE VIEW `client_balance` AS
SELECT
  c.id AS client_id,
  c.business_id AS business_id,
  COALESCE((
    SELECT SUM(r.total_cents) FROM invoice i
    JOIN invoice_revision r ON r.id = i.current_revision_id
    WHERE i.client_id = c.id AND i.status NOT IN ('draft', 'void')
  ), 0) AS billed_cents,
  COALESCE((
    SELECT SUM(p.amount_cents) FROM payment p
    JOIN invoice i ON i.id = p.invoice_id
    WHERE p.client_id = c.id AND p.deleted_at IS NULL AND i.status <> 'void'
  ), 0) AS paid_cents,
  COALESCE((
    SELECT SUM(cc.amount_cents) FROM client_credit cc
    WHERE cc.client_id = c.id AND cc.applied_to_invoice_id IS NOT NULL
  ), 0) AS credits_applied_cents,
  COALESCE((
    SELECT SUM(cc.amount_cents) FROM client_credit cc
    WHERE cc.client_id = c.id AND cc.applied_to_invoice_id IS NULL
  ), 0) AS credit_available_cents,
  (
    SELECT MAX(a.at) FROM activity a
    WHERE a.entity_type = 'client' AND a.entity_id = c.id
  ) AS last_activity_at
FROM client c;
--> statement-breakpoint
-- Project figures (FR-PRJ-02). Contract value is what the client approved
-- (accepted total including chosen options) on approved quotes.
CREATE VIEW `project_financials` AS
SELECT
  p.id AS project_id,
  p.business_id AS business_id,
  COALESCE((
    SELECT SUM(a.accepted_total_cents) FROM quote q
    JOIN quote_acceptance a ON a.quote_revision_id = q.current_revision_id
    WHERE q.project_id = p.id AND q.status = 'approved'
  ), 0) AS contract_cents,
  COALESCE((
    SELECT SUM(r.total_cents) FROM invoice i
    JOIN invoice_revision r ON r.id = i.current_revision_id
    WHERE i.project_id = p.id AND i.status NOT IN ('draft', 'void')
  ), 0) AS invoiced_cents,
  COALESCE((
    SELECT SUM(pay.amount_cents) FROM payment pay
    JOIN invoice i ON i.id = pay.invoice_id
    WHERE i.project_id = p.id AND pay.deleted_at IS NULL AND i.status <> 'void'
  ), 0) AS paid_cents,
  COALESCE((
    SELECT SUM(e.amount_cents) FROM expense e
    WHERE e.project_id = p.id AND e.deleted_at IS NULL
  ), 0) AS expenses_cents
FROM project p;
