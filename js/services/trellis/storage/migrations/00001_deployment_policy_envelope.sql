ALTER TABLE `service_deployments` ADD `first_connect_policy` text DEFAULT 'reject' NOT NULL;--> statement-breakpoint
ALTER TABLE `device_deployments` ADD `first_connect_policy` text DEFAULT 'reject' NOT NULL;
