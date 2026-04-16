import Type, { type Static, type TObject, type TProperties } from "typebox";

import {
  defineError,
  type ContractSourceErrorDecl,
  type ErrorClass,
  type TransportErrorData,
} from "../../contracts/mod.ts";
import { TrellisError } from "./TrellisError.ts";

type ReservedGeneratedErrorFieldName =
  | "id"
  | "type"
  | "message"
  | "context"
  | "traceId"
  | "cause";

type GeneratedTrellisErrorPayload<TFields extends TProperties> =
  & Static<TObject<TFields>>
  & object;

type GeneratedTrellisErrorData<
  TType extends string,
  TFields extends TProperties,
> =
  & TransportErrorData
  & { type: TType }
  & GeneratedTrellisErrorPayload<TFields>;

type GeneratedTrellisErrorSchema = TObject<TProperties>;

type PayloadCarrier<TPayload extends object> = {
  [GENERATED_PAYLOAD]: Readonly<TPayload>;
};

type GeneratedTrellisErrorBaseClass<
  TType extends string,
  TFields extends TProperties,
> =
  & ErrorClass<
    GeneratedTrellisErrorData<TType, TFields>,
    GeneratedTrellisErrorInstance<TType, TFields>,
    GeneratedTrellisErrorSchema
  >
  & {
    new (
      options: GeneratedTrellisErrorOptions<TFields>,
    ): GeneratedTrellisErrorInstance<TType, TFields>;
    readonly type: TType;
    readonly schema: GeneratedTrellisErrorSchema;
    fromSerializable(
      data: GeneratedTrellisErrorData<TType, TFields>,
    ): GeneratedTrellisErrorInstance<TType, TFields>;
  };

export type DefineTrellisErrorClassOptions<
  TType extends string,
  TFields extends TProperties,
> = {
  type: TType;
  fields: TFields;
  message:
    | string
    | ((payload: Readonly<GeneratedTrellisErrorPayload<TFields>>) => string);
};

export type GeneratedTrellisErrorOptions<TFields extends TProperties> =
  & GeneratedTrellisErrorPayload<TFields>
  & ErrorOptions
  & {
    context?: Record<string, unknown>;
    id?: string;
    traceId?: string;
  };

export type GeneratedTrellisErrorInstance<
  TType extends string,
  TFields extends TProperties,
> =
  & TrellisError<GeneratedTrellisErrorData<TType, TFields>>
  & PayloadCarrier<GeneratedTrellisErrorPayload<TFields>>
  & Readonly<GeneratedTrellisErrorPayload<TFields>>;

export type GeneratedTrellisErrorClass<
  TType extends string,
  TFields extends TProperties,
> = GeneratedTrellisErrorBaseClass<TType, TFields> & {
  readonly decl: ContractSourceErrorDecl<string>;
};

const RESERVED_FIELD_NAMES: ReadonlySet<ReservedGeneratedErrorFieldName> = new Set([
  "id",
  "type",
  "message",
  "context",
  "traceId",
  "cause",
]);

const GENERATED_PAYLOAD = Symbol("generated-trellis-error-payload");

function assertNoReservedFieldNames(fields: TProperties): void {
  for (const fieldName of Object.keys(fields)) {
    if (RESERVED_FIELD_NAMES.has(fieldName as ReservedGeneratedErrorFieldName)) {
      throw new Error(
        `Generated Trellis error field '${fieldName}' is reserved`,
      );
    }
  }
}

function createGeneratedErrorSchema<TType extends string, TFields extends TProperties>(
  type: TType,
  fields: TFields,
): GeneratedTrellisErrorSchema {
  return Type.Object({
    id: Type.String(),
    type: Type.Literal(type),
    message: Type.String(),
    ...fields,
    context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    traceId: Type.Optional(Type.String()),
  });
}

function payloadFieldNames<TFields extends TProperties>(
  fields: TFields,
): readonly (keyof GeneratedTrellisErrorPayload<TFields> & string)[] {
  return Object.keys(fields) as Array<
    keyof GeneratedTrellisErrorPayload<TFields> & string
  >;
}

function pickPayload<TPayload extends object>(
  fieldNames: readonly (keyof TPayload & string)[],
  source: TPayload,
): Readonly<TPayload> {
  return Object.fromEntries(
    fieldNames.map((fieldName) => [fieldName, source[fieldName]]),
  ) as TPayload;
}

function baseErrorOptionsFromPayload<TPayload extends object>(
  options: TPayload & {
    context?: Record<string, unknown>;
    id?: string;
    traceId?: string;
    cause?: unknown;
  },
): ErrorOptions & {
  context?: Record<string, unknown>;
  id?: string;
  traceId?: string;
} {
  const baseOptions: ErrorOptions & {
    context?: Record<string, unknown>;
    id?: string;
    traceId?: string;
  } = {};
  if (options.cause !== undefined) {
    baseOptions.cause = options.cause;
  }
  if (options.context !== undefined) {
    baseOptions.context = options.context;
  }
  if (options.id !== undefined) {
    baseOptions.id = options.id;
  }
  if (options.traceId !== undefined) {
    baseOptions.traceId = options.traceId;
  }
  return baseOptions;
}

function attachPayload<TError extends TrellisError<TransportErrorData>, TPayload extends object>(
  error: TError & PayloadCarrier<TPayload>,
  payload: Readonly<TPayload>,
): TError & Readonly<TPayload> & PayloadCarrier<TPayload> {
  error[GENERATED_PAYLOAD] = payload;
  return Object.assign(error, payload);
}

function finalizeGeneratedErrorClass<
  TType extends string,
  TFields extends TProperties,
>(
  errorClass: GeneratedTrellisErrorBaseClass<TType, TFields>,
): GeneratedTrellisErrorClass<TType, TFields> {
  return Object.assign(errorClass, {
    decl: defineError<
      GeneratedTrellisErrorData<TType, TFields>,
      GeneratedTrellisErrorInstance<TType, TFields>,
      GeneratedTrellisErrorSchema
    >(errorClass),
  });
}

export function defineTrellisErrorClass<
  const TType extends string,
  const TFields extends TProperties,
>(
  options: DefineTrellisErrorClassOptions<TType, TFields>,
): GeneratedTrellisErrorClass<TType, TFields> {
  assertNoReservedFieldNames(options.fields);

  const schema = createGeneratedErrorSchema(options.type, options.fields);
  const fieldNames = payloadFieldNames(options.fields);

  type TPayload = GeneratedTrellisErrorPayload<TFields>;
  type TData = GeneratedTrellisErrorData<TType, TFields>;
  type TOptions = TPayload & ErrorOptions & {
    context?: Record<string, unknown>;
    id?: string;
    traceId?: string;
  };

  class GeneratedTrellisErrorImpl extends TrellisError<TData>
    implements PayloadCarrier<TPayload> {
    static readonly type = options.type;
    static readonly schema = schema;
    override readonly name = options.type;
    [GENERATED_PAYLOAD]: Readonly<TPayload>;

    constructor(payload: TOptions) {
      const customPayload = pickPayload(fieldNames, payload);
      const message = typeof options.message === "function"
        ? options.message(customPayload)
        : options.message;
      super(message, baseErrorOptionsFromPayload(payload));
      this[GENERATED_PAYLOAD] = customPayload;
      Object.assign(this, customPayload);
    }

    static fromSerializable(
      data: TData,
    ): GeneratedTrellisErrorInstance<TType, TFields> {
      const customPayload = pickPayload(fieldNames, data);
      const revivedOptions = {
        ...customPayload,
        id: data.id,
        context: data.context,
        traceId: data.traceId,
      } as TOptions;
      return attachPayload(
        new GeneratedTrellisErrorImpl(revivedOptions),
        customPayload,
      );
    }

    override toSerializable(): TData {
      return {
        ...this.baseSerializable(),
        type: this.name,
        ...this[GENERATED_PAYLOAD],
      } as TData;
    }
  }

  // @ts-expect-error TypeScript cannot model the dynamically assigned payload
  // fields on the generated class instance constructor return type.
  return finalizeGeneratedErrorClass(GeneratedTrellisErrorImpl);
}
