CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
ALTER TABLE `folders` ADD `file_count` integer DEFAULT 0;--> statement-breakpoint
UPDATE `folders`
SET `file_count` = (
	SELECT COUNT(*) FROM `files` WHERE `files`.`folder_id` = `folders`.`id`
);--> statement-breakpoint
CREATE INDEX `idx_folders_parent_id` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_files_folder_id` ON `files` (`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_files_kind` ON `files` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_files_created_at` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_files_kind_created` ON `files` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);
