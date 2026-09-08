CREATE TABLE `action_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`artifact_id` text,
	`channel` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_url` text,
	`cost_estimate_usd` real,
	`response` text,
	`approved_at` integer,
	`executed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `action_runs_task_idx` ON `action_runs` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_task_idx` ON `artifacts` (`task_id`);--> statement-breakpoint
CREATE TABLE `crawl_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`url` text NOT NULL,
	`status` integer NOT NULL,
	`title` text,
	`text` text,
	`meta` text,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_pages_product_idx` ON `crawl_pages` (`product_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`context_version` integer NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`mode` text NOT NULL,
	`bottleneck_stage` text NOT NULL,
	`summary` text NOT NULL,
	`evidence` text,
	`confidence` real,
	`model` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diagnoses_product_idx` ON `diagnoses` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`anon_id` text NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`referrer` text,
	`utm` text,
	`ts` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_product_ts_idx` ON `events` (`product_id`,`ts`);--> statement-breakpoint
CREATE INDEX `events_session_idx` ON `events` (`product_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `events_anon_idx` ON `events` (`product_id`,`anon_id`,`ts`);--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`metric` text NOT NULL,
	`before` real NOT NULL,
	`after` real NOT NULL,
	`window_days` integer NOT NULL,
	`delta` real NOT NULL,
	`evaluated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outcomes_task_idx` ON `outcomes` (`task_id`);--> statement-breakpoint
CREATE TABLE `product_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`version` integer NOT NULL,
	`what` text NOT NULL,
	`who` text NOT NULL,
	`why` text NOT NULL,
	`how` text NOT NULL,
	`source_pages` text NOT NULL,
	`confidence` real,
	`edited_by_human` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_contexts_version_idx` ON `product_contexts` (`product_id`,`version`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`key_event_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_user_url_idx` ON `products` (`user_id`,`url`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`diagnosis_id` text,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`stage` text NOT NULL,
	`channel` text DEFAULT 'manual' NOT NULL,
	`expected_metric` text NOT NULL,
	`expected_direction` text DEFAULT 'up' NOT NULL,
	`impact` integer NOT NULL,
	`effort` integer NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`due_week` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_product_week_idx` ON `tasks` (`product_id`,`due_week`);