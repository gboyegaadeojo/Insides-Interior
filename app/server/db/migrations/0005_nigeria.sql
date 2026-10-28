-- Nigeria (docs/decisions.md). Registration numbers become TIN and RC number.
ALTER TABLE `business` RENAME COLUMN `gst_number` TO `tin`;--> statement-breakpoint
ALTER TABLE `business` RENAME COLUMN `pst_number` TO `rc_number`;--> statement-breakpoint
UPDATE `business` SET `currency` = 'NGN', `timezone` = 'Africa/Lagos';--> statement-breakpoint
UPDATE `quote` SET `currency` = 'NGN' WHERE `currency` = 'CAD';--> statement-breakpoint
UPDATE `invoice` SET `currency` = 'NGN' WHERE `currency` = 'CAD';--> statement-breakpoint
-- The seeded GST rate becomes VAT 7.5%, off by default; the Manitoba PST is
-- archived (documents that already used it keep their own copy of the rate).
UPDATE `tax_rate` SET `name` = 'VAT', `rate_bp` = 750, `is_default` = 0 WHERE `id` = 'tax_gst';--> statement-breakpoint
UPDATE `tax_rate` SET `is_default` = 0, `archived_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `id` = 'tax_mb_pst' AND `archived_at` IS NULL;--> statement-breakpoint
-- Addresses say "state", not "province".
UPDATE `business` SET `address` = json_remove(json_set(`address`, '$.state', json_extract(`address`, '$.province')), '$.province') WHERE json_type(`address`, '$.province') IS NOT NULL;--> statement-breakpoint
UPDATE `client` SET `billing_address` = json_remove(json_set(`billing_address`, '$.state', json_extract(`billing_address`, '$.province')), '$.province') WHERE json_type(`billing_address`, '$.province') IS NOT NULL;--> statement-breakpoint
UPDATE `site` SET `address` = json_remove(json_set(`address`, '$.state', json_extract(`address`, '$.province')), '$.province') WHERE json_type(`address`, '$.province') IS NOT NULL;
