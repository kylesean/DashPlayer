CREATE TABLE `dp_review_card` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`due_at` text NOT NULL,
	`state` text DEFAULT 'new' NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`last_review_at` text,
	`last_rating` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_review_card_word_unique` ON `dp_review_card` (`word`);--> statement-breakpoint
CREATE INDEX `dp_review_card_due_idx` ON `dp_review_card` (`due_at`);--> statement-breakpoint
ALTER TABLE `dp_word_encounter` ADD `score` real;--> statement-breakpoint
ALTER TABLE `dp_word_encounter` ADD `rating` text;