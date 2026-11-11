CREATE TABLE `dp_media_signal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`kind` text NOT NULL,
	`algorithm_version` integer NOT NULL,
	`input_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_media_signal_video_kind_version_idx` ON `dp_media_signal` (`video_id`,`kind`,`algorithm_version`);