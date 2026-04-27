import { AsyncResult, Result } from "@qlever-llc/result";
import { KVError } from "@qlever-llc/trellis";

import type { Session } from "../state/schemas.ts";
import type { StoredStateEntry } from "./model.ts";

type StoredCell = {
  value: StoredStateEntry;
  revision: number;
};

export class FakeStateKV {
  readonly #values = new Map<string, StoredCell>();
  #nextRevision = 1;

  create(key: string, value: unknown) {
    return AsyncResult.from((async () => {
      if (this.#values.has(key)) {
        return Result.err(
          new KVError({
            operation: "create",
            context: { key, reason: "exists" },
          }),
        );
      }

      this.#values.set(key, {
        value: value as StoredStateEntry,
        revision: this.#nextRevision++,
      });
      return Result.ok(undefined);
    })());
  }

  put(key: string, value: unknown) {
    return AsyncResult.from((async () => {
      this.#values.set(key, {
        value: value as StoredStateEntry,
        revision: this.#nextRevision++,
      });
      return Result.ok(undefined);
    })());
  }

  get(key: string) {
    return AsyncResult.from((async () => {
      const current = this.#values.get(key);
      if (!current) {
        return Result.err(
          new KVError({
            operation: "get",
            context: { key, reason: "not found" },
          }),
        );
      }

      const store = this;
      return Result.ok({
        key,
        value: current.value,
        revision: current.revision,
        put(value: unknown, vcc?: boolean) {
          return AsyncResult.from((async () => {
            const next = store.#values.get(key);
            if (!next) {
              return Result.err(
                new KVError({
                  operation: "put",
                  context: { key, reason: "not found" },
                }),
              );
            }
            if (vcc && next.revision !== current.revision) {
              return Result.err(
                new KVError({
                  operation: "put",
                  context: { key, reason: "revision mismatch" },
                }),
              );
            }
            store.#values.set(key, {
              value: value as StoredStateEntry,
              revision: store.#nextRevision++,
            });
            return Result.ok(undefined);
          })());
        },
        delete(vcc?: boolean) {
          return AsyncResult.from((async () => {
            const next = store.#values.get(key);
            if (!next) {
              return Result.err(
                new KVError({
                  operation: "delete",
                  context: { key, reason: "not found" },
                }),
              );
            }
            if (vcc && next.revision !== current.revision) {
              return Result.err(
                new KVError({
                  operation: "delete",
                  context: { key, reason: "revision mismatch" },
                }),
              );
            }
            store.#values.delete(key);
            return Result.ok(undefined);
          })());
        },
      });
    })());
  }

  keys(filter: string | string[] = ">") {
    const filters = Array.isArray(filter) ? filter : [filter];
    const values = [...this.#values.keys()].sort();

    async function* iter() {
      for (const key of values) {
        if (filters.some((value) => matchFilter(key, value))) {
          yield key;
        }
      }
    }

    return AsyncResult.ok(iter());
  }
}

export class FakeSessionKV {
  readonly #values = new Map<string, Session>();

  seed(key: string, value: Session): void {
    this.#values.set(key, value);
  }

  get(key: string) {
    return AsyncResult.from((async () => {
      const value = this.#values.get(key);
      if (!value) {
        return Result.err(
          new KVError({
            operation: "get",
            context: { key, reason: "not found" },
          }),
        );
      }
      return Result.ok(value);
    })());
  }

  async getOneBySessionKey(sessionKey: string): Promise<Session | undefined> {
    const matches = [...this.#values.entries()].filter(([key]) =>
      key.startsWith(`${sessionKey}.`)
    );
    return matches[0]?.[1];
  }

  keys(filter: string | string[] = ">") {
    const filters = Array.isArray(filter) ? filter : [filter];
    const values = [...this.#values.keys()].sort();

    async function* iter() {
      for (const key of values) {
        if (filters.some((value) => matchFilter(key, value))) {
          yield key;
        }
      }
    }

    return AsyncResult.ok(iter());
  }
}

function matchFilter(key: string, filter: string): boolean {
  if (filter === ">") return true;
  if (filter.endsWith(">")) {
    return key.startsWith(filter.slice(0, -1));
  }
  return key === filter;
}

export function makeUserSession(args: {
  trellisId: string;
  contractId: string;
  contractDigest?: string;
  origin?: string;
  id?: string;
}): Session {
  return {
    type: "user",
    trellisId: args.trellisId,
    origin: args.origin ?? "github",
    id: args.id ?? "123",
    email: "user@example.com",
    name: "User",
    participantKind: "app",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastAuth: new Date("2026-01-01T00:00:00.000Z"),
    contractDigest: args.contractDigest ?? `${args.contractId}-digest`,
    contractId: args.contractId,
    contractDisplayName: args.contractId,
    contractDescription: "Test app",
    delegatedCapabilities: [],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
  };
}

export function makeDeviceSession(args: {
  deviceId: string;
  contractId: string;
  contractDigest?: string;
}): Session {
  return {
    type: "device",
    instanceId: args.deviceId,
    publicIdentityKey: "pubkey",
    profileId: "reader.default",
    contractId: args.contractId,
    contractDigest: args.contractDigest ?? `${args.contractId}-digest`,
    delegatedCapabilities: [],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastAuth: new Date("2026-01-01T00:00:00.000Z"),
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    revokedAt: null,
  };
}
