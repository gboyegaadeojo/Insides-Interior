CREATE TABLE `legacy_import` (
	`business_id` text NOT NULL,
	`kind` text NOT NULL,
	`legacy_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_import_uq` ON `legacy_import` (`business_id`,`kind`,`legacy_id`);