CREATE TABLE `deployment_authority_capability_definitions` (
	`deployment_id` text NOT NULL,
	`capability` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`consequence` text,
	`source` text NOT NULL,
	`contract_id` text NOT NULL,
	`contract_digest` text NOT NULL,
	`contract_display_name` text,
	`direction` text NOT NULL,
	PRIMARY KEY(`deployment_id`, `capability`, `direction`, `contract_id`, `contract_digest`)
);
CREATE INDEX `deployment_authority_capability_definitions_lookup_idx` ON `deployment_authority_capability_definitions` (`capability`, `deployment_id`, `contract_id`, `contract_digest`);
--> statement-breakpoint
ALTER TABLE `deployment_authority_surfaces` ADD `source` text NOT NULL DEFAULT 'need';
