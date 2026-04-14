import type { StaticDecode, TSchema } from "typebox";

import type { BaseError } from "../result/mod.ts";
import type { SubjectParam } from "./schema_pointers.ts";

export type Schema<T> = {
  schema: unknown;
  readonly __trellisType?: T;
};

export type SchemaLike<T = unknown> = TSchema | Schema<T>;

export type TransportErrorData = {
  id: string;
  type: string;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
} & Record<string, unknown>;

export type RpcErrorClass<
  TData extends TransportErrorData = TransportErrorData,
  TError extends BaseError = BaseError,
> = {
  fromSerializable(data: TData): TError;
};

export type RuntimeRpcErrorDesc<
  TType extends string = string,
  TSchema extends SchemaLike | undefined = SchemaLike | undefined,
  TError extends BaseError = BaseError,
> = {
  type: TType;
  schema?: TSchema;
  fromSerializable(
    data: TSchema extends SchemaLike ? InferSchemaType<TSchema> : TransportErrorData,
  ): TError;
};

export type InferRuntimeRpcError<T extends RuntimeRpcErrorDesc> = T extends
  RuntimeRpcErrorDesc<string, SchemaLike | undefined, infer TError> ? TError
  : never;

export type InferSchemaType<S> = S extends Schema<infer T> ? T
  : S extends TSchema ? StaticDecode<S>
  : unknown;

export function schema<T>(raw: unknown): Schema<T> {
  return { schema: raw } as Schema<T>;
}

export function unwrapSchema(raw: SchemaLike): unknown {
  if (raw && typeof raw === "object" && "schema" in raw) {
    return (raw as Schema<unknown>).schema;
  }
  return raw;
}

export type RPCDesc<
  I extends SchemaLike = SchemaLike,
  O extends SchemaLike = SchemaLike,
  E extends readonly string[] | undefined = readonly string[] | undefined,
  TRuntimeErrors extends readonly RuntimeRpcErrorDesc[] | undefined =
    | readonly RuntimeRpcErrorDesc[]
    | undefined,
> = {
  subject: string;
  input: I;
  output: O;
  callerCapabilities: Array<string>;
  authRequired?: boolean;
  errors?: E;
  runtimeErrors?: TRuntimeErrors;
  declaredErrorTypes?: readonly string[];
};

export type EventDesc<S extends SchemaLike = SchemaLike> = {
  subject: string;
  params?: readonly SubjectParam[];
  event: S;
  publishCapabilities: Array<string>;
  subscribeCapabilities: Array<string>;
};

export type OperationDesc<
  I extends SchemaLike = SchemaLike,
  P extends SchemaLike | undefined = SchemaLike | undefined,
  O extends SchemaLike | undefined = SchemaLike | undefined,
> = {
  subject: string;
  input: I;
  progress?: P;
  output?: O;
  callerCapabilities: Array<string>;
  readCapabilities: Array<string>;
  cancelCapabilities: Array<string>;
  cancel?: boolean;
};

export type SubjectDesc<S extends SchemaLike = SchemaLike> = {
  subject: string;
  schema?: S;
  publishCapabilities: Array<string>;
  subscribeCapabilities: Array<string>;
};

export type TrellisAPI = {
  rpc: Record<string, RPCDesc>;
  operations: Record<string, OperationDesc>;
  events: Record<string, EventDesc>;
  subjects: Record<string, SubjectDesc>;
};
