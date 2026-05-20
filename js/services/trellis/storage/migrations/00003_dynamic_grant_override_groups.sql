CREATE TABLE IF NOT EXISTS `__new_deployment_grant_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`grant_key` text NOT NULL,
	`identity_kind` text NOT NULL,
	`grant_kind` text NOT NULL,
	`contract_id` text,
	`origin` text,
	`session_public_key` text,
	`capability` text,
	`capability_group_key` text
);
--> statement-breakpoint
INSERT INTO `__new_deployment_grant_overrides` (`id`, `deployment_id`, `grant_key`, `identity_kind`, `grant_kind`, `contract_id`, `origin`, `session_public_key`, `capability`, `capability_group_key`)
SELECT `id`, `deployment_id`, `grant_key`, `identity_kind`, 'capability', `contract_id`, `origin`, `session_public_key`, `capability`, NULL
FROM `deployment_grant_overrides`
WHERE `identity_kind` IN ('web', 'session');
--> statement-breakpoint
DROP TABLE `deployment_grant_overrides`;
--> statement-breakpoint
ALTER TABLE `__new_deployment_grant_overrides` RENAME TO `deployment_grant_overrides`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `deployment_grant_overrides_grant_key_unique` ON `deployment_grant_overrides` (`grant_key`);
