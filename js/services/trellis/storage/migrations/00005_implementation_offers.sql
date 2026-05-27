DROP TABLE IF EXISTS `deployment_contract_evidence`;
--> statement-breakpoint
DROP INDEX IF EXISTS `service_instances_current_contract_digest_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `service_instances_deployment_digest_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `service_instances_deployment_digest_disabled_idx`;
--> statement-breakpoint
ALTER TABLE `service_instances` DROP COLUMN `current_contract_id`;
--> statement-breakpoint
ALTER TABLE `service_instances` DROP COLUMN `current_contract_digest`;
--> statement-breakpoint
CREATE TABLE `implementation_offers` (
	`offer_id` text PRIMARY KEY NOT NULL,
	`deployment_kind` text NOT NULL,
	`deployment_id` text NOT NULL,
	`instance_id` text,
	`contract_id` text NOT NULL,
	`contract_digest` text NOT NULL,
	`lineage_key` text NOT NULL,
	`status` text NOT NULL,
	`liveness` text NOT NULL,
	`first_offered_at` text NOT NULL,
	`accepted_at` text,
	`last_refreshed_at` text NOT NULL,
	`stale_at` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `implementation_offers_lineage_digest_idx` ON `implementation_offers` (`lineage_key`,`contract_digest`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_contract_status_idx` ON `implementation_offers` (`contract_id`,`status`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_digest_status_idx` ON `implementation_offers` (`contract_digest`,`status`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_deployment_idx` ON `implementation_offers` (`deployment_kind`,`deployment_id`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_instance_idx` ON `implementation_offers` (`instance_id`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_lineage_accepted_idx` ON `implementation_offers` (`lineage_key`,`accepted_at`);
