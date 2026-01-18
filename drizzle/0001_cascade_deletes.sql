-- Add CASCADE DELETE to foreign keys
-- SQLite doesn't support ALTER CONSTRAINT, so we need to recreate tables

-- Recreate textures table with cascade deletes
CREATE TABLE `textures_new` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`preview_filename` text,
	`is_seamless` integer DEFAULT false,
	`folder_id` text,
	`collection_id` text,
	`uploader_id` text,
	`source` text,
	`source_url` text,
	`created_at` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

INSERT INTO `textures_new` SELECT * FROM `textures`;
DROP TABLE `textures`;
ALTER TABLE `textures_new` RENAME TO `textures`;

-- Recreate models table with cascade deletes
CREATE TABLE `models_new` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`folder_id` text,
	`uploader_id` text,
	`source` text,
	`source_url` text,
	`created_at` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

INSERT INTO `models_new` SELECT * FROM `models`;
DROP TABLE `models`;
ALTER TABLE `models_new` RENAME TO `models`;

-- Recreate texture_tags table with cascade deletes
CREATE TABLE `texture_tags_new` (
	`texture_id` text NOT NULL,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`texture_id`) REFERENCES `textures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);

INSERT INTO `texture_tags_new` SELECT * FROM `texture_tags`;
DROP TABLE `texture_tags`;
ALTER TABLE `texture_tags_new` RENAME TO `texture_tags`;
