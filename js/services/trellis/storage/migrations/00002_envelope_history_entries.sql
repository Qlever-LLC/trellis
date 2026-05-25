CREATE TABLE `envelope_history_entries` (
  `entry_id` text PRIMARY KEY NOT NULL,
  `scope_kind` text NOT NULL,
  `scope_id` text NOT NULL,
  `action` text NOT NULL,
  `delta_json` text NOT NULL,
  `resulting_updated_at` text NOT NULL,
  `actor_json` text,
  `reason` text,
  `source_contract_id` text,
  `source_contract_digest` text,
  `source_request_id` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `envelope_history_entries_scope_created_idx`
ON `envelope_history_entries` (
  `scope_kind`,
  `scope_id`,
  `created_at`,
  `entry_id`
);
