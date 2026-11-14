CREATE TABLE `dp_task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'init' NOT NULL,
	`description` text DEFAULT '任务创建成功',
	`result` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
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
CREATE UNIQUE INDEX `dp_media_signal_video_kind_version_idx` ON `dp_media_signal` (`video_id`,`kind`,`algorithm_version`);--> statement-breakpoint
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
CREATE INDEX `idx_dp_production_practice_record_file_created` ON `dp_production_practice_record` (`file_hash`,`created_at`);--> statement-breakpoint
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
CREATE INDEX `dp_recommendation_event_created_idx` ON `dp_recommendation_event` (`created_at`);--> statement-breakpoint
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
CREATE INDEX `idx_dp_role_play_turn_session_turn` ON `dp_role_play_turn` (`session_key`,`turn`);--> statement-breakpoint
CREATE TABLE `dp_saved_sentence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sentence_key` text NOT NULL,
	`video_id` text NOT NULL,
	`video_title` text DEFAULT '' NOT NULL,
	`file_hash` text NOT NULL,
	`sentence_index` integer NOT NULL,
	`start_time` real DEFAULT 0 NOT NULL,
	`end_time` real DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`text_zh` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`tag` text DEFAULT 'general' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_dp_saved_sentence_key` ON `dp_saved_sentence` (`sentence_key`);--> statement-breakpoint
CREATE INDEX `idx_dp_saved_sentence_video` ON `dp_saved_sentence` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_dp_saved_sentence_created` ON `dp_saved_sentence` (`created_at`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `dp_scene_index_file_version_idx` ON `dp_scene_index` (`file_hash`,`algorithm_version`);--> statement-breakpoint
CREATE TABLE `dp_sentence_practice_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_hash` text NOT NULL,
	`sentence_index` integer NOT NULL,
	`mode` text NOT NULL,
	`score` real NOT NULL,
	`transcript` text,
	`audio_file` text,
	`detail_json` text,
	`rhythm_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dp_sentence_practice_record_file_sentence` ON `dp_sentence_practice_record` (`file_hash`,`sentence_index`);--> statement-breakpoint
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
CREATE INDEX `idx_dp_sentence_study_note_file_sentence` ON `dp_sentence_study_note` (`file_hash`,`sentence_index`);--> statement-breakpoint
CREATE TABLE `dp_sentence_translates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sentence` text NOT NULL,
	`translate` text,
	`mode` text DEFAULT 'tencent' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_sentence_translates_sentence_mode_unique` ON `dp_sentence_translates` (`sentence`,`mode`);--> statement-breakpoint
CREATE TABLE `dp_subtitle_timestamp_adjustment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`subtitle_name` text,
	`subtitle_hash` text,
	`start_at` integer,
	`end_at` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_subtitle_timestamp_adjustment_key_unique` ON `dp_subtitle_timestamp_adjustment` (`key`);--> statement-breakpoint
CREATE TABLE `dp_sys_conf` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_sys_conf_key_unique` ON `dp_sys_conf` (`key`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `dp_topic_vector_video_model_idx` ON `dp_topic_vector` (`video_id`,`model`);--> statement-breakpoint
CREATE TABLE `dp_video_learning_clip` (
	`key` text PRIMARY KEY NOT NULL,
	`video_name` text,
	`srt_clip` text,
	`srt_context` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dp_video_learning_clip_word` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clip_key` text NOT NULL,
	`word` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dp_video_learning_clip_word_word_clip_key_unique` ON `dp_video_learning_clip_word` (`word`,`clip_key`);--> statement-breakpoint
CREATE TABLE `dp_watch_history` (
	`id` text PRIMARY KEY NOT NULL,
	`project_name` text NOT NULL,
	`project_path` text NOT NULL,
	`project_type` integer NOT NULL,
	`current_position` integer DEFAULT 0 NOT NULL,
	`srt_file` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `base_path_file_name_idx` ON `dp_watch_history` (`project_name`,`project_path`);--> statement-breakpoint
CREATE TABLE `dp_watch_history_ext` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`watch_history_id` text NOT NULL,
	`podcast_mode_user_set` integer DEFAULT false NOT NULL,
	`podcast_mode_manual` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_watch_history_ext_watch_history_id_unique` ON `dp_watch_history_ext` (`watch_history_id`);--> statement-breakpoint
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
	`score` real,
	`rating` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dp_word_encounter_lemma_idx` ON `dp_word_encounter` (`lemma`);--> statement-breakpoint
CREATE INDEX `dp_word_encounter_created_idx` ON `dp_word_encounter` (`created_at`);--> statement-breakpoint
CREATE TABLE `dp_words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`stem` text,
	`translate` text,
	`note` text,
	`status` text DEFAULT 'learning' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`mastery` real DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`last_seen_at` text,
	`mastered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dp_words_word_unique` ON `dp_words` (`word`);--> statement-breakpoint
CREATE INDEX `dp_words_lower_word_idx` ON `dp_words` (lower("word"));--> statement-breakpoint
CREATE INDEX `dp_words_status_source_idx` ON `dp_words` (`status`,`source`);--> statement-breakpoint
CREATE TABLE `dp_word_translates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`provider` text DEFAULT 'openai' NOT NULL,
	`translate` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `word_provider_idx` ON `dp_word_translates` (`word`,`provider`);