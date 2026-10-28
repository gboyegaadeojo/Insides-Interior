CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`actor` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`data` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_entity_idx` ON `activity` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `activity_business_at_idx` ON `activity` (`business_id`,`at`);--> statement-breakpoint
CREATE TABLE `business` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`trading_name` text,
	`address` text,
	`phone` text,
	`email` text,
	`website` text,
	`logo_key` text,
	`gst_number` text,
	`pst_number` text,
	`timezone` text DEFAULT 'America/Winnipeg' NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`brand_color` text DEFAULT '#0F766E' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `change_request` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`line_ref` text NOT NULL,
	`kind` text NOT NULL,
	`proposed_qty_milli` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_note` text,
	`resolved_in_revision_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `change_request_conversation_idx` ON `change_request` (`conversation_id`,`status`);--> statement-breakpoint
CREATE TABLE `client` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`display_name` text NOT NULL,
	`company` text,
	`email` text,
	`phone` text,
	`billing_address` text,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`email_bounced_at` text,
	`archived_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_business_idx` ON `client` (`business_id`,`display_name`);--> statement-breakpoint
CREATE TABLE `client_contact` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`role` text,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_contact_client_idx` ON `client_contact` (`client_id`);--> statement-breakpoint
CREATE TABLE `client_credit` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`client_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`source_payment_id` text,
	`applied_to_invoice_id` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_to_invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_credit_client_idx` ON `client_credit` (`client_id`);--> statement-breakpoint
CREATE TABLE `conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`last_message_at` text,
	`owner_unread` integer DEFAULT 0 NOT NULL,
	`client_unread` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_entity_uq` ON `conversation` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `email_message` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`entity_type` text,
	`entity_id` text,
	`template` text NOT NULL,
	`to` text NOT NULL,
	`cc` text,
	`subject` text NOT NULL,
	`idempotency_key` text,
	`resend_id` text,
	`transport` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `email_message_entity_idx` ON `email_message` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_idempotency_uq` ON `email_message` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `email_message_resend_idx` ON `email_message` (`resend_id`);--> statement-breakpoint
CREATE TABLE `expense` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`date` text NOT NULL,
	`supplier` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`gst_cents` integer DEFAULT 0 NOT NULL,
	`pst_cents` integer DEFAULT 0 NOT NULL,
	`project_id` text,
	`billable` integer DEFAULT false NOT NULL,
	`receipt_key` text,
	`billed_invoice_line_id` text,
	`note` text,
	`deleted_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expense_business_date_idx` ON `expense` (`business_id`,`date`);--> statement-breakpoint
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`client_id` text NOT NULL,
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
CREATE UNIQUE INDEX `invoice_business_number_uq` ON `invoice` (`business_id`,`number`);--> statement-breakpoint
CREATE INDEX `invoice_business_status_idx` ON `invoice` (`business_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoice_client_idx` ON `invoice` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_share_token_uq` ON `invoice` (`share_token_hash`);--> statement-breakpoint
CREATE TABLE `invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`description` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`unit` text NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`line_total_cents` integer NOT NULL,
	`item_type` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `invoice_revision`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_line_invoice_idx` ON `invoice_line` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_line_tax` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_line_id` text NOT NULL,
	`tax_rate_id` text NOT NULL,
	`rate_bp` integer NOT NULL,
	`taxable_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	FOREIGN KEY (`invoice_line_id`) REFERENCES `invoice_line`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_line_tax_line_idx` ON `invoice_line_tax` (`invoice_line_id`);--> statement-breakpoint
CREATE TABLE `invoice_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`content` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`credits_cents` integer DEFAULT 0 NOT NULL,
	`content_hash` text NOT NULL,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_revision_no_uq` ON `invoice_revision` (`invoice_id`,`revision_no`);--> statement-breakpoint
CREATE TABLE `item` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`unit` text DEFAULT 'each' NOT NULL,
	`cost_cents` integer,
	`markup_bp` integer,
	`price_cents` integer NOT NULL,
	`default_tax_ids` text DEFAULT '[]' NOT NULL,
	`photo_key` text,
	`supplier` text,
	`sku` text,
	`archived_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `item_business_idx` ON `item` (`business_id`,`name`);--> statement-breakpoint
CREATE TABLE `job_run` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`run_key` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`result` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_run_key_uq` ON `job_run` (`job`,`run_key`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author` text NOT NULL,
	`client_name` text,
	`body` text NOT NULL,
	`revision_id` text,
	`attachment_keys` text DEFAULT '[]' NOT NULL,
	`hidden_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_conversation_idx` ON `message` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`title` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_user_idx` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_user_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`invoice_id` text NOT NULL,
	`client_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`received_on` text NOT NULL,
	`note` text,
	`deleted_at` text,
	`delete_reason` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_invoice_idx` ON `payment` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `payment_business_date_idx` ON `payment` (`business_id`,`received_on`);--> statement-breakpoint
CREATE TABLE `portal_event` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`event` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portal_event_entity_idx` ON `portal_event` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`client_id` text NOT NULL,
	`site_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_quote_id` text,
	`cover_photo_key` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_client_idx` ON `project` (`client_id`);--> statement-breakpoint
CREATE TABLE `quote` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`client_id` text NOT NULL,
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
CREATE UNIQUE INDEX `quote_business_number_uq` ON `quote` (`business_id`,`number`);--> statement-breakpoint
CREATE INDEX `quote_business_status_idx` ON `quote` (`business_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `quote_share_token_uq` ON `quote` (`share_token_hash`);--> statement-breakpoint
CREATE TABLE `quote_acceptance` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_revision_id` text NOT NULL,
	`selected_option_line_ids` text NOT NULL,
	`signer_name` text NOT NULL,
	`signer_email` text,
	`signature_svg` text,
	`accepted_total_cents` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`content_hash` text NOT NULL,
	`accepted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`quote_revision_id`) REFERENCES `quote_revision`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quote_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`content` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`deposit_type` text,
	`deposit_value` integer,
	`content_hash` text NOT NULL,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_revision_no_uq` ON `quote_revision` (`quote_id`,`revision_no`);--> statement-breakpoint
CREATE TABLE `room_template` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`name` text NOT NULL,
	`color` text DEFAULT 'teal' NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `room_template_line` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty_milli` integer DEFAULT 1000 NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `room_template`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `room_template_line_template_idx` ON `room_template_line` (`template_id`);--> statement-breakpoint
CREATE TABLE `sequence` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`kind` text NOT NULL,
	`prefix` text NOT NULL,
	`next_value` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sequence_business_kind_uq` ON `sequence` (`business_id`,`kind`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`business_id` text PRIMARY KEY NOT NULL,
	`payment_terms_days` integer DEFAULT 14 NOT NULL,
	`quote_valid_days` integer DEFAULT 30 NOT NULL,
	`default_deposit_bp` integer DEFAULT 5000 NOT NULL,
	`default_notes` text,
	`default_terms` text,
	`etransfer_email` text,
	`etransfer_auto_deposit` integer DEFAULT false NOT NULL,
	`etransfer_note` text,
	`cheque_payee` text,
	`mailing_address` text,
	`reminder_cadence` text DEFAULT '{"offsets":[-3,0,7,14],"maxCount":4,"quietStartHour":21,"quietEndHour":8,"quoteFollowUpDays":[3,7]}' NOT NULL,
	`email_templates` text DEFAULT '{}' NOT NULL,
	`auto_send_receipts` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `site` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`client_id` text NOT NULL,
	`label` text NOT NULL,
	`address` text,
	`archived_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `site_client_idx` ON `site` (`client_id`);--> statement-breakpoint
CREATE TABLE `tax_rate` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`name` text NOT NULL,
	`rate_bp` integer NOT NULL,
	`applies_to` text DEFAULT 'both' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tax_rate_business_idx` ON `tax_rate` (`business_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'staff' NOT NULL,
	`business_id` text,
	`disabled_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`celebrations_enabled` integer DEFAULT true NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);