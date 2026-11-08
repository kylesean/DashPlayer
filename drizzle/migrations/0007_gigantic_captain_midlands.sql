CREATE TABLE `dp_sentence_practice_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_hash` text NOT NULL,
	`sentence_index` integer NOT NULL,
	`mode` text NOT NULL,
	`score` real NOT NULL,
	`transcript` text,
	`detail_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dp_sentence_practice_record_file_sentence` ON `dp_sentence_practice_record` (`file_hash`,`sentence_index`);