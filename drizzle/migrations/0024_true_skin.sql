CREATE TABLE `dp_learning_prompt_preset` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`preset_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`role_mode` text DEFAULT 'custom' NOT NULL,
	`system_prompt` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_dp_learning_prompt_preset_id` ON `dp_learning_prompt_preset` (`preset_id`);--> statement-breakpoint
CREATE TABLE `dp_sentence_study_note` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sentence_key` text NOT NULL,
	`video_id` text NOT NULL,
	`file_hash` text NOT NULL,
	`sentence_index` integer NOT NULL,
	`original_text` text NOT NULL,
	`study_card_json` text,
	`note_summary` text DEFAULT '' NOT NULL,
	`messages_json` text DEFAULT '[]' NOT NULL,
	`preset_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_dp_sentence_study_note_key` ON `dp_sentence_study_note` (`sentence_key`);--> statement-breakpoint
CREATE INDEX `idx_dp_sentence_study_note_file_sentence` ON `dp_sentence_study_note` (`file_hash`,`sentence_index`);