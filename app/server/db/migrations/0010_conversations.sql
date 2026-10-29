ALTER TABLE `change_request` ADD `line_label` text;--> statement-breakpoint
CREATE INDEX `conversation_business_last_idx` ON `conversation` (`business_id`,`last_message_at`);