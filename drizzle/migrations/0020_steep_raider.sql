CREATE TABLE `dp_scene_index` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_hash` text NOT NULL,
	`algorithm_version` integer NOT NULL,
	`input_hash` text NOT NULL,
	`boundaries_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_scene_index_file_version_idx` ON `dp_scene_index` (`file_hash`,`algorithm_version`);