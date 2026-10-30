CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_endpoint_uq` ON `push_subscription` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscription_user_idx` ON `push_subscription` (`user_id`);--> statement-breakpoint
ALTER TABLE `notification` ADD `delivered_at` text;--> statement-breakpoint
CREATE INDEX `notification_delivered_idx` ON `notification` (`delivered_at`);--> statement-breakpoint
-- Notifications that exist already were seen in the app; never push or email them now.
UPDATE `notification` SET `delivered_at` = `created_at` WHERE `delivered_at` IS NULL;
