CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`contract_id` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`installed_at` text NOT NULL,
	`contract` text NOT NULL,
	`resources` text,
	`analysis_summary` text,
	`analysis` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_digest_unique` ON `contracts` (`digest`);
--> statement-breakpoint
CREATE TABLE `trellis_upgrades` (
	`upgrade_id` text PRIMARY KEY NOT NULL,
	`applied_at` text NOT NULL,
	`summary` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text,
	`email` text,
	`active` integer NOT NULL,
	`capabilities` text NOT NULL,
	`capability_groups` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_user_id_unique` ON `users` (`user_id`);
--> statement-breakpoint
CREATE INDEX `users_active_idx` ON `users` (`active`);
--> statement-breakpoint
CREATE TABLE `capability_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`group_key` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`capabilities` text NOT NULL,
	`included_groups` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_groups_group_key_unique` ON `capability_groups` (`group_key`);
--> statement-breakpoint
CREATE INDEX `capability_groups_group_key_idx` ON `capability_groups` (`group_key`);
--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`display_name` text,
	`email` text,
	`email_verified` integer NOT NULL,
	`linked_at` text NOT NULL,
	`last_login_at` text,
	CONSTRAINT `user_identities_provider_subject_unique` UNIQUE(`provider`, `subject`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_identity_id_unique` ON `user_identities` (`identity_id`);
--> statement-breakpoint
CREATE INDEX `user_identities_user_id_idx` ON `user_identities` (`user_id`);
--> statement-breakpoint
CREATE TABLE `local_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_algorithm` text NOT NULL,
	`password_params` text NOT NULL,
	`password_set_at` text NOT NULL,
	`must_change_password` integer NOT NULL,
	`failed_login_count` integer NOT NULL,
	`locked_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_credentials_identity_id_unique` ON `local_credentials` (`identity_id`);
--> statement-breakpoint
CREATE TABLE `account_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id_hash` text NOT NULL,
	`kind` text NOT NULL,
	`target_user_id` text,
	`target_identity_id` text,
	`target_local_username` text,
	`created_by_user_id` text,
	`allowed_providers` text,
	`capabilities` text,
	`profile_hint` text,
	`return_to` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_flows_flow_id_hash_unique` ON `account_flows` (`flow_id_hash`);
--> statement-breakpoint
CREATE INDEX `account_flows_kind_idx` ON `account_flows` (`kind`);
--> statement-breakpoint
CREATE INDEX `account_flows_target_user_id_idx` ON `account_flows` (`target_user_id`);
--> statement-breakpoint
CREATE INDEX `account_flows_expires_at_idx` ON `account_flows` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `account_flows_consumed_expires_idx` ON `account_flows` (`consumed_at`, `expires_at`);
--> statement-breakpoint
CREATE TABLE `identity_authorities` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_authority_id` text NOT NULL,
	`user_trellis_id` text NOT NULL,
	`origin` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `identity_authorities_user_origin_external_unique` UNIQUE(`user_trellis_id`, `origin`, `external_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_authorities_identity_authority_id_unique` ON `identity_authorities` (`identity_authority_id`);
--> statement-breakpoint
CREATE TABLE `identity_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_grant_id` text NOT NULL,
	`identity_authority_id` text NOT NULL,
	`user_trellis_id` text NOT NULL,
	`origin` text NOT NULL,
	`external_id` text NOT NULL,
	`identity_anchor_kind` text NOT NULL,
	`identity_anchor` text NOT NULL,
	`evidence_contract_digest` text NOT NULL,
	`contract_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`answer` text NOT NULL,
	`answered_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`approval_evidence` text NOT NULL,
	`publish_subjects` text NOT NULL,
	`subscribe_subjects` text NOT NULL,
	CONSTRAINT `identity_grants_user_anchor_unique` UNIQUE(`user_trellis_id`, `identity_anchor_kind`, `identity_anchor`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_grants_identity_grant_id_unique` ON `identity_grants` (`identity_grant_id`);
--> statement-breakpoint
CREATE INDEX `identity_grants_answer_idx` ON `identity_grants` (`answer`);
--> statement-breakpoint
CREATE INDEX `identity_grants_answer_evidence_digest_idx` ON `identity_grants` (`answer`, `evidence_contract_digest`);
--> statement-breakpoint
CREATE TABLE `service_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`namespaces` text NOT NULL,
	`contract_compatibility_mode` text DEFAULT 'strict' NOT NULL,
	`disabled` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_deployments_deployment_id_unique` ON `service_deployments` (`deployment_id`);
--> statement-breakpoint
CREATE INDEX `service_deployments_disabled_idx` ON `service_deployments` (`disabled`);
--> statement-breakpoint
CREATE TABLE `service_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`instance_key` text NOT NULL,
	`disabled` integer NOT NULL,
	`capabilities` text NOT NULL,
	`resource_bindings` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_instances_instance_id_unique` ON `service_instances` (`instance_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_instances_instance_key_unique` ON `service_instances` (`instance_key`);
--> statement-breakpoint
CREATE INDEX `service_instances_deployment_id_idx` ON `service_instances` (`deployment_id`);
--> statement-breakpoint
CREATE INDEX `service_instances_disabled_idx` ON `service_instances` (`disabled`);
--> statement-breakpoint
CREATE INDEX `service_instances_deployment_disabled_idx` ON `service_instances` (`deployment_id`, `disabled`);
--> statement-breakpoint
CREATE TABLE `device_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`review_mode` text,
	`disabled` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_deployments_deployment_id_unique` ON `device_deployments` (`deployment_id`);
--> statement-breakpoint
CREATE INDEX `device_deployments_disabled_idx` ON `device_deployments` (`disabled`);
--> statement-breakpoint
CREATE TABLE `device_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`public_identity_key` text NOT NULL,
	`deployment_id` text NOT NULL,
	`metadata` text,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`activated_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_instances_instance_id_unique` ON `device_instances` (`instance_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_instances_public_identity_key_unique` ON `device_instances` (`public_identity_key`);
--> statement-breakpoint
CREATE INDEX `device_instances_deployment_id_idx` ON `device_instances` (`deployment_id`);
--> statement-breakpoint
CREATE INDEX `device_instances_state_idx` ON `device_instances` (`state`);
--> statement-breakpoint
CREATE INDEX `device_instances_deployment_state_idx` ON `device_instances` (`deployment_id`, `state`);
--> statement-breakpoint
CREATE TABLE `device_provisioning_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`activation_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_provisioning_secrets_instance_id_unique` ON `device_provisioning_secrets` (`instance_id`);
--> statement-breakpoint
CREATE TABLE `device_activations` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`public_identity_key` text NOT NULL,
	`deployment_id` text NOT NULL,
	`activated_by` text,
	`state` text NOT NULL,
	`activated_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_activations_instance_id_unique` ON `device_activations` (`instance_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_activations_public_identity_key_unique` ON `device_activations` (`public_identity_key`);
--> statement-breakpoint
CREATE INDEX `device_activations_deployment_state_idx` ON `device_activations` (`deployment_id`, `state`);
--> statement-breakpoint
CREATE INDEX `device_activations_state_idx` ON `device_activations` (`state`);
--> statement-breakpoint
CREATE TABLE `device_activation_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`public_identity_key` text NOT NULL,
	`deployment_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`state` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_activation_reviews_review_id_unique` ON `device_activation_reviews` (`review_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_activation_reviews_operation_id_unique` ON `device_activation_reviews` (`operation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_activation_reviews_flow_id_unique` ON `device_activation_reviews` (`flow_id`);
--> statement-breakpoint
CREATE INDEX `device_activation_reviews_instance_state_idx` ON `device_activation_reviews` (`instance_id`, `state`);
--> statement-breakpoint
CREATE INDEX `device_activation_reviews_deployment_state_idx` ON `device_activation_reviews` (`deployment_id`, `state`);
--> statement-breakpoint
CREATE TABLE `deployment_authorities` (
	`deployment_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`disabled` integer NOT NULL,
	`version` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deployment_authorities_disabled_idx` ON `deployment_authorities` (`disabled`);
--> statement-breakpoint
CREATE INDEX `deployment_authorities_kind_disabled_idx` ON `deployment_authorities` (`kind`, `disabled`);
--> statement-breakpoint
CREATE TABLE `deployment_authority_contracts` (
	`deployment_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`required` integer NOT NULL,
	PRIMARY KEY(`deployment_id`, `contract_id`)
);
--> statement-breakpoint
CREATE INDEX `deployment_authority_contracts_contract_deployment_idx` ON `deployment_authority_contracts` (`contract_id`, `deployment_id`);
--> statement-breakpoint
CREATE TABLE `deployment_authority_surfaces` (
	`deployment_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`surface_kind` text NOT NULL,
	`surface_name` text NOT NULL,
	`action` text NOT NULL,
	`required` integer NOT NULL,
	PRIMARY KEY(`deployment_id`, `contract_id`, `surface_kind`, `surface_name`, `action`)
);
--> statement-breakpoint
CREATE INDEX `deployment_authority_surfaces_lookup_idx` ON `deployment_authority_surfaces` (`contract_id`, `surface_kind`, `surface_name`, `action`, `deployment_id`);
--> statement-breakpoint
CREATE TABLE `deployment_authority_resources` (
	`deployment_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_alias` text NOT NULL,
	`required` integer NOT NULL,
	`definition_json` text,
	PRIMARY KEY(`deployment_id`, `resource_kind`, `resource_alias`)
);
--> statement-breakpoint
CREATE TABLE `deployment_authority_capabilities` (
	`deployment_id` text NOT NULL,
	`capability` text NOT NULL,
	PRIMARY KEY(`deployment_id`, `capability`)
);
--> statement-breakpoint
CREATE TABLE `deployment_authority_plans` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`classification` text NOT NULL,
	`state` text NOT NULL,
	`proposal_json` text NOT NULL,
	`desired_change_json` text NOT NULL,
	`materialization_preview_json` text NOT NULL,
	`warnings_json` text NOT NULL,
	`acknowledgement_required` integer,
	`decision_at` text,
	`decision_by_json` text,
	`decision_reason` text,
	`created_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `deployment_authority_plans_deployment_state_idx` ON `deployment_authority_plans` (`deployment_id`, `state`);
--> statement-breakpoint
CREATE INDEX `deployment_authority_plans_state_idx` ON `deployment_authority_plans` (`state`);
--> statement-breakpoint
CREATE TABLE `materialized_authority` (
	`deployment_id` text PRIMARY KEY NOT NULL,
	`desired_version` text NOT NULL,
	`status` text NOT NULL,
	`grants_json` text NOT NULL,
	`reconciled_at` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `materialized_resource_bindings` (
	`deployment_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_alias` text NOT NULL,
	`binding_json` text NOT NULL,
	`limits_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`deployment_id`, `resource_kind`, `resource_alias`)
);
--> statement-breakpoint
CREATE TABLE `authority_reconciliation_status` (
	`deployment_id` text PRIMARY KEY NOT NULL,
	`desired_version` text NOT NULL,
	`state` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`message` text
);
--> statement-breakpoint
CREATE INDEX `authority_reconciliation_status_state_idx` ON `authority_reconciliation_status` (`state`);
--> statement-breakpoint
CREATE TABLE `authority_reconciliation_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`desired_version` text NOT NULL,
	`state` text NOT NULL,
	`message` text,
	`details_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `authority_reconciliation_events_deployment_created_idx` ON `authority_reconciliation_events` (`deployment_id`, `created_at`, `event_id`);
--> statement-breakpoint
CREATE TABLE `deployment_portal_routes` (
	`deployment_id` text PRIMARY KEY NOT NULL,
	`portal_id` text,
	`entry_url` text,
	`disabled` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_portals` (
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
CREATE UNIQUE INDEX `auth_portals_portal_id_unique` ON `auth_portals` (`portal_id`);
--> statement-breakpoint
CREATE TABLE `auth_login_portal_settings` (
	`portal_id` text PRIMARY KEY NOT NULL,
	`local_registration_enabled` integer NOT NULL,
	`federated_registration_enabled` integer NOT NULL,
	`allowed_federated_providers` text,
	`self_registered_account_active` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_login_portal_default_capabilities` (
	`portal_id` text NOT NULL,
	`capability` text NOT NULL,
	PRIMARY KEY(`portal_id`, `capability`)
);
--> statement-breakpoint
CREATE TABLE `auth_login_portal_default_capability_groups` (
	`portal_id` text NOT NULL,
	`group_key` text NOT NULL,
	PRIMARY KEY(`portal_id`, `group_key`)
);
--> statement-breakpoint
CREATE TABLE `auth_login_portal_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`portal_id` text NOT NULL,
	`contract_id` text,
	`origin` text,
	`disabled` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_login_portal_routes_route_id_unique` ON `auth_login_portal_routes` (`route_id`);
--> statement-breakpoint
CREATE INDEX `auth_login_portal_routes_lookup_idx` ON `auth_login_portal_routes` (`contract_id`, `origin`, `disabled`);
--> statement-breakpoint
CREATE TABLE `deployment_authority_grant_overrides` (
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
CREATE UNIQUE INDEX `deployment_authority_grant_overrides_grant_key_unique` ON `deployment_authority_grant_overrides` (`grant_key`);
--> statement-breakpoint
CREATE INDEX `deployment_authority_grant_overrides_deployment_id_idx` ON `deployment_authority_grant_overrides` (`deployment_id`);
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
CREATE INDEX `implementation_offers_lineage_digest_idx` ON `implementation_offers` (`lineage_key`, `contract_digest`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_contract_status_idx` ON `implementation_offers` (`contract_id`, `status`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_digest_status_idx` ON `implementation_offers` (`contract_digest`, `status`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_deployment_idx` ON `implementation_offers` (`deployment_kind`, `deployment_id`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_instance_idx` ON `implementation_offers` (`instance_id`);
--> statement-breakpoint
CREATE INDEX `implementation_offers_lineage_accepted_idx` ON `implementation_offers` (`lineage_key`, `accepted_at`);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_key` text NOT NULL,
	`trellis_id` text NOT NULL,
	`type` text NOT NULL,
	`origin` text,
	`external_id` text,
	`identity_grant_id` text,
	`contract_digest` text,
	`contract_id` text,
	`participant_kind` text,
	`instance_id` text,
	`deployment_id` text,
	`instance_key` text,
	`public_identity_key` text,
	`created_at` text NOT NULL,
	`last_auth` text NOT NULL,
	`revoked_at` text,
	`session` text NOT NULL,
	CONSTRAINT `sessions_session_key_unique` UNIQUE(`session_key`)
);
--> statement-breakpoint
CREATE INDEX `sessions_trellis_id_idx` ON `sessions` (`trellis_id`);
--> statement-breakpoint
CREATE INDEX `sessions_deployment_id_idx` ON `sessions` (`deployment_id`);
--> statement-breakpoint
CREATE INDEX `sessions_type_idx` ON `sessions` (`type`);
--> statement-breakpoint
CREATE INDEX `sessions_contract_digest_idx` ON `sessions` (`contract_digest`);
