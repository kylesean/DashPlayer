CREATE TABLE `dp_role_play_turn` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_key` text NOT NULL,
	`turn` integer NOT NULL,
	`video_id` text,
	`file_hash` text,
	`partner_line` text NOT NULL,
	`partner_index` integer,
	`response_text` text NOT NULL,
	`level` text NOT NULL,
	`feedback` text,
	`improved` text,
	`used_expressions_json` text,
	`source` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dp_role_play_turn_session_turn` ON `dp_role_play_turn` (`session_key`,`turn`);