-- Views read quote and invoice; drop them while those tables are rebuilt.
DROP VIEW IF EXISTS client_balance;--> statement-breakpoint
DROP VIEW IF EXISTS project_financials;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`client_id` text,
	`project_id` text,
	`quote_id` text,
	`kind` text DEFAULT 'standard' NOT NULL,
	`number` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`issue_date` text,
	`due_date` text,
	`current_revision_id` text,
	`draft_content` text,
	`draft_version` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`share_token_hash` text,
	`reminders_paused` integer DEFAULT false NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`voided_at` text,
	`void_reason` text,
	`reissue_of_id` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_invoice`("id", "business_id", "created_at", "updated_at", "created_by", "client_id", "project_id", "quote_id", "kind", "number", "status", "issue_date", "due_date", "current_revision_id", "draft_content", "draft_version", "currency", "share_token_hash", "reminders_paused", "requires_approval", "voided_at", "void_reason", "reissue_of_id") SELECT "id", "business_id", "created_at", "updated_at", "created_by", "client_id", "project_id", "quote_id", "kind", "number", "status", "issue_date", "due_date", "current_revision_id", "draft_content", "draft_version", "currency", "share_token_hash", "reminders_paused", "requires_approval", "voided_at", "void_reason", "reissue_of_id" FROM `invoice`;--> statement-breakpoint
DROP TABLE `invoice`;--> statement-breakpoint
ALTER TABLE `__new_invoice` RENAME TO `invoice`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_business_number_uq` ON `invoice` (`business_id`,`number`);--> statement-breakpoint
CREATE INDEX `invoice_business_status_idx` ON `invoice` (`business_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoice_client_idx` ON `invoice` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_share_token_uq` ON `invoice` (`share_token_hash`);--> statement-breakpoint
CREATE TABLE `__new_quote` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`client_id` text,
	`project_id` text,
	`site_id` text,
	`title` text,
	`number` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_revision_id` text,
	`draft_content` text,
	`draft_version` integer DEFAULT 0 NOT NULL,
	`deposit_type` text,
	`deposit_value` integer,
	`valid_until` text,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`share_token_hash` text,
	`follow_up_paused` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_quote`("id", "business_id", "created_at", "updated_at", "created_by", "client_id", "project_id", "site_id", "title", "number", "status", "current_revision_id", "draft_content", "draft_version", "deposit_type", "deposit_value", "valid_until", "currency", "share_token_hash", "follow_up_paused") SELECT "id", "business_id", "created_at", "updated_at", "created_by", "client_id", "project_id", "site_id", "title", "number", "status", "current_revision_id", "draft_content", "draft_version", "deposit_type", "deposit_value", "valid_until", "currency", "share_token_hash", "follow_up_paused" FROM `quote`;--> statement-breakpoint
DROP TABLE `quote`;--> statement-breakpoint
ALTER TABLE `__new_quote` RENAME TO `quote`;--> statement-breakpoint
CREATE UNIQUE INDEX `quote_business_number_uq` ON `quote` (`business_id`,`number`);--> statement-breakpoint
CREATE INDEX `quote_business_status_idx` ON `quote` (`business_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `quote_share_token_uq` ON `quote` (`share_token_hash`);--> statement-breakpoint
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
