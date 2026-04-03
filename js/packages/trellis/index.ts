export type { TrellisAPI } from "@qlever-llc/trellis-contracts";
export { err, isErr, isOk, ok, Result } from "@qlever-llc/trellis-result";
export type { ClientOpts } from "./client.ts";
export { createClient } from "./client.ts";
export type { TrellisErrorInstance } from "./errors/index.ts";
export {
  AuthError,
  KVError,
  RemoteError,
  TrellisError,
  UnexpectedError,
  ValidationError,
} from "./errors/index.ts";
export { TypedKV } from "./kv.ts";
export type {
  OperationEvent,
  OperationRefData,
  OperationSnapshot,
  OperationState,
  OperationTransport,
  TerminalOperation,
} from "./operations.ts";
export {
  controlSubject,
  OperationInvoker,
  OperationRef,
} from "./operations.ts";
export type { TrellisAuth, TrellisSigner } from "./trellis.ts";
export { Trellis, TrellisServer } from "./trellis.ts";
