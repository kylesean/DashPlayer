CREATE TABLE `dp_recommendation_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`action` text NOT NULL,
	`surface` text DEFAULT 'home' NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`reason_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dp_recommendation_event_video_created_idx` ON `dp_recommendation_event` (`video_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `dp_recommendation_event_created_idx` ON `dp_recommendation_event` (`created_at`);
