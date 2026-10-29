ALTER TABLE `expense` ADD `billed_invoice_id` text;--> statement-breakpoint
CREATE INDEX `expense_billed_invoice_idx` ON `expense` (`billed_invoice_id`);