CREATE TABLE `dp_production_practice_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`video_id` text,
	`file_hash` text,
	`sentence_index` integer,
	`sentence_text` text NOT NULL,
	`response_text` text NOT NULL,
	`level` text NOT NULL,
	`feedback` text,
	`improved` text,
	`detail_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dp_production_practice_record_file_created` ON `dp_production_practice_record` (`file_hash`,`created_at`);