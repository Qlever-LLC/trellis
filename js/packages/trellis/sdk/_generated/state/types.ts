// Generated from ./generated/contracts/manifests/trellis.state@v1.json
import type {
  HandlerTrellis,
  Result,
  RpcHandlerContext,
  TrellisErrorInstance,
} from "../../../index.ts";

import type { Api } from "./api.ts";

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };
export type HandlerClient = HandlerTrellis<Api>;

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

export type StateAdminDeleteHandlerError = TrellisErrorInstance;
export type StateAdminDeleteHandlerResult = Result<
  StateAdminDeleteOutput,
  StateAdminDeleteHandlerError
>;
export type StateAdminDeleteHandler<TDeps = undefined> = (
  args: {
    input: StateAdminDeleteInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => StateAdminDeleteHandlerResult | Promise<StateAdminDeleteHandlerResult>;
export type StateAdminGetHandlerError = TrellisErrorInstance;
export type StateAdminGetHandlerResult = Result<
  StateAdminGetOutput,
  StateAdminGetHandlerError
>;
export type StateAdminGetHandler<TDeps = undefined> = (
  args: {
    input: StateAdminGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => StateAdminGetHandlerResult | Promise<StateAdminGetHandlerResult>;
export type StateAdminListHandlerError = TrellisErrorInstance;
export type StateAdminListHandlerResult = Result<
  StateAdminListOutput,
  StateAdminListHandlerError
>;
export type StateAdminListHandler<TDeps = undefined> = (
  args: {
    input: StateAdminListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => StateAdminListHandlerResult | Promise<StateAdminListHandlerResult>;
export type StateDeleteHandlerError = TrellisErrorInstance;
export type StateDeleteHandlerResult = Result<
  StateDeleteOutput,
  StateDeleteHandlerError
>;
export type StateDeleteHandler<TDeps = undefined> = (
  args: {
    input: StateDeleteInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => StateDeleteHandlerResult | Promise<StateDeleteHandlerResult>;
export type StateGetHandlerError = TrellisErrorInstance;
export type StateGetHandlerResult = Result<
  StateGetOutput,
  StateGetHandlerError
>;
export type StateGetHandler<TDeps = undefined> = (
  args: {
    input: StateGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => StateGetHandlerResult | Promise<StateGetHandlerResult>;
export type StateListHandlerError = TrellisErrorInstance;
export type StateListHandlerResult = Result<
  StateListOutput,
  StateListHandlerError
>;
export type StateListHandler<TDeps = undefined> = (
  args: {
    input: StateListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => StateListHandlerResult | Promise<StateListHandlerResult>;
export type StatePutHandlerError = TrellisErrorInstance;
export type StatePutHandlerResult = Result<
  StatePutOutput,
  StatePutHandlerError
>;
export type StatePutHandler<TDeps = undefined> = (
  args: {
    input: StatePutInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => StatePutHandlerResult | Promise<StatePutHandlerResult>;

export interface EventMap {
}

export interface FeedMap {
}

export interface SubjectMap {
}
