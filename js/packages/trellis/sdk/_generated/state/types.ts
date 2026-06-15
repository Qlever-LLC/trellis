// Generated from ./generated/contracts/manifests/trellis.state@v1.json
import type { RpcHandler } from "@qlever-llc/trellis/service";
import type { sdk } from "./contract.ts";

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

export type StateAdminDeleteHandler<TDeps = undefined> = RpcHandler<
  typeof sdk,
  "State.Admin.Delete",
  TDeps
>;
export type StateAdminGetHandler<TDeps = undefined> = RpcHandler<
  typeof sdk,
  "State.Admin.Get",
  TDeps
>;
export type StateAdminListHandler<TDeps = undefined> = RpcHandler<
  typeof sdk,
  "State.Admin.List",
  TDeps
>;
export type StateDeleteHandler<TDeps = undefined> = RpcHandler<
  typeof sdk,
  "State.Delete",
  TDeps
>;
export type StateGetHandler<TDeps = undefined> = RpcHandler<
  typeof sdk,
  "State.Get",
  TDeps
>;
export type StateListHandler<TDeps = undefined> = RpcHandler<
  typeof sdk,
  "State.List",
  TDeps
>;
export type StatePutHandler<TDeps = undefined> = RpcHandler<
  typeof sdk,
  "State.Put",
  TDeps
>;

export interface EventMap {
}

export interface FeedMap {
}

export interface SubjectMap {
}
