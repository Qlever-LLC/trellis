CREATE TABLE `__new_deployment_authority_capabilities` (
	`deployment_id` text NOT NULL,
	`capability` text NOT NULL,
	`required` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`deployment_id`, `capability`, `source`)
);
--> statement-breakpoint
INSERT INTO `__new_deployment_authority_capabilities` (`deployment_id`, `capability`, `required`, `source`)
SELECT `deployment_id`, `capability`, 1, 'need' FROM `deployment_authority_capabilities`;
--> statement-breakpoint
INSERT INTO `__new_deployment_authority_capabilities` (`deployment_id`, `capability`, `required`, `source`)
SELECT `deployment_id`, `capability`, 1, 'capability' FROM `deployment_authority_capabilities`;
--> statement-breakpoint
DROP TABLE `deployment_authority_capabilities`;
--> statement-breakpoint
ALTER TABLE `__new_deployment_authority_capabilities` RENAME TO `deployment_authority_capabilities`;
