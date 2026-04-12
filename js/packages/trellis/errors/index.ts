import { UnexpectedError } from "@qlever-llc/result";
import { AuthError } from "./AuthError.ts";
import { ValidationError } from "./ValidationError.ts";
import { RemoteError } from "./RemoteError.ts";
import { KVError } from "./KVError.ts";
import { StoreError } from "./StoreError.ts";

export { UnexpectedError } from "@qlever-llc/result";
export { TrellisError } from "./TrellisError.ts";
export { AuthError } from "./AuthError.ts";
export { ValidationError } from "./ValidationError.ts";
export { RemoteError } from "./RemoteError.ts";
export { KVError } from "./KVError.ts";
export { StoreError } from "./StoreError.ts";

export { type AuthErrorData, AuthErrorDataSchema } from "./AuthError.ts";
export {
  type ValidationErrorData,
  ValidationErrorDataSchema,
  type ValidationIssue,
  ValidationIssueSchema,
} from "./ValidationError.ts";
export { type RemoteErrorData, RemoteErrorDataSchema } from "./RemoteError.ts";
export { type KVErrorData, KVErrorDataSchema } from "./KVError.ts";
export { type StoreErrorData, StoreErrorDataSchema } from "./StoreError.ts";

/**
 * Single source of truth for all Trellis errors.
 * This object is used for compile-time type inference.
 */
const TRELLIS_ERRORS = {
  UnexpectedError,
  AuthError,
  ValidationError,
  RemoteError,
  KVError,
  StoreError,
} as const;

/**
 * Compile-time mapping from error names to their instance types.
 * Derived from TRELLIS_ERRORS to ensure types stay in sync with runtime.
 */
export type TrellisErrorMap = {
  [K in keyof typeof TRELLIS_ERRORS]: InstanceType<(typeof TRELLIS_ERRORS)[K]>;
};

export type TrellisErrorName = keyof TrellisErrorMap;
export type TrellisErrorInstance = TrellisErrorMap[TrellisErrorName];
export type MapErrorNamesToTypes<T extends readonly TrellisErrorName[]> = {
  [K in keyof T]: T[K] extends TrellisErrorName ? TrellisErrorMap[T[K]] : never;
}[number];
