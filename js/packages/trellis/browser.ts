/**
 * Browser-safe exports for @qlever-llc/trellis-trellis
 */

// Core Trellis client class (browser-safe)
export { Trellis } from "./trellis.ts";
export type { TrellisAuth } from "./trellis.ts";

// KV utilities (browser-safe)
export { TypedKV, TypedKVEntry } from "./kv.ts";
export type { WatchEvent, WatchOptions } from "./kv.ts";

// Error types (browser-safe)
export {
  AuthError,
  KVError,
  RemoteError,
  UnexpectedError,
  ValidationError,
} from "./errors/index.ts";
export type { TrellisErrorInstance } from "./errors/index.ts";
