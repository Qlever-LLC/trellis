CREATE TABLE IF NOT EXISTS `auth_portals` (
	`id` text PRIMARY KEY NOT NULL,
	`portal_id` text NOT NULL,
	`display_name` text NOT NULL,
	`entry_url` text,
	`built_in` integer NOT NULL,
	`disabled` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `auth_portals_portal_id_unique` ON `auth_portals` (`portal_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_login_portal_settings` (
	`portal_id` text PRIMARY KEY NOT NULL,
	`local_registration_enabled` integer NOT NULL,
	`federated_registration_enabled` integer NOT NULL,
	`self_registered_account_active` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_login_portal_default_capabilities` (
	`portal_id` text NOT NULL,
	`capability` text NOT NULL,
	PRIMARY KEY(`portal_id`, `capability`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_login_portal_default_capability_groups` (
	`portal_id` text NOT NULL,
	`group_key` text NOT NULL,
	PRIMARY KEY(`portal_id`, `group_key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_login_portal_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`portal_id` text NOT NULL,
	`contract_id` text,
	`origin` text,
	`disabled` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `auth_login_portal_routes_route_id_unique` ON `auth_login_portal_routes` (`route_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_login_portal_routes_lookup_idx` ON `auth_login_portal_routes` (`contract_id`,`origin`,`disabled`);
