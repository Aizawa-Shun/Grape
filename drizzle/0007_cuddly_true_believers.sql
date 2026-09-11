ALTER TABLE `products` ADD `setup_status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `setup_error` text;