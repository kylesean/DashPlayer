CREATE TABLE `dp_word_encounter` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`lemma` text NOT NULL,
	`action` text NOT NULL,
	`video_id` text,
	`file_hash` text,
	`sentence_index` integer,
	`sentence_hash` text,
	`context` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dp_word_encounter_lemma_idx` ON `dp_word_encounter` (`lemma`);--> statement-breakpoint
CREATE INDEX `dp_word_encounter_created_idx` ON `dp_word_encounter` (`created_at`);--> statement-breakpoint
ALTER TABLE `dp_words` ADD `status` text DEFAULT 'learning' NOT NULL;--> statement-breakpoint
ALTER TABLE `dp_words` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `dp_words` ADD `mastery` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dp_words` ADD `confidence` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dp_words` ADD `last_seen_at` text;--> statement-breakpoint
ALTER TABLE `dp_words` ADD `mastered_at` text;--> statement-breakpoint
CREATE INDEX `dp_words_status_source_idx` ON `dp_words` (`status`,`source`);
