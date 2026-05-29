// Generated from ./generated/contracts/manifests/trellis.state@v1.json
import type { RpcHandlerFn } from "@qlever-llc/trellis";
import type { API } from "./api.ts";

export const CONTRACT_ID = "trellis.state@v1" as const;
export const CONTRACT_DIGEST =
  "XfWDYLTBlYFjDqMPBEXrTBccZbFvHp0MnqscehdRKT4" as const;

export type StateAdminDeleteInput = {
  contractDigest: string;
  contractId: string;
  expectedRevision?: string;
  key?: string;
  scope: "userApp";
  store: string;
  user: { id: string; origin: string; userId?: string };
} | {
  contractDigest: string;
  contractId: string;
  deviceId: string;
  expectedRevision?: string;
  key?: string;
  scope: "deviceApp";
  store: string;
};
export type StateAdminDeleteOutput = { deleted: boolean };

export type StateAdminGetInput = {
  contractDigest: string;
  contractId: string;
  key?: string;
  scope: "userApp";
  store: string;
  user: { id: string; origin: string; userId?: string };
} | {
  contractDigest: string;
  contractId: string;
  deviceId: string;
  key?: string;
  scope: "deviceApp";
  store: string;
};
export type StateAdminGetOutput = { found: false } | {
  entry: {
    expiresAt?: string;
    key?: string;
    revision: string;
    updatedAt: string;
    value: unknown;
  };
  found: true;
} | {
  currentStateVersion: string;
  entry: {
    expiresAt?: string;
    key?: string;
    revision: string;
    updatedAt: string;
    value: unknown;
  };
  migrationRequired: true;
  stateVersion: string;
  writerContractDigest: string;
};

export type StateAdminListInput = {
  contractDigest: string;
  contractId: string;
  limit: number;
  offset?: number;
  prefix?: string;
  scope: "userApp";
  store: string;
  user: { id: string; origin: string; userId?: string };
} | {
  contractDigest: string;
  contractId: string;
  deviceId: string;
  limit: number;
  offset?: number;
  prefix?: string;
  scope: "deviceApp";
  store: string;
};
export type StateAdminListOutput = {
  count: number;
  entries: Array<
    ({
      expiresAt?: string;
      key?: string;
      revision: string;
      updatedAt: string;
      value: unknown;
    } | {
      currentStateVersion: string;
      entry: {
        expiresAt?: string;
        key?: string;
        revision: string;
        updatedAt: string;
        value: unknown;
      };
      migrationRequired: true;
      stateVersion: string;
      writerContractDigest: string;
    })
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type StateDeleteInput = {
  expectedRevision?: string;
  key?: string;
  store: string;
};
export type StateDeleteOutput = { deleted: boolean };

export type StateGetInput = { key?: string; store: string };
export type StateGetOutput = { found: false } | {
  entry: {
    expiresAt?: string;
    key?: string;
    revision: string;
    updatedAt: string;
    value: unknown;
  };
  found: true;
} | {
  currentStateVersion: string;
  entry: {
    expiresAt?: string;
    key?: string;
    revision: string;
    updatedAt: string;
    value: unknown;
  };
  migrationRequired: true;
  stateVersion: string;
  writerContractDigest: string;
};

export type StateListInput = {
  limit: number;
  offset?: number;
  prefix?: string;
  store: string;
};
export type StateListOutput = {
  count: number;
  entries: Array<
    ({
      expiresAt?: string;
      key?: string;
      revision: string;
      updatedAt: string;
      value: unknown;
    } | {
      currentStateVersion: string;
      entry: {
        expiresAt?: string;
        key?: string;
        revision: string;
        updatedAt: string;
        value: unknown;
      };
      migrationRequired: true;
      stateVersion: string;
      writerContractDigest: string;
    })
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type StatePutInput = {
  expectedRevision?: string | null;
  key?: string;
  store: string;
  ttlMs?: number;
  value: unknown;
};
export type StatePutOutput = {
  applied: true;
  entry: {
    expiresAt?: string;
    key?: string;
    revision: string;
    updatedAt: string;
    value: unknown;
  };
} | {
  applied: false;
  entry?: {
    expiresAt?: string;
    key?: string;
    revision: string;
    updatedAt: string;
    value: unknown;
  } | {
    currentStateVersion: string;
    entry: {
      expiresAt?: string;
      key?: string;
      revision: string;
      updatedAt: string;
      value: unknown;
    };
    migrationRequired: true;
    stateVersion: string;
    writerContractDigest: string;
  };
  found: boolean;
};

export interface RpcMap {
  "State.Admin.Delete": {
    input: StateAdminDeleteInput;
    output: StateAdminDeleteOutput;
  };
  "State.Admin.Get": { input: StateAdminGetInput; output: StateAdminGetOutput };
  "State.Admin.List": {
    input: StateAdminListInput;
    output: StateAdminListOutput;
  };
  "State.Delete": { input: StateDeleteInput; output: StateDeleteOutput };
  "State.Get": { input: StateGetInput; output: StateGetOutput };
  "State.List": { input: StateListInput; output: StateListOutput };
  "State.Put": { input: StatePutInput; output: StatePutOutput };
}

export type StateAdminDeleteHandler = RpcHandlerFn<
  typeof API.owned,
  "State.Admin.Delete"
>;
export type StateAdminGetHandler = RpcHandlerFn<
  typeof API.owned,
  "State.Admin.Get"
>;
export type StateAdminListHandler = RpcHandlerFn<
  typeof API.owned,
  "State.Admin.List"
>;
export type StateDeleteHandler = RpcHandlerFn<typeof API.owned, "State.Delete">;
export type StateGetHandler = RpcHandlerFn<typeof API.owned, "State.Get">;
export type StateListHandler = RpcHandlerFn<typeof API.owned, "State.List">;
export type StatePutHandler = RpcHandlerFn<typeof API.owned, "State.Put">;

export interface EventMap {
}

export interface FeedMap {
}

export interface SubjectMap {
}
