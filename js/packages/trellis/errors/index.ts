import {
  UnexpectedError,
  UnexpectedErrorDataSchema,
  type UnexpectedErrorData,
} from "@qlever-llc/result";
import { schema } from "../contract_support/mod.ts";
import { AuthError } from "./AuthError.ts";
import type { AuthErrorData } from "./AuthError.ts";
import { AuthErrorDataSchema } from "./AuthError.ts";
import { ValidationError } from "./ValidationError.ts";
import type { ValidationErrorData } from "./ValidationError.ts";
import { ValidationErrorDataSchema } from "./ValidationError.ts";
import { RemoteError } from "./RemoteError.ts";
import { KVError } from "./KVError.ts";
import type { KVErrorData } from "./KVError.ts";
import { KVErrorDataSchema } from "./KVError.ts";
import { StoreError } from "./StoreError.ts";
import type { StoreErrorData } from "./StoreError.ts";
import { StoreErrorDataSchema } from "./StoreError.ts";
import { TransportError } from "./TransportError.ts";
import type { TransportErrorData } from "./TransportError.ts";
import { TransportErrorDataSchema } from "./TransportError.ts";
import { TransferError } from "./TransferError.ts";
import type { TransferErrorData } from "./TransferError.ts";
import { TransferErrorDataSchema } from "./TransferError.ts";

type RuntimeRpcErrorDesc = {
  type: string;
  schema?: unknown;
  fromSerializable(data: unknown): Error;
};

export { UnexpectedError } from "@qlever-llc/result";
export { TrellisError } from "./TrellisError.ts";
export { AuthError } from "./AuthError.ts";
export { ValidationError } from "./ValidationError.ts";
export { RemoteError } from "./RemoteError.ts";
export { KVError } from "./KVError.ts";
export { StoreError } from "./StoreError.ts";
export { TransportError } from "./TransportError.ts";
export { TransferError } from "./TransferError.ts";

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
export { type TransportErrorData, TransportErrorDataSchema } from "./TransportError.ts";
export { type TransferErrorData, TransferErrorDataSchema } from "./TransferError.ts";

/**
 * Single source of truth for all Trellis errors.
 * This object is used for compile-time type inference.
 */
const TRANSPORTABLE_TRELLIS_ERRORS = {
  UnexpectedError,
  TransportError,
  AuthError,
  ValidationError,
  KVError,
  StoreError,
  TransferError,
} as const;

const TRELLIS_ERRORS = {
  ...TRANSPORTABLE_TRELLIS_ERRORS,
  RemoteError,
} as const;

/**
 * Compile-time mapping from error names to their instance types.
 * Derived from TRELLIS_ERRORS to ensure types stay in sync with runtime.
 */
export type TrellisErrorMap = {
  [K in keyof typeof TRELLIS_ERRORS]: InstanceType<(typeof TRELLIS_ERRORS)[K]>;
};

export type TransportableTrellisErrorMap = {
  [K in keyof typeof TRANSPORTABLE_TRELLIS_ERRORS]: InstanceType<
    (typeof TRANSPORTABLE_TRELLIS_ERRORS)[K]
  >;
};

export type TrellisErrorName = keyof TransportableTrellisErrorMap;
export type TrellisErrorInstance = TrellisErrorMap[TrellisErrorName];
export type MapErrorNamesToTypes<T extends readonly TrellisErrorName[]> = {
  [K in keyof T]: T[K] extends TrellisErrorName
    ? TransportableTrellisErrorMap[T[K]]
    : never;
}[number];

export const BUILTIN_RPC_ERRORS = {
  UnexpectedError: {
    type: "UnexpectedError",
    schema: schema<UnexpectedErrorData>(UnexpectedErrorDataSchema),
    fromSerializable(data: UnexpectedErrorData) {
      return new UnexpectedError({
        id: data.id,
        context: data.context,
        traceId: data.traceId,
      });
    },
  },
  AuthError: {
    type: "AuthError",
    schema: schema<AuthErrorData>(AuthErrorDataSchema),
    fromSerializable(data: AuthErrorData) {
      return new AuthError({
        reason: data.reason,
        id: data.id,
        context: data.context,
      });
    },
  },
  TransportError: {
    type: "TransportError",
    schema: schema<TransportErrorData>(TransportErrorDataSchema),
    fromSerializable(data: TransportErrorData) {
      return new TransportError({
        code: data.code,
        message: data.message,
        hint: data.hint,
        id: data.id,
        context: data.context,
        traceId: data.traceId,
      });
    },
  },
  ValidationError: {
    type: "ValidationError",
    schema: schema<ValidationErrorData>(ValidationErrorDataSchema),
    fromSerializable(data: ValidationErrorData) {
      return new ValidationError({
        errors: data.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
        id: data.id,
        context: data.context,
      });
    },
  },
  KVError: {
    type: "KVError",
    schema: schema<KVErrorData>(KVErrorDataSchema),
    fromSerializable(data: KVErrorData) {
      return new KVError({
        operation: data.operation,
        id: data.id,
        context: data.context,
      });
    },
  },
  StoreError: {
    type: "StoreError",
    schema: schema<StoreErrorData>(StoreErrorDataSchema),
    fromSerializable(data: StoreErrorData) {
      return new StoreError({
        operation: data.operation,
        id: data.id,
        context: data.context,
      });
    },
  },
  TransferError: {
    type: "TransferError",
    schema: schema<TransferErrorData>(TransferErrorDataSchema),
    fromSerializable(data: TransferErrorData) {
      return new TransferError({
        operation: data.operation,
        id: data.id,
        context: data.context,
      });
    },
  },
} as const satisfies Record<string, RuntimeRpcErrorDesc>;

export function getBuiltinRpcError(
  type: string,
): RuntimeRpcErrorDesc | undefined {
  return BUILTIN_RPC_ERRORS[type as keyof typeof BUILTIN_RPC_ERRORS];
}
