import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { dirname } from "@std/path";

import { schema } from "./schema.ts";

export type TrellisStorageDb = LibSQLDatabase<typeof schema>;

export type TrellisStorage = {
  client: Client;
  db: TrellisStorageDb;
};

/** Opens a file-backed SQLite database for Trellis service durable storage. */
export async function openTrellisStorageDb(
  path: string,
): Promise<TrellisStorage> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const client = createClient({ url: `file:${path}` });
  const db = drizzle(client, { schema });

  return { client, db };
}

/** Creates the initial Trellis storage schema for tests and local bootstrap. */
export async function initializeTrellisStorageSchema(
  storage: TrellisStorage,
): Promise<void> {
  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      digest TEXT NOT NULL UNIQUE,
      contract_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      session_key TEXT,
      installed_at TEXT NOT NULL,
      contract TEXT NOT NULL,
      resources TEXT,
      analysis_summary TEXT,
      analysis TEXT
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      trellis_id TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      active INTEGER NOT NULL,
      capabilities TEXT NOT NULL
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS contract_approvals (
      id TEXT PRIMARY KEY,
      user_trellis_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      external_id TEXT NOT NULL,
      contract_digest TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      participant_kind TEXT NOT NULL,
      answer TEXT NOT NULL,
      answered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approval TEXT NOT NULL,
      publish_subjects TEXT NOT NULL,
      subscribe_subjects TEXT NOT NULL,
      UNIQUE (user_trellis_id, contract_digest)
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS portals (
      id TEXT PRIMARY KEY,
      portal_id TEXT NOT NULL UNIQUE,
      entry_url TEXT NOT NULL,
      disabled INTEGER NOT NULL
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS portal_profiles (
      id TEXT PRIMARY KEY,
      portal_id TEXT NOT NULL UNIQUE,
      entry_url TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      allowed_origins TEXT,
      implied_capabilities TEXT NOT NULL,
      disabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS portal_defaults (
      id TEXT PRIMARY KEY,
      default_key TEXT NOT NULL UNIQUE,
      portal_id TEXT
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS login_portal_selections (
      id TEXT PRIMARY KEY,
      selection_key TEXT NOT NULL UNIQUE,
      contract_id TEXT NOT NULL UNIQUE,
      portal_id TEXT
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS device_portal_selections (
      id TEXT PRIMARY KEY,
      selection_key TEXT NOT NULL UNIQUE,
      profile_id TEXT NOT NULL UNIQUE,
      portal_id TEXT
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS instance_grant_policies (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL UNIQUE,
      allowed_origins TEXT,
      implied_capabilities TEXT NOT NULL,
      disabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT NOT NULL
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS service_profiles (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL UNIQUE,
      namespaces TEXT NOT NULL,
      disabled INTEGER NOT NULL,
      applied_contracts TEXT NOT NULL
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS service_instances (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL UNIQUE,
      profile_id TEXT NOT NULL,
      instance_key TEXT NOT NULL UNIQUE,
      disabled INTEGER NOT NULL,
      current_contract_id TEXT,
      current_contract_digest TEXT,
      capabilities TEXT NOT NULL,
      resource_bindings TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS device_profiles (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL UNIQUE,
      review_mode TEXT,
      disabled INTEGER NOT NULL,
      applied_contracts TEXT NOT NULL
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS device_instances (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL UNIQUE,
      public_identity_key TEXT NOT NULL UNIQUE,
      profile_id TEXT NOT NULL,
      metadata TEXT,
      state TEXT NOT NULL,
      current_contract_id TEXT,
      current_contract_digest TEXT,
      created_at TEXT NOT NULL,
      activated_at TEXT,
      revoked_at TEXT
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS device_provisioning_secrets (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL UNIQUE,
      activation_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS device_activations (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL UNIQUE,
      public_identity_key TEXT NOT NULL UNIQUE,
      profile_id TEXT NOT NULL,
      activated_by TEXT,
      state TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      revoked_at TEXT
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS device_activation_reviews (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL UNIQUE,
      flow_id TEXT NOT NULL UNIQUE,
      instance_id TEXT NOT NULL,
      public_identity_key TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      reason TEXT
    )
  `);

  await storage.client.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      trellis_id TEXT NOT NULL,
      type TEXT NOT NULL,
      origin TEXT,
      external_id TEXT,
      contract_digest TEXT,
      contract_id TEXT,
      participant_kind TEXT,
      instance_id TEXT,
      profile_id TEXT,
      instance_key TEXT,
      public_identity_key TEXT,
      created_at TEXT NOT NULL,
      last_auth TEXT NOT NULL,
      revoked_at TEXT,
      session TEXT NOT NULL,
      UNIQUE (session_key)
    )
  `);
}
