import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
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

/** Applies Trellis storage migrations for tests and local bootstrap. */
export async function initializeTrellisStorageSchema(
  storage: TrellisStorage,
): Promise<void> {
  await migrate(storage.db, {
    migrationsFolder: new URL("./migrations", import.meta.url).pathname,
  });
}
