ALTER TABLE `business` ADD `signature_svg` text;--> statement-breakpoint
ALTER TABLE `business` ADD `signatory_name` text;--> statement-breakpoint
ALTER TABLE `business` ADD `signatory_title` text;--> statement-breakpoint
-- Owner requests (docs/decisions.md): an 85% deposit and 7-day quotes by default.
-- Only rows still on the old defaults change; column defaults stay (no table rebuild).
UPDATE `settings` SET `default_deposit_bp` = 8500 WHERE `default_deposit_bp` = 5000;--> statement-breakpoint
UPDATE `settings` SET `quote_valid_days` = 7 WHERE `quote_valid_days` = 30;
