CREATE TABLE `dp_saved_sentence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sentence_key` text NOT NULL,
	`video_id` text NOT NULL,
	`video_title` text DEFAULT '' NOT NULL,
	`file_hash` text NOT NULL,
	`sentence_index` integer NOT NULL,
	`start_time` real DEFAULT 0 NOT NULL,
	`end_time` real DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`text_zh` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`tag` text DEFAULT 'general' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_dp_saved_sentence_key` ON `dp_saved_sentence` (`sentence_key`);--> statement-breakpoint
CREATE INDEX `idx_dp_saved_sentence_video` ON `dp_saved_sentence` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_dp_saved_sentence_created` ON `dp_saved_sentence` (`created_at`);