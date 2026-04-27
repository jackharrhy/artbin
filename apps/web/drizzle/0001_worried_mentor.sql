ALTER TABLE `users` ADD `fourm_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_fourm_id_unique` ON `users` (`fourm_id`);