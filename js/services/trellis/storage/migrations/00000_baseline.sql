CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`contract_id` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`session_key` text,
	`installed_at` text NOT NULL,
	`contract` text NOT NULL,
	`resources` text,
	`analysis_summary` text,
	`analysis` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_digest_unique` ON `contracts` (`digest`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`trellis_id` text NOT NULL,
	`origin` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text,
	`email` text,
	`active` integer NOT NULL,
	`capabilities` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_trellis_id_unique` ON `users` (`trellis_id`);--> statement-breakpoint
CREATE TABLE `contract_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_trellis_id` text NOT NULL,
	`origin` text NOT NULL,
	`external_id` text NOT NULL,
	`contract_digest` text NOT NULL,
	`contract_id` text NOT NULL,
	`participant_kind` text NOT NULL,
	`answer` text NOT NULL,
	`answered_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`approval` text NOT NULL,
	`publish_subjects` text NOT NULL,
	`subscribe_subjects` text NOT NULL,
	CONSTRAINT `contract_approvals_user_digest_unique` UNIQUE(`user_trellis_id`,`contract_digest`)
);
--> statement-breakpoint
CREATE TABLE `portals` (
	`id` text PRIMARY KEY NOT NULL,
	`portal_id` text NOT NULL,
	`entry_url` text NOT NULL,
	`disabled` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portals_portal_id_unique` ON `portals` (`portal_id`);--> statement-breakpoint
CREATE TABLE `portal_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`portal_id` text NOT NULL,
	`entry_url` text NOT NULL,
	`contract_id` text NOT NULL,
	`allowed_origins` text,
	`implied_capabilities` text NOT NULL,
	`disabled` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_profiles_portal_id_unique` ON `portal_profiles` (`portal_id`);--> statement-breakpoint
CREATE TABLE `portal_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`default_key` text NOT NULL,
	`portal_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_defaults_default_key_unique` ON `portal_defaults` (`default_key`);--> statement-breakpoint
CREATE TABLE `login_portal_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`selection_key` text NOT NULL,
	`contract_id` text NOT NULL,
	`portal_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_portal_selections_selection_key_unique` ON `login_portal_selections` (`selection_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `login_portal_selections_contract_id_unique` ON `login_portal_selections` (`contract_id`);--> statement-breakpoint
CREATE TABLE `device_portal_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`selection_key` text NOT NULL,
	`profile_id` text NOT NULL,
	`portal_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_portal_selections_selection_key_unique` ON `device_portal_selections` (`selection_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_portal_selections_profile_id_unique` ON `device_portal_selections` (`profile_id`);--> statement-breakpoint
CREATE TABLE `instance_grant_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`allowed_origins` text,
	`implied_capabilities` text NOT NULL,
	`disabled` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_grant_policies_contract_id_unique` ON `instance_grant_policies` (`contract_id`);--> statement-breakpoint
CREATE TABLE `service_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`namespaces` text NOT NULL,
	`disabled` integer NOT NULL,
	`applied_contracts` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_profiles_profile_id_unique` ON `service_profiles` (`profile_id`);--> statement-breakpoint
CREATE TABLE `service_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`instance_key` text NOT NULL,
	`disabled` integer NOT NULL,
	`current_contract_id` text,
	`current_contract_digest` text,
	`capabilities` text NOT NULL,
	`resource_bindings` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_instances_instance_id_unique` ON `service_instances` (`instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_instances_instance_key_unique` ON `service_instances` (`instance_key`);--> statement-breakpoint
CREATE TABLE `device_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`review_mode` text,
	`disabled` integer NOT NULL,
	`applied_contracts` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_profiles_profile_id_unique` ON `device_profiles` (`profile_id`);--> statement-breakpoint
CREATE TABLE `device_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`public_identity_key` text NOT NULL,
	`profile_id` text NOT NULL,
	`metadata` text,
	`state` text NOT NULL,
	`current_contract_id` text,
	`current_contract_digest` text,
	`created_at` text NOT NULL,
	`activated_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_instances_instance_id_unique` ON `device_instances` (`instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_instances_public_identity_key_unique` ON `device_instances` (`public_identity_key`);--> statement-breakpoint
CREATE TABLE `device_provisioning_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`activation_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_provisioning_secrets_instance_id_unique` ON `device_provisioning_secrets` (`instance_id`);--> statement-breakpoint
CREATE TABLE `device_activations` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`public_identity_key` text NOT NULL,
	`profile_id` text NOT NULL,
	`activated_by` text,
	`state` text NOT NULL,
	`activated_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_activations_instance_id_unique` ON `device_activations` (`instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_activations_public_identity_key_unique` ON `device_activations` (`public_identity_key`);--> statement-breakpoint
CREATE TABLE `device_activation_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`public_identity_key` text NOT NULL,
	`profile_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`state` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_activation_reviews_review_id_unique` ON `device_activation_reviews` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_activation_reviews_flow_id_unique` ON `device_activation_reviews` (`flow_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_key` text NOT NULL,
	`trellis_id` text NOT NULL,
	`type` text NOT NULL,
	`origin` text,
	`external_id` text,
	`contract_digest` text,
	`contract_id` text,
	`participant_kind` text,
	`instance_id` text,
	`profile_id` text,
	`instance_key` text,
	`public_identity_key` text,
	`created_at` text NOT NULL,
	`last_auth` text NOT NULL,
	`revoked_at` text,
	`session` text NOT NULL,
	CONSTRAINT `sessions_session_key_unique` UNIQUE(`session_key`)
);
