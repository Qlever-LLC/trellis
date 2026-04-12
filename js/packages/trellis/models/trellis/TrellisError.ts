import Type, { type StaticDecode } from "typebox";
import { UnexpectedErrorDataSchema } from "../../../result/mod.ts";
import { ValidationErrorDataSchema } from "../../errors/ValidationError.ts";
import { AuthErrorDataSchema } from "../../errors/AuthError.ts";
import { KVErrorDataSchema } from "../../errors/KVError.ts";
import { StoreErrorDataSchema } from "../../errors/StoreError.ts";

/**
 * Discriminated union schema for all possible Trellis error types.
 * These errors can be serialized and sent over RPC.
 * Note: RemoteError is not included here as it's a local wrapper, not a serializable error type.
 */
export const TrellisErrorDataSchema = Type.Union([
  UnexpectedErrorDataSchema,
  ValidationErrorDataSchema,
  AuthErrorDataSchema,
  KVErrorDataSchema,
  StoreErrorDataSchema,
]);

/**
 * Type for validated Trellis error data.
 * This is a discriminated union that enables type narrowing based on the `type` field.
 */
export type TrellisErrorData = StaticDecode<typeof TrellisErrorDataSchema>;
