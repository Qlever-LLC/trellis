// Generated from rust/crates/integration-harness/fixtures/rpc/contract.ts
import type {
  BaseError,
  HandlerTrellis,
  Result,
  RpcHandlerContext,
  TrellisErrorInstance,
} from "@qlever-llc/trellis";

import type { Api } from "./api.ts";

import { type SerializableErrorData, TrellisError } from "@qlever-llc/trellis";

import { NotFoundErrorDataSchema } from "./schemas.ts";

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };
export type HandlerClient = HandlerTrellis<Api>;

export const CONTRACT_ID = "trellis.integration-harness.rpc@v1" as const;
export const CONTRACT_DIGEST =
  "Atg91ttOf4n5u8LyMJOCWgCggNMNxX6zK554Lorq12I" as const;

export type HarnessRustCallerContextInput = { message: string };
export type HarnessRustCallerContextOutput = {
  callerType: string;
  participantKind: string;
  provider: string;
  userId: string;
};

export type HarnessRustPingInput = { message: string };
export type HarnessRustPingOutput = { message: string };

export type HarnessRustTraceContextInput = { message: string };
export type HarnessRustTraceContextOutput = {
  provider: string;
  traceId: string;
  traceparent: string;
};

export type HarnessTsCallerContextInput = { message: string };
export type HarnessTsCallerContextOutput = {
  callerType: string;
  participantKind: string;
  provider: string;
  userId: string;
};

export type HarnessTsPingInput = { message: string };
export type HarnessTsPingOutput = { message: string };

export type HarnessTsTraceContextInput = { message: string };
export type HarnessTsTraceContextOutput = {
  provider: string;
  traceId: string;
  traceparent: string;
};

export type NotFoundErrorData = {
  context?: { [k: string]: unknown };
  id: string;
  message: string;
  resource: string;
  traceId?: string;
  type: "NotFoundError";
};
export class NotFoundError extends TrellisError<NotFoundErrorData> {
  static readonly schema = NotFoundErrorDataSchema;
  override readonly name = "NotFoundError" as const;
  readonly data: NotFoundErrorData;

  constructor(data: NotFoundErrorData) {
    super(data.message, {
      id: data.id,
      ...(data.context !== undefined ? { context: data.context } : {}),
    });
    this.data = data;
  }

  static fromSerializable(data: NotFoundErrorData): NotFoundError {
    return new NotFoundError(data);
  }

  override toSerializable(): NotFoundErrorData {
    return this.data;
  }
}

export interface RpcMap {
  "Harness.Rust.CallerContext": {
    input: HarnessRustCallerContextInput;
    output: HarnessRustCallerContextOutput;
  };
  "Harness.Rust.Ping": {
    input: HarnessRustPingInput;
    output: HarnessRustPingOutput;
  };
  "Harness.Rust.TraceContext": {
    input: HarnessRustTraceContextInput;
    output: HarnessRustTraceContextOutput;
  };
  "Harness.Ts.CallerContext": {
    input: HarnessTsCallerContextInput;
    output: HarnessTsCallerContextOutput;
  };
  "Harness.Ts.Ping": { input: HarnessTsPingInput; output: HarnessTsPingOutput };
  "Harness.Ts.TraceContext": {
    input: HarnessTsTraceContextInput;
    output: HarnessTsTraceContextOutput;
  };
}

export type HarnessRustCallerContextHandlerError = TrellisErrorInstance;
export type HarnessRustCallerContextHandlerResult = Result<
  HarnessRustCallerContextOutput,
  HarnessRustCallerContextHandlerError
>;
export type HarnessRustCallerContextHandler<TDeps = undefined> = (
  args: {
    input: HarnessRustCallerContextInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | HarnessRustCallerContextHandlerResult
  | Promise<HarnessRustCallerContextHandlerResult>;
export type HarnessRustPingHandlerError =
  | TrellisErrorInstance
  | BaseError<NotFoundErrorData>;
export type HarnessRustPingHandlerResult = Result<
  HarnessRustPingOutput,
  HarnessRustPingHandlerError
>;
export type HarnessRustPingHandler<TDeps = undefined> = (
  args: {
    input: HarnessRustPingInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => HarnessRustPingHandlerResult | Promise<HarnessRustPingHandlerResult>;
export type HarnessRustTraceContextHandlerError = TrellisErrorInstance;
export type HarnessRustTraceContextHandlerResult = Result<
  HarnessRustTraceContextOutput,
  HarnessRustTraceContextHandlerError
>;
export type HarnessRustTraceContextHandler<TDeps = undefined> = (
  args: {
    input: HarnessRustTraceContextInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | HarnessRustTraceContextHandlerResult
  | Promise<HarnessRustTraceContextHandlerResult>;
export type HarnessTsCallerContextHandlerError = TrellisErrorInstance;
export type HarnessTsCallerContextHandlerResult = Result<
  HarnessTsCallerContextOutput,
  HarnessTsCallerContextHandlerError
>;
export type HarnessTsCallerContextHandler<TDeps = undefined> = (
  args: {
    input: HarnessTsCallerContextInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | HarnessTsCallerContextHandlerResult
  | Promise<HarnessTsCallerContextHandlerResult>;
export type HarnessTsPingHandlerError =
  | TrellisErrorInstance
  | BaseError<NotFoundErrorData>;
export type HarnessTsPingHandlerResult = Result<
  HarnessTsPingOutput,
  HarnessTsPingHandlerError
>;
export type HarnessTsPingHandler<TDeps = undefined> = (
  args: {
    input: HarnessTsPingInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => HarnessTsPingHandlerResult | Promise<HarnessTsPingHandlerResult>;
export type HarnessTsTraceContextHandlerError = TrellisErrorInstance;
export type HarnessTsTraceContextHandlerResult = Result<
  HarnessTsTraceContextOutput,
  HarnessTsTraceContextHandlerError
>;
export type HarnessTsTraceContextHandler<TDeps = undefined> = (
  args: {
    input: HarnessTsTraceContextInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | HarnessTsTraceContextHandlerResult
  | Promise<HarnessTsTraceContextHandlerResult>;

export interface EventMap {
}

export interface FeedMap {
}

export interface SubjectMap {
}
