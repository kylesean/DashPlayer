CREATE TABLE `dp_topic_vector` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`model` text NOT NULL,
	`dimension` integer NOT NULL,
	`vector` blob NOT NULL,
	`text_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_topic_vector_video_model_idx` ON `dp_topic_vector` (`video_id`,`model`);