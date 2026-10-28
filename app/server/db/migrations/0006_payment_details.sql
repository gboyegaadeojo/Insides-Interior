ALTER TABLE `expense` ADD `vat_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `bank_name` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `account_name` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `account_number` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `payment_note` text;