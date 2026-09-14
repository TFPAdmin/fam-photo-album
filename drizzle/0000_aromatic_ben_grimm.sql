CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `albums_owner` ON `albums` (`owner`);--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`upload_id` text,
	`status` text NOT NULL,
	`album` text,
	`created` integer NOT NULL,
	`taken` integer,
	`deleted` integer,
	`thumbnail` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_owner_created` ON `media` (`owner`,`created`);--> statement-breakpoint
CREATE TABLE `parts` (
	`media` text NOT NULL,
	`part` integer NOT NULL,
	`etag` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`verified` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`media`, `part`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`media` text NOT NULL,
	`recipient` text NOT NULL,
	PRIMARY KEY(`media`, `recipient`)
);
--> statement-breakpoint
CREATE INDEX `shares_recipient` ON `shares` (`recipient`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`password` text NOT NULL,
	`role` text NOT NULL,
	`must_change` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);