import Type, {
  type Static,
  type TObject,
  type TProperties,
  type TSchema,
} from "typebox";
import { Value } from "typebox/value";
import type { BaseError } from "@qlever-llc/result";
import type { AuthSessionsMeResponse } from "../auth/protocol.ts";
import { TrellisError } from "../errors/TrellisError.ts";
import type {
  AuthSessionsLogoutInput,
  AuthSessionsLogoutResponse,
} from "../models/auth/rpc/Logout.ts";
import type {
  StateDeleteInput,
  StateDeleteResponse,
} from "../models/trellis/rpc/StateDelete.ts";
import type {
  StateGetInput,
  StateGetResponse,
} from "../models/trellis/rpc/StateGet.ts";
import type {
  StateListInput,
  StateListResponse,
} from "../models/trellis/rpc/StateList.ts";
import type {
  StatePutInput,
  StatePutResponse,
} from "../models/trellis/rpc/StatePut.ts";
import {
  canonicalizeJson,
  digestJson,
  isJsonValue,
  type JsonValue,
  sha256Base64urlSync,
} from "./canonical.ts";
import {
  type EventDesc,
  type FeedDesc,
  type InferRuntimeRpcError,
  type InferSchemaType,
  type OperationDesc,
  type RPCDesc,
  type RpcErrorClass,
  type RuntimeRpcErrorDesc,
  type Schema,
  schema,
  type SchemaLike,
  type SerializableErrorData,
  type TrellisAPI,
  unwrapSchema,
} from "./runtime.ts";
import {
  assertDataPointersExistAndAreTokenable,
  getSubschemaAtDataPointer,
  type SubjectParam,
} from "./schema_pointers.ts";
import {
  ContractJobQueueSchema,
  ContractResourcesSchema,
  ContractSchemaRefSchema,
  ContractStateSchema,
} from "./protocol.ts";

export {
  ContractJobQueueSchema,
  ContractJobsSchema,
  ContractKvResourceSchema,
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
  ContractSchemaRefSchema,
  ContractStateSchema,
  ContractStateStoreSchema,
  ContractStoreResourceSchema,
  type EventHeader,
  EventHeaderSchema,
  type InstalledServiceContract,
  InstalledServiceContractSchema,
  IsoDateSchema,
  type JobsQueueBinding,
  JobsQueueBindingSchema,
  type JobsResourceBinding,
  JobsResourceBindingSchema,
  type KvResourceBinding,
  KvResourceBindingSchema,
  type PageRequest,
  PageRequestSchema,
  type PageResponse,
  PageResponseSchema,
  type StoreResourceBinding,
  StoreResourceBindingSchema,
} from "./protocol.ts";

export const CONTRACT_FORMAT_V1 = "trellis.contract.v1" as const;
export const CATALOG_FORMAT_V1 = "trellis.catalog.v1" as const;

const NonEmptyStringSchema = Type.String({ minLength: 1 });
const VersionSchema = Type.String({ pattern: "^v[0-9]+$" });
const PointerStringSchema = Type.String({ pattern: "^/.*" });
const CapabilityListSchema = Type.Array(NonEmptyStringSchema);
const JsonSchemaValueSchema = Type.Union([
  Type.Object({}, { additionalProperties: true }),
  Type.Boolean(),
]);

export const ContractCapabilityMetadataSchema = Type.Object({
  displayName: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  consequence: Type.Optional(NonEmptyStringSchema),
});

export const ContractCapabilitiesSchema = Type.Record(
  NonEmptyStringSchema,
  ContractCapabilityMetadataSchema,
);

export const ContractExportsSchema = Type.Object({
  schemas: Type.Optional(
    Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
  ),
});

const ContractUseRpcSchema = Type.Object({
  call: Type.Optional(CapabilityListSchema),
});

const ContractUsePubSubSchema = Type.Object({
  publish: Type.Optional(CapabilityListSchema),
  subscribe: Type.Optional(CapabilityListSchema),
});

const ContractUseFeedSchema = Type.Object({
  subscribe: Type.Optional(CapabilityListSchema),
});

const ContractUseSchema = Type.Object({
  contract: NonEmptyStringSchema,
  rpc: Type.Optional(ContractUseRpcSchema),
  operations: Type.Optional(ContractUseRpcSchema),
  events: Type.Optional(ContractUsePubSubSchema),
  feeds: Type.Optional(ContractUseFeedSchema),
});

const ContractUsesFlatSchema = Type.Record(
  NonEmptyStringSchema,
  ContractUseSchema,
);

export const ContractUsesSchema = Type.Object({
  required: Type.Optional(ContractUsesFlatSchema),
  optional: Type.Optional(ContractUsesFlatSchema),
});

const ContractErrorDeclSchema = Type.Object({
  type: NonEmptyStringSchema,
  schema: Type.Optional(ContractSchemaRefSchema),
});

const ContractErrorRefSchema = Type.Object({
  type: NonEmptyStringSchema,
});

const RpcCapabilitiesSchema = Type.Object({
  call: Type.Optional(CapabilityListSchema),
});

const OperationCapabilitiesSchema = Type.Object({
  call: Type.Optional(CapabilityListSchema),
  read: Type.Optional(CapabilityListSchema),
  cancel: Type.Optional(CapabilityListSchema),
  control: Type.Optional(CapabilityListSchema),
});

const PubSubCapabilitiesSchema = Type.Object({
  publish: Type.Optional(CapabilityListSchema),
  subscribe: Type.Optional(CapabilityListSchema),
});

const FeedCapabilitiesSchema = Type.Object({
  subscribe: Type.Optional(CapabilityListSchema),
});

const RpcTransferSchema = Type.Object({
  direction: Type.Literal("receive"),
});

const OperationTransferSchema = Type.Object({
  direction: Type.Literal("send"),
  store: NonEmptyStringSchema,
  key: PointerStringSchema,
  contentType: Type.Optional(PointerStringSchema),
  metadata: Type.Optional(PointerStringSchema),
  expiresInMs: Type.Optional(Type.Integer({ minimum: 1 })),
  maxBytes: Type.Optional(Type.Integer({ minimum: 1 })),
});

const ContractRpcMethodSchema = Type.Object({
  version: VersionSchema,
  subject: NonEmptyStringSchema,
  input: ContractSchemaRefSchema,
  output: ContractSchemaRefSchema,
  capabilities: Type.Optional(RpcCapabilitiesSchema),
  errors: Type.Optional(Type.Array(ContractErrorRefSchema)),
  transfer: Type.Optional(RpcTransferSchema),
});

const ContractOperationSignalSchema = Type.Object({
  input: ContractSchemaRefSchema,
});

const ContractOperationSchema = Type.Object({
  version: VersionSchema,
  subject: NonEmptyStringSchema,
  input: ContractSchemaRefSchema,
  progress: Type.Optional(ContractSchemaRefSchema),
  output: ContractSchemaRefSchema,
  transfer: Type.Optional(OperationTransferSchema),
  capabilities: Type.Optional(OperationCapabilitiesSchema),
  signals: Type.Optional(
    Type.Record(NonEmptyStringSchema, ContractOperationSignalSchema),
  ),
  cancel: Type.Optional(Type.Boolean()),
});

const ContractEventSchema = Type.Object({
  version: VersionSchema,
  subject: NonEmptyStringSchema,
  params: Type.Optional(Type.Array(PointerStringSchema)),
  event: ContractSchemaRefSchema,
  capabilities: Type.Optional(PubSubCapabilitiesSchema),
});

const ContractFeedSchema = Type.Object({
  version: VersionSchema,
  subject: NonEmptyStringSchema,
  input: ContractSchemaRefSchema,
  event: ContractSchemaRefSchema,
  capabilities: Type.Optional(FeedCapabilitiesSchema),
});

export const TrellisContractV1Schema = Type.Object({
  format: Type.Literal(CONTRACT_FORMAT_V1),
  id: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  kind: Type.Union([
    Type.Literal("service"),
    Type.Literal("app"),
    Type.Literal("device"),
    Type.Literal("agent"),
  ]),
  capabilities: Type.Optional(ContractCapabilitiesSchema),
  schemas: Type.Optional(
    Type.Record(NonEmptyStringSchema, JsonSchemaValueSchema),
  ),
  exports: Type.Optional(ContractExportsSchema),
  uses: Type.Optional(ContractUsesSchema),
  state: Type.Optional(ContractStateSchema),
  rpc: Type.Optional(
    Type.Record(NonEmptyStringSchema, ContractRpcMethodSchema),
  ),
  operations: Type.Optional(
    Type.Record(NonEmptyStringSchema, ContractOperationSchema),
  ),
  events: Type.Optional(Type.Record(NonEmptyStringSchema, ContractEventSchema)),
  feeds: Type.Optional(Type.Record(NonEmptyStringSchema, ContractFeedSchema)),
  errors: Type.Optional(
    Type.Record(NonEmptyStringSchema, ContractErrorDeclSchema),
  ),
  jobs: Type.Optional(
    Type.Record(NonEmptyStringSchema, ContractJobQueueSchema),
  ),
  resources: Type.Optional(ContractResourcesSchema),
});

export const TrellisCatalogV1Schema = Type.Object({
  format: Type.Literal(CATALOG_FORMAT_V1),
  contracts: Type.Array(Type.Object({
    id: NonEmptyStringSchema,
    digest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
    displayName: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
  })),
});

const CONTRACT_MODULE_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/contract-module",
);
export const CONTRACT_JOBS_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/jobs",
);
export const CONTRACT_KV_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/kv",
);
export const CONTRACT_STATE_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/state",
);
const CONTRACT_ERROR_RUNTIME_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/error-runtime",
);

type UnionToIntersection<U> =
  (U extends unknown ? (value: U) => void : never) extends
    (value: infer I) => void ? I
    : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type StringKeyOf<T> = Extract<keyof T, string>;
type KeysFromList<T> = T extends readonly (infer K)[] ? Extract<K, string>
  : never;

type ReservedDefinedErrorFieldName =
  | "id"
  | "type"
  | "message"
  | "context"
  | "traceId"
  | "cause";

const RESERVED_DEFINED_ERROR_FIELD_NAMES: ReadonlySet<
  ReservedDefinedErrorFieldName
> = new Set([
  "id",
  "type",
  "message",
  "context",
  "traceId",
  "cause",
]);

const DEFINED_ERROR_PAYLOAD = Symbol.for(
  "@qlever-llc/trellis/contracts/defined-error-payload",
);

export type ContractManifestMetadata = {
  displayName: string;
  description: string;
};

export type ContractKind = "service" | "app" | "device" | "agent";

export type Capability = string;
export type PlatformCapability = "admin" | "service";
export type GlobalCapability = `${string}::${string}`;
export type ContractCapabilityMetadata = {
  displayName: string;
  description: string;
  consequence?: string;
};
export type ContractCapabilities = Record<string, ContractCapabilityMetadata>;
type DeclaredCapabilityName<TCapabilities> = [TCapabilities] extends [undefined]
  ? never
  : Extract<keyof NonNullable<TCapabilities>, string>;
type CapabilityRef<TCapabilities> =
  | DeclaredCapabilityName<TCapabilities>
  | GlobalCapability
  | PlatformCapability;
export type JsonSchema = JsonValue | boolean;

export type ContractSchemaRef<TSchemaName extends string = string> = {
  schema: TSchemaName;
};

function createSchemaRef<
  const TSchemas extends Readonly<Record<string, TSchema>>,
>(_schemas: TSchemas) {
  void _schemas;
  return <const TName extends keyof TSchemas & string>(
    schemaName: TName,
  ): ContractSchemaRef<TName> => ({ schema: schemaName });
}

export type BuiltinContractErrorName =
  | "UnexpectedError"
  | "TransportError"
  | "AuthError"
  | "ValidationError"
  | "KVError"
  | "StoreError"
  | "TransferError";

type ErrorNameOf<TErrors> =
  | Extract<keyof NonNullable<TErrors>, string>
  | BuiltinContractErrorName;

export type ContractRefBuilder<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, ErrorClass>>
    | undefined = undefined,
> = {
  schema<const TName extends SchemaNameOf<TSchemas>>(
    schemaName: TName,
  ): ContractSchemaRef<TName>;
  error<const TName extends ErrorNameOf<TErrors>>(
    errorName: TName,
  ): TName;
  capability<const TName extends GlobalCapability | PlatformCapability>(
    capabilityName: TName,
  ): TName;
};

export type ContractSchemas = Record<string, JsonSchema>;

export type ContractExports<TSchemaName extends string = string> = {
  schemas?: TSchemaName[];
};

export type ContractStateKind = "value" | "map";

export type ContractStateStore = {
  kind: ContractStateKind;
  schema: ContractSchemaRef;
  stateVersion?: string;
  acceptedVersions?: Record<string, ContractSchemaRef>;
};

export type ContractState = Record<string, ContractStateStore>;

type ContractIdentityFields = {
  id: string;
  displayName: string;
  description: string;
};

export type ContractErrorDecl = {
  type: string;
  schema?: ContractSchemaRef;
};

export type ContractErrorRef = {
  type: string;
};

export type ContractRpcMethod = {
  version: `v${number}`;
  subject: string;
  input: ContractSchemaRef;
  output: ContractSchemaRef;
  transfer?: { direction: "receive" };
  capabilities?: { call?: Capability[] };
  errors?: ContractErrorRef[];
};

export type ContractOperation = {
  version: `v${number}`;
  subject: string;
  input: ContractSchemaRef;
  progress?: ContractSchemaRef;
  output: ContractSchemaRef;
  transfer?: {
    direction: "send";
    store: string;
    key: `/${string}`;
    contentType?: `/${string}`;
    metadata?: `/${string}`;
    expiresInMs?: number;
    maxBytes?: number;
  };
  capabilities?: {
    call?: Capability[];
    read?: Capability[];
    cancel?: Capability[];
    control?: Capability[];
  };
  signals?: Record<string, { input: ContractSchemaRef }>;
  cancel?: boolean;
};

export type ContractEvent = {
  version: `v${number}`;
  subject: string;
  params?: string[];
  event: ContractSchemaRef;
  capabilities?: { publish?: Capability[]; subscribe?: Capability[] };
};

export type ContractFeed = {
  version: `v${number}`;
  subject: string;
  input: ContractSchemaRef;
  event: ContractSchemaRef;
  capabilities?: { subscribe?: Capability[] };
};

export type ContractJobQueueResource = {
  payload: ContractSchemaRef;
  result?: ContractSchemaRef;
  maxDeliver?: number;
  backoffMs?: number[];
  ackWaitMs?: number;
  defaultDeadlineMs?: number;
  progress?: boolean;
  logs?: boolean;
  dlq?: boolean;
  concurrency?: number;
};

export type ContractJobQueue = ContractJobQueueResource;

export type ContractJobs = Record<string, ContractJobQueue>;

export type ContractKvResource = {
  purpose: string;
  schema: ContractSchemaRef;
  required?: boolean;
  history?: number;
  ttlMs?: number;
  maxValueBytes?: number;
};

export type ContractStoreResource = {
  purpose: string;
  required?: boolean;
  ttlMs?: number;
  maxObjectBytes?: number;
  maxTotalBytes?: number;
};

export type ContractResources = {
  kv?: Record<string, ContractKvResource>;
  store?: Record<string, ContractStoreResource>;
};

export type ContractUsesRpc = {
  call?: string[];
};

export type ContractUsesPubSub = {
  publish?: string[];
  subscribe?: string[];
};

export type ContractUse = {
  contract: string;
  rpc?: ContractUsesRpc;
  operations?: ContractUsesRpc;
  events?: ContractUsesPubSub;
  feeds?: { subscribe?: string[] };
};

type ContractUsesFlat = Record<string, ContractUse>;

export type ContractUsesGrouped = {
  required?: Record<string, ContractUse>;
  optional?: Record<string, ContractUse>;
};

export type ContractUses = ContractUsesGrouped;

export type TrellisContractV1 = {
  format: typeof CONTRACT_FORMAT_V1;
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  capabilities?: ContractCapabilities;
  schemas?: ContractSchemas;
  exports?: ContractExports;
  state?: ContractState;
  uses?: ContractUses;
  rpc?: Record<string, ContractRpcMethod>;
  operations?: Record<string, ContractOperation>;
  events?: Record<string, ContractEvent>;
  feeds?: Record<string, ContractFeed>;
  errors?: Record<string, ContractErrorDecl>;
  jobs?: ContractJobs;
  resources?: ContractResources;
};

export type TrellisCatalogEntry = {
  id: string;
  digest: string;
  displayName: string;
  description: string;
};

export type TrellisCatalogV1 = {
  format: typeof CATALOG_FORMAT_V1;
  contracts: TrellisCatalogEntry[];
};

export type ContractSourceErrorDecl<TSchemaName extends string = string> = {
  type: string;
  schema?: ContractSchemaRef<TSchemaName>;
};

type ExtractErrorClasses<TErrors> = TErrors extends
  Readonly<Record<string, unknown>> ? {
    [
      K in keyof TErrors as TErrors[K] extends ErrorClass ? K
        : never
    ]: Extract<TErrors[K], ErrorClass>;
  }
  : undefined;

type ContractErrorRuntimeMarker<
  TClass extends RpcErrorClass = RpcErrorClass,
> = {
  readonly [CONTRACT_ERROR_RUNTIME_METADATA]: TClass;
};

export type ErrorClass<
  TData extends SerializableErrorData = SerializableErrorData,
  TError extends BaseError = BaseError,
  TRuntimeSchema extends TSchema = TSchema,
> = RpcErrorClass<TData, TError> & {
  readonly name: string;
  readonly schema: TRuntimeSchema;
  readonly type?: string;
};

type DefinedErrorPayload<TFields extends TProperties> =
  & Static<TObject<TFields>>
  & object;

type DefinedErrorData<TType extends string, TFields extends TProperties> =
  & SerializableErrorData
  & { type: TType }
  & DefinedErrorPayload<TFields>;

type DefinedErrorSchema = TObject<TProperties>;

type DefinedErrorPayloadCarrier<TPayload extends object> = {
  [DEFINED_ERROR_PAYLOAD]: Readonly<TPayload>;
};

export type DefineErrorOptions<
  TType extends string,
  TFields extends TProperties,
> = {
  type: TType;
  fields: TFields;
  message:
    | string
    | ((payload: Readonly<DefinedErrorPayload<TFields>>) => string);
};

export type DefinedErrorInit<TFields extends TProperties> =
  & DefinedErrorPayload<TFields>
  & ErrorOptions
  & {
    context?: Record<string, unknown>;
    id?: string;
    traceId?: string;
  };

export type DefinedErrorInstance<
  TType extends string,
  TFields extends TProperties,
> =
  & TrellisError<DefinedErrorData<TType, TFields>>
  & DefinedErrorPayloadCarrier<DefinedErrorPayload<TFields>>
  & Readonly<DefinedErrorPayload<TFields>>;

export type DefinedErrorClass<
  TType extends string,
  TFields extends TProperties,
> =
  & ErrorClass<
    DefinedErrorData<TType, TFields>,
    DefinedErrorInstance<TType, TFields>,
    DefinedErrorSchema
  >
  & {
    new (
      options: DefinedErrorInit<TFields>,
    ): DefinedErrorInstance<TType, TFields>;
    readonly type: TType;
    readonly schema: DefinedErrorSchema;
    fromSerializable(
      data: DefinedErrorData<TType, TFields>,
    ): DefinedErrorInstance<TType, TFields>;
  };

function getContractErrorType(errorClass: ErrorClass): string {
  const explicitType = Reflect.get(errorClass, "type");
  return typeof explicitType === "string" ? explicitType : errorClass.name;
}

function isSerializableErrorData(
  value: unknown,
): value is SerializableErrorData {
  return !!value && typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { message?: unknown }).message === "string";
}

function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === "function" &&
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "fromSerializable") === "function" &&
    typeof Reflect.get(value, "schema") === "object";
}

function assertNoReservedDefinedErrorFieldNames(fields: TProperties): void {
  for (const fieldName of Object.keys(fields)) {
    if (
      RESERVED_DEFINED_ERROR_FIELD_NAMES.has(
        fieldName as ReservedDefinedErrorFieldName,
      )
    ) {
      throw new Error(`Defined error field '${fieldName}' is reserved`);
    }
  }
}

function createDefinedErrorSchema<
  TType extends string,
  TFields extends TProperties,
>(
  type: TType,
  fields: TFields,
): DefinedErrorSchema {
  return Type.Object({
    id: Type.String(),
    type: Type.Literal(type),
    message: Type.String(),
    ...fields,
    context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    traceId: Type.Optional(Type.String()),
  });
}

function definedErrorPayloadFieldNames<TFields extends TProperties>(
  fields: TFields,
): readonly (keyof DefinedErrorPayload<TFields> & string)[] {
  return Object.keys(fields) as Array<
    keyof DefinedErrorPayload<TFields> & string
  >;
}

function pickDefinedErrorPayload<TPayload extends object>(
  fieldNames: readonly (keyof TPayload & string)[],
  source: TPayload,
): Readonly<TPayload> {
  return Object.fromEntries(
    fieldNames.map((fieldName) => [fieldName, source[fieldName]]),
  ) as TPayload;
}

function definedErrorBaseOptions<TPayload extends object>(
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

function attachDefinedErrorPayload<
  TError extends TrellisError<SerializableErrorData>,
  TPayload extends object,
>(
  error: TError & DefinedErrorPayloadCarrier<TPayload>,
  payload: Readonly<TPayload>,
): TError & Readonly<TPayload> & DefinedErrorPayloadCarrier<TPayload> {
  error[DEFINED_ERROR_PAYLOAD] = payload;
  return Object.assign(error, payload);
}

export type ContractSourceSchemas = Record<string, TSchema>;

export type ContractSourceExports<TSchemaName extends string = string> = {
  schemas?: readonly TSchemaName[];
};

export type ContractSourceStateStore<TSchemaName extends string = string> = {
  kind: ContractStateKind;
  schema: ContractSchemaRef<TSchemaName>;
  stateVersion?: string;
  acceptedVersions?: Record<string, ContractSchemaRef<TSchemaName>>;
};

export type ContractSourceState<TSchemaName extends string = string> = Record<
  string,
  ContractSourceStateStore<TSchemaName>
>;

export type ContractSourceRpcMethod<
  TSchemaName extends string = string,
  TErrorName extends string = string,
  TCapability extends string = Capability,
> = {
  version: `v${number}`;
  input: ContractSchemaRef<TSchemaName>;
  output: ContractSchemaRef<TSchemaName>;
  capabilities?: { call?: readonly TCapability[] };
  transfer?: { direction: "receive" };
  errors?: readonly TErrorName[];
  authRequired?: boolean;
  subject?: string;
};

export type ContractSourceOperation<
  TSchemaName extends string = string,
  TCapability extends string = Capability,
> = {
  version: `v${number}`;
  input: ContractSchemaRef<TSchemaName>;
  progress?: ContractSchemaRef<TSchemaName>;
  output: ContractSchemaRef<TSchemaName>;
  transfer?: {
    direction: "send";
    store: string;
    key: `/${string}`;
    contentType?: `/${string}`;
    metadata?: `/${string}`;
    expiresInMs?: number;
    maxBytes?: number;
  };
  capabilities?: {
    call?: readonly TCapability[];
    read?: readonly TCapability[];
    cancel?: readonly TCapability[];
    control?: readonly TCapability[];
  };
  signals?: Record<string, { input: ContractSchemaRef<TSchemaName> }>;
  cancel?: boolean;
  subject?: string;
};

export type ContractSourceEvent<
  TSchemaName extends string = string,
  TCapability extends string = Capability,
> = {
  version: `v${number}`;
  event: ContractSchemaRef<TSchemaName>;
  params?: readonly SubjectParam[];
  capabilities?: {
    publish?: readonly TCapability[];
    subscribe?: readonly TCapability[];
  };
  subject?: string;
};

export type ContractSourceFeed<
  TSchemaName extends string = string,
  TCapability extends string = Capability,
> = {
  version: `v${number}`;
  input: ContractSchemaRef<TSchemaName>;
  event: ContractSchemaRef<TSchemaName>;
  capabilities?: { subscribe?: readonly TCapability[] };
  subject?: string;
};

export type ContractSourceJobQueue<
  TSchemaName extends string = string,
> = {
  payload: ContractSchemaRef<TSchemaName>;
  result?: ContractSchemaRef<TSchemaName>;
  maxDeliver?: number;
  backoffMs?: readonly number[];
  ackWaitMs?: number;
  defaultDeadlineMs?: number;
  progress?: boolean;
  logs?: boolean;
  dlq?: boolean;
  concurrency?: number;
};

export type ContractSourceJobs<TSchemaName extends string = string> = Record<
  string,
  ContractSourceJobQueue<TSchemaName>
>;

export type ContractSourceKvResource<TSchemaName extends string = string> = {
  purpose: string;
  schema: ContractSchemaRef<TSchemaName>;
  required?: boolean;
  history?: number;
  ttlMs?: number;
  maxValueBytes?: number;
};

export type ContractSourceStoreResource = {
  purpose: string;
  required?: boolean;
  ttlMs?: number;
  maxObjectBytes?: number;
  maxTotalBytes?: number;
};

export type ContractSourceResources<TSchemaName extends string = string> = {
  kv?: Record<string, ContractSourceKvResource<TSchemaName>>;
  store?: Record<string, ContractSourceStoreResource>;
};

export type ContractSourceUse = {
  contract: string;
  rpc?: { call?: readonly string[] };
  operations?: { call?: readonly string[] };
  events?: { publish?: readonly string[]; subscribe?: readonly string[] };
  feeds?: { subscribe?: readonly string[] };
};

type ContractSourceUsesFlat = Record<string, ContractSourceUse>;

export type ContractSourceUsesGrouped = {
  required?: Record<string, ContractSourceUse>;
  optional?: Record<string, ContractSourceUse>;
};

export type ContractSourceUses = ContractSourceUsesGrouped;

export type TrellisContractSource = {
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  capabilities?: ContractCapabilities;
  schemas?: ContractSourceSchemas;
  exports?: ContractSourceExports;
  state?: ContractSourceState;
  uses?: ContractSourceUses;
  rpc?: Record<string, ContractSourceRpcMethod>;
  operations?: Record<string, ContractSourceOperation>;
  events?: Record<string, ContractSourceEvent>;
  feeds?: Record<string, ContractSourceFeed>;
  errors?: Record<string, ContractSourceErrorDecl>;
  jobs?: ContractSourceJobs;
  resources?: ContractSourceResources;
};

export type TrellisApiLike = {
  rpc: Record<string, RPCDesc>;
  operations: Record<string, OperationDesc>;
  events: Record<string, EventDesc>;
  feeds?: Record<string, FeedDesc>;
  subjects: Record<string, unknown>;
};

type ApiShape = {
  rpc: Record<string, unknown>;
  operations: Record<string, unknown>;
  events: Record<string, unknown>;
  feeds?: Record<string, unknown>;
  subjects: Record<string, unknown>;
};

export type EmptyApi = {
  rpc: {};
  operations: {};
  events: {};
  feeds?: {};
  subjects: {};
};

type BaselineAuthApi = {
  rpc: {
    "Auth.Sessions.Me": RPCDesc<
      Schema<Record<string, never>>,
      Schema<AuthSessionsMeResponse>
    >;
    "Auth.Sessions.Logout": RPCDesc<
      Schema<AuthSessionsLogoutInput>,
      Schema<AuthSessionsLogoutResponse>
    >;
  };
  operations: {};
  events: {};
  feeds: {};
  subjects: {};
};

type BaselineStateApi = {
  rpc: {
    "State.Get": RPCDesc<Schema<StateGetInput>, Schema<StateGetResponse>>;
    "State.Put": RPCDesc<Schema<StatePutInput>, Schema<StatePutResponse>>;
    "State.Delete": RPCDesc<
      Schema<StateDeleteInput>,
      Schema<StateDeleteResponse>
    >;
    "State.List": RPCDesc<Schema<StateListInput>, Schema<StateListResponse>>;
  };
  operations: {};
  events: {};
  feeds: {};
  subjects: {};
};

type BaselineHealthApi = {
  rpc: {};
  operations: {};
  events: {
    "Health.Heartbeat": EventDesc<Schema<Record<string, unknown>>>;
  };
  feeds: {};
  subjects: {};
};

export type ContractApiViews<
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
> = {
  owned: TOwnedApi;
  used: TUsedApi;
  trellis: TTrellisApi;
};

export type UseSpec<TApi extends ApiShape> = {
  rpc?: {
    call?: readonly StringKeyOf<TApi["rpc"]>[];
  };
  operations?: {
    call?: readonly StringKeyOf<TApi["operations"]>[];
  };
  events?: {
    publish?: readonly StringKeyOf<TApi["events"]>[];
    subscribe?: readonly StringKeyOf<TApi["events"]>[];
  };
  feeds?: {
    subscribe?: readonly StringKeyOf<NonNullable<TApi["feeds"]>>[];
  };
};

type UseRpcCall<TSpec> =
  NonNullable<TSpec extends { rpc?: infer TRpc } ? TRpc : never> extends
    { call?: infer TCall extends readonly string[] | undefined } ? TCall
    : never;
type UseEventsPublish<TSpec> = NonNullable<
  TSpec extends { events?: infer TEvents } ? TEvents : never
> extends { publish?: infer TPublish extends readonly string[] | undefined }
  ? TPublish
  : never;
type UseOperationsCall<TSpec> = NonNullable<
  TSpec extends { operations?: infer TOperations } ? TOperations : never
> extends { call?: infer TCall extends readonly string[] | undefined } ? TCall
  : never;
type UseEventsSubscribe<TSpec> = NonNullable<
  TSpec extends { events?: infer TEvents } ? TEvents : never
> extends { subscribe?: infer TSubscribe extends readonly string[] | undefined }
  ? TSubscribe
  : never;
type UseFeedsSubscribe<TSpec> = NonNullable<
  TSpec extends { feeds?: infer TFeeds } ? TFeeds : never
> extends { subscribe?: infer TSubscribe extends readonly string[] | undefined }
  ? TSubscribe
  : never;
type ContractModuleMarker<
  TContractModule = ContractModule<
    string,
    TrellisApiLike,
    TrellisApiLike,
    TrellisApiLike
  >,
> = {
  readonly [CONTRACT_MODULE_METADATA]: TContractModule;
};

export type ContractDependencyUse<
  TContractId extends string,
  TApi extends ApiShape,
  TSpec extends UseSpec<TApi> = UseSpec<TApi>,
> = {
  contract: TContractId;
  readonly [CONTRACT_MODULE_METADATA]?: ContractModule<
    TContractId,
    TApi,
    ApiShape,
    ApiShape
  >;
  rpc?: { call?: UseRpcCall<TSpec> };
  operations?: { call?: UseOperationsCall<TSpec> };
  events?: {
    publish?: UseEventsPublish<TSpec>;
    subscribe?: UseEventsSubscribe<TSpec>;
  };
  feeds?: { subscribe?: UseFeedsSubscribe<TSpec> };
};

type InternalContractDependencyUse<
  TContractId extends string,
  TApi extends ApiShape,
  TSpec extends UseSpec<TApi> = UseSpec<TApi>,
> = ContractDependencyUse<TContractId, TApi, TSpec> & ContractModuleMarker;

type AnyContractDependencyUse = InternalContractDependencyUse<
  string,
  TrellisApiLike,
  UseSpec<TrellisApiLike>
>;

type AuthorContractDependencyUse = ContractDependencyUse<
  string,
  ApiShape,
  UseSpec<ApiShape>
>;

type AuthorContractUsesFlat = Readonly<
  Record<string, AuthorContractDependencyUse>
>;

type AuthorContractUsesGrouped = {
  required?: AuthorContractUsesFlat;
  optional?: AuthorContractUsesFlat;
};

type AuthorContractUses = AuthorContractUsesGrouped;

export type ContractUseFn<TContractId extends string, TApi extends ApiShape> = <
  const TSpec extends UseSpec<TApi>,
>(spec: TSpec) => ContractDependencyUse<TContractId, TApi, TSpec>;

type MergeRecordUnion<U> = [U] extends [never] ? {}
  : Simplify<UnionToIntersection<U>>;

type SchemaNameOf<TSchemas> = Extract<keyof NonNullable<TSchemas>, string>;

type ResolveSchemaFromMap<
  TSchemas,
  TRef,
> = TRef extends { schema: infer TName }
  ? TName extends SchemaNameOf<TSchemas>
    ? NonNullable<TSchemas>[TName] extends TSchema ? Schema<
        import("./runtime.ts").InferSchemaType<NonNullable<TSchemas>[TName]>
      >
    : Schema<unknown>
  : Schema<unknown>
  : Schema<unknown>;

type ResolveSchemaTypeFromMap<
  TSchemas,
  TRef,
> = TRef extends { schema: infer TName }
  ? TName extends SchemaNameOf<TSchemas>
    ? NonNullable<TSchemas>[TName] extends TSchema
      ? InferSchemaType<NonNullable<TSchemas>[TName]>
    : unknown
  : unknown
  : unknown;

export type ContractJobsMetadata = Record<string, {
  payload: unknown;
  result: unknown;
}>;
export type ContractKvMetadata = Record<string, {
  required: boolean;
  value: unknown;
  schema: TSchema;
}>;
export type ContractStateMetadata = Record<string, {
  kind: ContractStateKind;
  value: unknown;
  schema: unknown;
  stateVersion: string;
  acceptedVersions: Record<string, unknown>;
}>;

type ResolveTypeBoxSchemaFromMap<TSchemas, TRef> = TRef extends {
  schema: infer TName;
}
  ? TName extends SchemaNameOf<TSchemas>
    ? NonNullable<TSchemas>[TName] extends TSchema
      ? NonNullable<TSchemas>[TName]
    : TSchema
  : TSchema
  : TSchema;

type ProjectedJobs<
  T extends ContractSourceJobs<string> | undefined,
  TSchemas,
> = T extends ContractSourceJobs<string> ? {
    [K in keyof T]: {
      payload: ResolveSchemaTypeFromMap<TSchemas, T[K]["payload"]>;
      result: ResolveSchemaTypeFromMap<TSchemas, T[K]["result"]>;
    };
  }
  : {};

type ProjectedState<
  T extends ContractSourceState<string> | undefined,
  TSchemas,
> = T extends ContractSourceState<string> ? {
    [K in keyof T]: T[K] extends { kind: infer TKind extends ContractStateKind }
      ? {
        kind: TKind;
        value: ResolveSchemaTypeFromMap<TSchemas, T[K]["schema"]>;
        schema: unknown;
        stateVersion: T[K] extends
          { stateVersion: infer TVersion extends string } ? TVersion
          : "v1";
        acceptedVersions: T[K] extends { acceptedVersions: infer TVersions }
          ? TVersions
          : {};
      }
      : never;
  }
  : {};

type ProjectedKvResources<
  T extends ContractSourceResources<string> | undefined,
  TSchemas,
> = T extends { kv?: infer TKv } ? TKv extends Record<
    string,
    { schema: ContractSchemaRef<string>; required?: boolean }
  > ? {
      [K in keyof TKv]: {
        required: TKv[K] extends { required: infer TRequired extends boolean }
          ? TRequired
          : true;
        value: ResolveSchemaTypeFromMap<TSchemas, TKv[K]["schema"]>;
        schema: ResolveTypeBoxSchemaFromMap<TSchemas, TKv[K]["schema"]>;
      };
    }
  : {}
  : {};

type JobsFromSource<T> = T extends { jobs?: infer TJobs }
  ? Extract<TJobs, ContractSourceJobs<string> | undefined>
  : undefined;
type ResourcesFromSource<T> = T extends { resources?: infer TResources }
  ? Extract<TResources, ContractSourceResources<string> | undefined>
  : undefined;
type StateFromSource<T> = T extends { state?: infer TState }
  ? Extract<TState, ContractSourceState<string> | undefined>
  : undefined;

type SchemasFromSource<T> = T extends { schemas?: infer TSchemas } ? TSchemas
  : undefined;

type RuntimeErrorFromSourceDecl<TDecl, TSchemas> = TDecl extends {
  type: infer TType extends string;
  schema?: infer TSchemaRef;
}
  ? TDecl extends ContractErrorRuntimeMarker<infer TClass>
    ? TClass extends RpcErrorClass<SerializableErrorData, infer TError>
      ? RuntimeRpcErrorDesc<
        TType,
        ResolveSchemaFromMap<TSchemas, TSchemaRef>,
        TError
      >
    : never
  : never
  : never;

type RuntimeErrorsForNames<TNames, TErrors, TSchemas> = TNames extends
  readonly string[] ? readonly RuntimeErrorFromSourceDecl<
    NonNullable<TErrors>[Extract<TNames[number], keyof NonNullable<TErrors>>],
    TSchemas
  >[]
  : undefined;

type ProjectedRpcMethod<
  TMethod extends ContractSourceRpcMethod,
  TSchemas,
  _TErrors,
> =
  & {
    subject: string;
    input: ResolveSchemaFromMap<TSchemas, TMethod["input"]>;
    output: ResolveSchemaFromMap<TSchemas, TMethod["output"]>;
    callerCapabilities: readonly string[];
    authRequired?: boolean;
    errors?: TMethod["errors"];
    runtimeErrors?: readonly RuntimeRpcErrorDesc[];
    declaredErrorTypes?: readonly string[];
  }
  & (TMethod extends { transfer: infer TTransfer } ? { transfer: TTransfer }
    : {});

type BuiltRuntimeErrorDesc = {
  type: string;
  schema?: Schema<unknown>;
  fromSerializable(data: SerializableErrorData): BaseError;
};

type BuiltRpcDesc = {
  subject: string;
  input: Schema<unknown>;
  output: Schema<unknown>;
  callerCapabilities: readonly string[];
  transfer?: { direction: "receive" };
  authRequired?: boolean;
  errors?: readonly string[];
  declaredErrorTypes?: readonly string[];
  runtimeErrors?: readonly BuiltRuntimeErrorDesc[];
};

const TRELLIS_AUTH_CONTRACT_ID = "trellis.auth@v1";
const TRELLIS_STATE_CONTRACT_ID = "trellis.state@v1";
const TRELLIS_HEALTH_CONTRACT_ID = "trellis.health@v1";

const BASELINE_AUTH_RPC_CALL = [
  "Auth.Sessions.Me",
  "Auth.Sessions.Logout",
] as const;
const BASELINE_STATE_RPC_CALL = [
  "State.Get",
  "State.Put",
  "State.Delete",
  "State.List",
] as const;
const BASELINE_HEALTH_EVENTS_PUBLISH = ["Health.Heartbeat"] as const;

const UnknownRuntimeSchema = schema(Type.Unknown());

function typedUnknownRuntimeSchema<T>(): Schema<T> {
  return UnknownRuntimeSchema as Schema<T>;
}

function trellisRpcDesc<TInput, TOutput>(
  name: string,
): RPCDesc<Schema<TInput>, Schema<TOutput>> {
  return {
    subject: rpcSubject(name, "v1"),
    input: typedUnknownRuntimeSchema<TInput>(),
    output: typedUnknownRuntimeSchema<TOutput>(),
    callerCapabilities: [],
  };
}

function trellisEventDesc<TEvent>(
  name: string,
): EventDesc<Schema<TEvent>> {
  return {
    subject: eventSubject(name, "v1", undefined),
    event: typedUnknownRuntimeSchema<TEvent>(),
    publishCapabilities: [],
    subscribeCapabilities: [],
  };
}

const BASELINE_AUTH_API: BaselineAuthApi = {
  rpc: {
    "Auth.Sessions.Me": trellisRpcDesc<
      Record<string, never>,
      AuthSessionsMeResponse
    >(
      "Auth.Sessions.Me",
    ),
    "Auth.Sessions.Logout": trellisRpcDesc<
      AuthSessionsLogoutInput,
      AuthSessionsLogoutResponse
    >(
      "Auth.Sessions.Logout",
    ),
  },
  operations: {},
  events: {},
  feeds: {},
  subjects: {},
};

const BASELINE_STATE_API: BaselineStateApi = {
  rpc: {
    "State.Get": trellisRpcDesc<StateGetInput, StateGetResponse>("State.Get"),
    "State.Put": trellisRpcDesc<StatePutInput, StatePutResponse>("State.Put"),
    "State.Delete": trellisRpcDesc<StateDeleteInput, StateDeleteResponse>(
      "State.Delete",
    ),
    "State.List": trellisRpcDesc<StateListInput, StateListResponse>(
      "State.List",
    ),
  },
  operations: {},
  events: {},
  feeds: {},
  subjects: {},
};

const BASELINE_HEALTH_API: BaselineHealthApi = {
  rpc: {},
  operations: {},
  events: {
    "Health.Heartbeat": trellisEventDesc<Record<string, unknown>>(
      "Health.Heartbeat",
    ),
  },
  feeds: {},
  subjects: {},
};

type ProjectedRpc<
  T,
  TSchemas,
  TErrors,
> = T extends Readonly<Record<string, ContractSourceRpcMethod>> ? {
    [K in keyof T]: ProjectedRpcMethod<T[K], TSchemas, TErrors>;
  }
  : {};

type ProjectedOperations<
  T,
  TSchemas,
> = T extends Readonly<Record<string, ContractSourceOperation>> ? {
    [K in keyof T]:
      & OperationDesc<
        ResolveSchemaFromMap<TSchemas, T[K]["input"]>,
        ResolveSchemaFromMap<TSchemas, T[K]["progress"]>,
        ResolveSchemaFromMap<TSchemas, T[K]["output"]>
      >
      & (T[K]["transfer"] extends undefined ? {}
        : { transfer: T[K]["transfer"] });
  }
  : {};

type ProjectedEvents<
  T,
  TSchemas,
> = T extends Readonly<Record<string, ContractSourceEvent>> ? {
    [K in keyof T]: EventDesc<
      ResolveSchemaFromMap<TSchemas, T[K]["event"]>
    >;
  }
  : {};

type ProjectedFeeds<
  T,
  TSchemas,
> = T extends Readonly<Record<string, ContractSourceFeed>> ? {
    [K in keyof T]: FeedDesc<
      ResolveSchemaFromMap<TSchemas, T[K]["input"]>,
      ResolveSchemaFromMap<TSchemas, T[K]["event"]>
    >;
  }
  : {};

export type OwnedApiFromSource<
  T extends {
    schemas?: Readonly<Record<string, TSchema>>;
    errors?: unknown;
    rpc?: unknown;
    operations?: unknown;
    events?: unknown;
    feeds?: unknown;
  },
> = {
  rpc: ProjectedRpc<T["rpc"], T["schemas"], T["errors"]>;
  operations: ProjectedOperations<T["operations"], T["schemas"]>;
  events: ProjectedEvents<T["events"], T["schemas"]>;
  feeds: ProjectedFeeds<T["feeds"], T["schemas"]>;
  subjects: {};
};

type RpcKeysFromSpec<TSpec> = TSpec extends { rpc?: { call?: infer TCall } }
  ? KeysFromList<TCall>
  : never;
type EventKeysFromSpec<TSpec> =
  | (TSpec extends { events?: { publish?: infer TPublish } }
    ? KeysFromList<TPublish>
    : never)
  | (TSpec extends { events?: { subscribe?: infer TSubscribe } }
    ? KeysFromList<TSubscribe>
    : never);
type OperationKeysFromSpec<TSpec> = TSpec extends
  { operations?: { call?: infer TCall } } ? KeysFromList<TCall>
  : never;
type FeedKeysFromSpec<TSpec> = TSpec extends
  { feeds?: { subscribe?: infer TSubscribe } } ? KeysFromList<TSubscribe>
  : never;
type ApiFromDependencyUse<TUse> = TUse extends
  ContractDependencyUse<string, infer TApi, infer TSpec> ? {
    rpc: Pick<TApi["rpc"], RpcKeysFromSpec<TSpec>>;
    operations: Pick<TApi["operations"], OperationKeysFromSpec<TSpec>>;
    events: Pick<TApi["events"], EventKeysFromSpec<TSpec>>;
    feeds: Pick<NonNullable<TApi["feeds"]>, FeedKeysFromSpec<TSpec>>;
    subjects: {};
  }
  : EmptyApi;
type DependencyUsesFromUses<TUses> = TUses extends {
  required?: AuthorContractUsesFlat;
  optional?: AuthorContractUsesFlat;
} ?
    | NonNullable<TUses["required"]>[keyof NonNullable<TUses["required"]>]
    | NonNullable<TUses["optional"]>[keyof NonNullable<TUses["optional"]>]
  : never;

export type UsedApiFromUses<TUses> = [TUses] extends [undefined] ? EmptyApi
  : TUses extends Record<string, unknown> ? {
      rpc: MergeRecordUnion<
        ApiFromDependencyUse<DependencyUsesFromUses<TUses>>["rpc"]
      >;
      operations: MergeRecordUnion<
        ApiFromDependencyUse<DependencyUsesFromUses<TUses>>["operations"]
      >;
      events: MergeRecordUnion<
        ApiFromDependencyUse<DependencyUsesFromUses<TUses>>["events"]
      >;
      feeds: MergeRecordUnion<
        ApiFromDependencyUse<DependencyUsesFromUses<TUses>>["feeds"]
      >;
      subjects: MergeRecordUnion<
        ApiFromDependencyUse<DependencyUsesFromUses<TUses>>["subjects"]
      >;
    }
  : EmptyApi;

type ImplicitAuthApiForKind<TKind> = TKind extends "app" | "agent" | "device"
  ? BaselineAuthApi
  : EmptyApi;

type ImplicitStateApiForSource<T> = [StateFromSource<T>] extends [undefined]
  ? EmptyApi
  : BaselineStateApi;

type ImplicitHealthApiForSource<T> = T extends {
  kind: infer TKind;
  id: infer TId;
} ? TId extends "trellis.health@v1" ? EmptyApi
  : TKind extends "service" | "device" ? BaselineHealthApi
  : EmptyApi
  : EmptyApi;

type ImplicitTrellisApiFromSource<T> = T extends { kind: infer TKind }
  ? MergeApis<
    MergeApis<ImplicitAuthApiForKind<TKind>, ImplicitStateApiForSource<T>>,
    ImplicitHealthApiForSource<T>
  >
  : EmptyApi;

export type UsedApiFromSource<T extends { uses?: unknown }> = MergeApis<
  UsedApiFromUses<T["uses"]>,
  ImplicitTrellisApiFromSource<T>
>;

export type MergeApis<TOwnedApi extends ApiShape, TUsedApi extends ApiShape> = {
  rpc: Simplify<TUsedApi["rpc"] & TOwnedApi["rpc"]>;
  operations: Simplify<TUsedApi["operations"] & TOwnedApi["operations"]>;
  events: Simplify<TUsedApi["events"] & TOwnedApi["events"]>;
  feeds: Simplify<TUsedApi["feeds"] & TOwnedApi["feeds"]>;
  subjects: Simplify<TUsedApi["subjects"] & TOwnedApi["subjects"]>;
};

export type ContractModule<
  TContractId extends string,
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
  TJobs extends ContractJobsMetadata = {},
  TState extends ContractStateMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = {
  CONTRACT_ID: TContractId;
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST: string;
  API: ContractApiViews<TOwnedApi, TUsedApi, TTrellisApi>;
  use: ContractUseFn<TContractId, TOwnedApi>;
  readonly [CONTRACT_JOBS_METADATA]?: TJobs;
  readonly [CONTRACT_STATE_METADATA]?: TState;
  readonly [CONTRACT_KV_METADATA]?: TKv;
};

export type SdkContractModule<
  TContractId extends string,
  TOwnedApi extends ApiShape,
  TJobs extends ContractJobsMetadata = {},
  TState extends ContractStateMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> =
  & Omit<
    ContractModule<
      TContractId,
      TOwnedApi,
      EmptyApi,
      TOwnedApi,
      TJobs,
      TState,
      TKv
    >,
    "use"
  >
  & {
    use: ContractUseFn<TContractId, TOwnedApi>;
  };

export type DefinedContract<
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
  TContractId extends string = string,
  TJobs extends ContractJobsMetadata = {},
  TState extends ContractStateMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = ContractModule<
  TContractId,
  TOwnedApi,
  TUsedApi,
  TTrellisApi,
  TJobs,
  TState,
  TKv
>;

export type DefineContractInput<
  TCapabilities extends ContractCapabilities | undefined =
    | ContractCapabilities
    | undefined,
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends
    | AuthorContractUses
    | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, ErrorClass>>
    | undefined = undefined,
  TRpc extends
    | Readonly<
      Record<
        string,
        ContractSourceRpcMethod<
          SchemaNameOf<TSchemas>,
          ErrorNameOf<TErrors>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
  TOperations extends
    | Readonly<
      Record<
        string,
        ContractSourceOperation<
          SchemaNameOf<TSchemas>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
  TEvents extends
    | Readonly<
      Record<
        string,
        ContractSourceEvent<
          SchemaNameOf<TSchemas>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
> = {
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  capabilities?: ContractCapabilities;
  schemas?: TSchemas;
  exports?: ContractSourceExports<SchemaNameOf<TSchemas>>;
  state?: ContractSourceState<SchemaNameOf<TSchemas>>;
  uses?: TUses;
  errors?: TErrors;
  rpc?: TRpc;
  operations?: TOperations;
  events?: TEvents;
  feeds?: Readonly<
    Record<
      string,
      ContractSourceFeed<
        SchemaNameOf<TSchemas>,
        CapabilityRef<TCapabilities>
      >
    >
  >;
  jobs?: ContractSourceJobs<SchemaNameOf<TSchemas>>;
  resources?: ContractSourceResources<SchemaNameOf<TSchemas>>;
};

type DefineContractSource = {
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  capabilities?: ContractCapabilities;
  schemas?: Readonly<Record<string, TSchema>>;
  exports?: ContractSourceExports;
  state?: ContractSourceState;
  uses?: AuthorContractUses;
  errors?: Readonly<Record<string, ContractSourceErrorDecl>>;
  rpc?: Readonly<Record<string, ContractSourceRpcMethod>>;
  operations?: Readonly<Record<string, ContractSourceOperation>>;
  events?: Readonly<Record<string, ContractSourceEvent>>;
  feeds?: Readonly<Record<string, ContractSourceFeed>>;
  jobs?: ContractSourceJobs;
  resources?: ContractSourceResources;
};

type ConstrainSection<TSection, TExpected> = [TSection] extends [undefined]
  ? undefined
  : TSection & TExpected;

type ValidateDefineContractInput<T extends DefineContractSource> =
  & T
  & DefineContractInput<
    T["capabilities"],
    T["schemas"],
    ConstrainSection<
      T["uses"],
      AuthorContractUses
    >,
    ConstrainSection<
      T["errors"],
      Readonly<Record<string, ErrorClass>>
    >,
    ConstrainSection<
      T["rpc"],
      Readonly<
        Record<
          string,
          ContractSourceRpcMethod<
            SchemaNameOf<T["schemas"]>,
            ErrorNameOf<T["errors"]>,
            CapabilityRef<T["capabilities"]>
          >
        >
      >
    >,
    ConstrainSection<
      T["operations"],
      Readonly<
        Record<
          string,
          ContractSourceOperation<
            SchemaNameOf<T["schemas"]>,
            CapabilityRef<T["capabilities"]>
          >
        >
      >
    >,
    ConstrainSection<
      T["events"],
      Readonly<
        Record<
          string,
          ContractSourceEvent<
            SchemaNameOf<T["schemas"]>,
            CapabilityRef<T["capabilities"]>
          >
        >
      >
    >
  >;

type DefineContractRegistry<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, unknown>>
    | undefined = undefined,
> = {
  schemas?: TSchemas;
  errors?: TErrors;
};

type AnyDefineContractRegistry = DefineContractRegistry<
  Readonly<Record<string, TSchema>> | undefined,
  Readonly<Record<string, unknown>> | undefined
>;

type ClientContractRegistry<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
> = {
  schemas?: TSchemas;
};

type RegistrySchemas<TRegistry extends AnyDefineContractRegistry> =
  TRegistry extends { schemas?: infer TSchemas }
    ? TSchemas extends Readonly<Record<string, TSchema>> | undefined ? TSchemas
    : undefined
    : undefined;

type RegistryErrors<TRegistry extends AnyDefineContractRegistry> =
  TRegistry extends { errors?: infer TErrors }
    ? TErrors extends Readonly<Record<string, unknown>> | undefined
      ? ExtractErrorClasses<
        TErrors
      >
    : undefined
    : undefined;

type RegistryUses = AuthorContractUses | undefined;

type RegistryRpcMethods<TRegistry extends AnyDefineContractRegistry> =
  | Readonly<
    Record<
      string,
      ContractSourceRpcMethod<
        SchemaNameOf<RegistrySchemas<TRegistry>>,
        ErrorNameOf<RegistryErrors<TRegistry>>
      >
    >
  >
  | undefined;

type RegistryOperations<TRegistry extends AnyDefineContractRegistry> =
  | Readonly<
    Record<
      string,
      ContractSourceOperation<SchemaNameOf<RegistrySchemas<TRegistry>>>
    >
  >
  | undefined;

type RegistryEvents<TRegistry extends AnyDefineContractRegistry> =
  | Readonly<
    Record<
      string,
      ContractSourceEvent<SchemaNameOf<RegistrySchemas<TRegistry>>>
    >
  >
  | undefined;

type BodyCapabilities<TBody> = Extract<
  TBody extends { capabilities: infer TCapabilities } ? TCapabilities
    : undefined,
  ContractCapabilities | undefined
>;

type BodyRpcMethods<TBody, TRegistry extends AnyDefineContractRegistry> =
  TBody extends { rpc?: infer TRpc } ? ConstrainSection<
      TRpc,
      Readonly<
        Record<
          string,
          ContractSourceRpcMethod<
            SchemaNameOf<RegistrySchemas<TRegistry>>,
            ErrorNameOf<RegistryErrors<TRegistry>>,
            CapabilityRef<BodyCapabilities<TBody>>
          >
        >
      >
    >
    : undefined;

type BodyOperations<TBody, TRegistry extends AnyDefineContractRegistry> =
  TBody extends { operations?: infer TOperations } ? ConstrainSection<
      TOperations,
      Readonly<
        Record<
          string,
          ContractSourceOperation<
            SchemaNameOf<RegistrySchemas<TRegistry>>,
            CapabilityRef<BodyCapabilities<TBody>>
          >
        >
      >
    >
    : undefined;

type BodyEvents<TBody, TRegistry extends AnyDefineContractRegistry> =
  TBody extends { events?: infer TEvents } ? ConstrainSection<
      TEvents,
      Readonly<
        Record<
          string,
          ContractSourceEvent<
            SchemaNameOf<RegistrySchemas<TRegistry>>,
            CapabilityRef<BodyCapabilities<TBody>>
          >
        >
      >
    >
    : undefined;

type ValidateCapabilitySections<
  TBody,
  TRegistry extends AnyDefineContractRegistry,
> = {
  rpc?: BodyRpcMethods<TBody, TRegistry>;
  operations?: BodyOperations<TBody, TRegistry>;
  events?: BodyEvents<TBody, TRegistry>;
};

type UsedApiOf<TBody extends { uses?: unknown }> = UsedApiFromUses<
  TBody["uses"]
>;

type DefineContractBodyInput<
  TCapabilities extends ContractCapabilities | undefined =
    | ContractCapabilities
    | undefined,
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends AuthorContractUses | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, ErrorClass>>
    | undefined = undefined,
  TRpc extends
    | Readonly<
      Record<
        string,
        ContractSourceRpcMethod<
          SchemaNameOf<TSchemas>,
          ErrorNameOf<TErrors>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
  TOperations extends
    | Readonly<
      Record<
        string,
        ContractSourceOperation<
          SchemaNameOf<TSchemas>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
  TEvents extends
    | Readonly<
      Record<
        string,
        ContractSourceEvent<
          SchemaNameOf<TSchemas>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
> =
  & Omit<
    DefineContractInput<
      TCapabilities,
      TSchemas,
      TUses,
      TErrors,
      TRpc,
      TOperations,
      TEvents
    >,
    "schemas" | "errors"
  >
  & {
    schemas?: never;
    errors?: never;
  };

type ServiceContractBodyInput<
  TCapabilities extends ContractCapabilities | undefined =
    | ContractCapabilities
    | undefined,
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends AuthorContractUses | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, ErrorClass>>
    | undefined = undefined,
  TRpc extends
    | Readonly<
      Record<
        string,
        ContractSourceRpcMethod<
          SchemaNameOf<TSchemas>,
          ErrorNameOf<TErrors>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
  TOperations extends
    | Readonly<
      Record<
        string,
        ContractSourceOperation<
          SchemaNameOf<TSchemas>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
  TEvents extends
    | Readonly<
      Record<
        string,
        ContractSourceEvent<
          SchemaNameOf<TSchemas>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined = undefined,
> =
  & Omit<
    DefineContractBodyInput<
      TCapabilities,
      TSchemas,
      TUses,
      TErrors,
      TRpc,
      TOperations,
      TEvents
    >,
    "kind"
  >
  & { kind?: never; subjects?: never };

type ClientContractBodyInput<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends AuthorContractUses | undefined = undefined,
> = ContractIdentityFields & {
  capabilities?: ContractCapabilities;
  exports?: ContractSourceExports<SchemaNameOf<TSchemas>>;
  state?: ContractSourceState<SchemaNameOf<TSchemas>>;
  uses?: TUses;
  kind?: never;
  schemas?: never;
  errors?: never;
  rpc?: never;
  operations?: never;
  events?: never;
  subjects?: never;
  resources?: never;
};

type BuiltContractSource<
  TRegistry extends AnyDefineContractRegistry,
  TBody extends { id: string },
> = Simplify<
  & Omit<TBody, "schemas" | "errors">
  & (TRegistry extends { schemas?: infer TSchemas } ? { schemas?: TSchemas }
    : {})
  & (TRegistry extends { errors?: infer TErrors } ? { errors?: TErrors } : {})
>;

type WithKind<TBody extends { id: string }, TKind extends ContractKind> =
  Simplify<
    Omit<TBody, "kind"> & { kind: TKind }
  >;

function createContractRefBuilder<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  TErrors extends Readonly<Record<string, ErrorClass>> | undefined,
>(
  registry: DefineContractRegistry<TSchemas, TErrors>,
): ContractRefBuilder<TSchemas, TErrors> {
  const schemaRef = registry.schemas
    ? createSchemaRef(registry.schemas)
    : undefined;
  return {
    schema<const TName extends SchemaNameOf<TSchemas>>(
      schemaName: TName,
    ): ContractSchemaRef<TName> {
      if (!schemaRef) {
        throw new Error(
          `Contract builder ref.schema('${schemaName}') requires a schemas registry`,
        );
      }
      return schemaRef(schemaName);
    },
    error<const TName extends ErrorNameOf<TErrors>>(errorName: TName): TName {
      return errorName;
    },
    capability<const TName extends GlobalCapability | PlatformCapability>(
      capabilityName: TName,
    ): TName {
      return capabilityName;
    },
  };
}

function cloneSchema(schemaValue: TSchema): JsonSchema {
  const cloned = JSON.parse(JSON.stringify(schemaValue));
  if (!isJsonValue(cloned)) {
    throw new Error("Contract schema is not JSON-serializable");
  }
  return cloned;
}

function cloneSchemas(
  schemas: ContractSourceSchemas | undefined,
): ContractSchemas | undefined {
  if (!schemas) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(schemas).map((
      [name, schemaValue],
    ) => [name, cloneSchema(schemaValue)]),
  );
}

function cloneContractExports(
  contractExports: ContractSourceExports | undefined,
): ContractExports | undefined {
  if (!contractExports) {
    return undefined;
  }

  return {
    ...(contractExports.schemas
      ? { schemas: [...contractExports.schemas] }
      : {}),
  };
}

function getErrorRuntimeSchema(
  errorDecl: ContractSourceErrorDecl,
): TSchema | undefined {
  const errorClass = getContractErrorRuntimeClass(errorDecl);
  const runtimeSchema = errorClass
    ? Reflect.get(errorClass, "schema")
    : undefined;
  if (!runtimeSchema || typeof runtimeSchema !== "object") {
    return undefined;
  }

  return runtimeSchema as TSchema;
}

function createContractErrorDecl<TClass extends ErrorClass>(
  errorClass: TClass,
): ContractSourceErrorDecl<string> & ContractErrorRuntimeMarker<TClass> {
  const errorDecl: ContractSourceErrorDecl<string> = {
    type: getContractErrorType(errorClass),
  };
  return attachContractErrorRuntimeMetadata(errorDecl, errorClass);
}

function normalizeErrorRegistry(
  errors: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, ContractSourceErrorDecl>> | undefined {
  if (!errors) {
    return undefined;
  }

  const normalizedEntries = Object.entries(errors).flatMap(([key, value]) =>
    isErrorClass(value) ? [[key, createContractErrorDecl(value)]] : []
  );
  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function getErrorClassRegistry(
  errors: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, ErrorClass>> | undefined {
  if (!errors) {
    return undefined;
  }

  const classEntries = Object.entries(errors).flatMap(([key, value]) =>
    isErrorClass(value) ? [[key, value]] : []
  );
  if (classEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(classEntries);
}

function findMatchingSchemaName(
  schemas: ContractSourceSchemas | undefined,
  targetSchema: TSchema,
): string | undefined {
  if (!schemas) {
    return undefined;
  }

  const targetDigest = digestCanonicalJson(cloneSchema(targetSchema));
  for (const [schemaName, schemaValue] of Object.entries(schemas)) {
    if (schemaValue === targetSchema) {
      return schemaName;
    }

    if (digestCanonicalJson(cloneSchema(schemaValue)) === targetDigest) {
      return schemaName;
    }
  }

  return undefined;
}

function chooseDerivedErrorSchemaName(
  schemas: ContractSourceSchemas,
  errorName: string,
  errorType: string,
): string {
  const baseNames = [`${errorType}Data`, `${errorName}Data`];

  for (const baseName of baseNames) {
    if (!Object.hasOwn(schemas, baseName)) {
      return baseName;
    }
  }

  let suffix = 2;
  while (true) {
    const candidate = `${errorType}Data${suffix}`;
    if (!Object.hasOwn(schemas, candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function materializeErrorSchemas(
  schemas: ContractSourceSchemas | undefined,
  errors: Record<string, ContractSourceErrorDecl> | undefined,
): ContractSourceSchemas | undefined {
  if (!errors) {
    return schemas;
  }

  let mergedSchemas = schemas;
  for (const [errorName, errorDecl] of Object.entries(errors)) {
    if (errorDecl.schema) {
      continue;
    }

    const runtimeSchema = getErrorRuntimeSchema(errorDecl);
    if (!runtimeSchema) {
      continue;
    }

    if (findMatchingSchemaName(mergedSchemas, runtimeSchema)) {
      continue;
    }

    mergedSchemas = { ...(mergedSchemas ?? {}) };
    const derivedSchemaName = chooseDerivedErrorSchemaName(
      mergedSchemas,
      errorName,
      errorDecl.type,
    );
    mergedSchemas[derivedSchemaName] = runtimeSchema;
  }

  return mergedSchemas;
}

function assertSchemaRefExists(
  schemas: ContractSourceSchemas | undefined,
  ref: ContractSchemaRef,
  context: string,
): void {
  if (!schemas || !Object.hasOwn(schemas, ref.schema)) {
    throw new Error(`${context} references unknown schema '${ref.schema}'`);
  }
}

function assertExportedSchemasExist(
  schemas: ContractSourceSchemas | undefined,
  contractExports: ContractSourceExports | undefined,
): void {
  for (const schemaName of contractExports?.schemas ?? []) {
    if (!schemas || !Object.hasOwn(schemas, schemaName)) {
      throw new Error(
        `contract exports reference unknown schema '${schemaName}'`,
      );
    }
  }
}

function assertRegistryDoesNotDeclareExports(
  registry: AnyDefineContractRegistry,
): void {
  if (Object.hasOwn(registry, "exports")) {
    throw new Error(
      "contract exports must be declared in the callback body, not the registry argument",
    );
  }
}

function assertRegistryDoesNotDeclareCapabilities(
  registry: AnyDefineContractRegistry,
): void {
  if (Object.hasOwn(registry, "capabilities")) {
    throw new Error(
      "contract capabilities must be declared in the callback body, not the registry argument",
    );
  }
}

function resolveSchemaRef(
  schemas: ContractSourceSchemas | undefined,
  ref: ContractSchemaRef,
  context: string,
): JsonSchema {
  assertSchemaRefExists(schemas, ref, context);
  const schema = schemas?.[ref.schema];
  if (!schema) {
    throw new Error(`${context} references missing schema '${ref.schema}'`);
  }
  return cloneSchema(schema);
}

function digestCanonicalJson(value: JsonValue): string {
  return sha256Base64urlSync(canonicalizeJson(value));
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Return the global capability namespace for a contract id. */
export function contractCapabilityNamespace(contractId: string): string {
  return contractId.replace(/@v\d+$/, "");
}

/** Return the globally qualified name for a contract-local capability. */
export function globalCapabilityName(
  contractId: string,
  localCapability: string,
): string {
  return `${contractCapabilityNamespace(contractId)}::${localCapability}`;
}

function projectCapabilities(
  capabilities: readonly Capability[] | undefined,
  contractId: string,
  declaredCapabilities: ContractCapabilities | undefined,
  context: string,
): string[] | undefined {
  if (!capabilities) {
    return undefined;
  }
  return sortedUnique(
    capabilities.map((capability) => {
      if (
        declaredCapabilities && Object.hasOwn(declaredCapabilities, capability)
      ) {
        return globalCapabilityName(contractId, capability);
      }
      if (
        capability === "admin" || capability === "service" ||
        capability.includes("::")
      ) {
        return capability;
      }
      throw new Error(
        `${context} references undeclared local capability '${capability}'`,
      );
    }),
  );
}

function emitCapabilities(
  contractId: string,
  capabilities: ContractCapabilities | undefined,
): ContractCapabilities | undefined {
  if (!capabilities) {
    return undefined;
  }

  const entries: [string, ContractCapabilityMetadata][] = Object.entries(
    capabilities,
  )
    .map(([localCapability, metadata]) => [
      globalCapabilityName(contractId, localCapability),
      { ...metadata },
    ]);
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function collectSchemaRef(
  reachableSchemas: Set<string>,
  ref: ContractSchemaRef | undefined,
): void {
  if (ref) {
    reachableSchemas.add(ref.schema);
  }
}

function collectReachableSchemaNames(contract: TrellisContractV1): Set<string> {
  const reachableSchemas = new Set<string>();

  for (const store of Object.values(contract.state ?? {})) {
    collectSchemaRef(reachableSchemas, store.schema);
    for (const accepted of Object.values(store.acceptedVersions ?? {})) {
      collectSchemaRef(reachableSchemas, accepted);
    }
  }

  for (const method of Object.values(contract.rpc ?? {})) {
    collectSchemaRef(reachableSchemas, method.input);
    collectSchemaRef(reachableSchemas, method.output);
    for (const error of method.errors ?? []) {
      const declaration = Object.values(contract.errors ?? {}).find((decl) =>
        decl.type === error.type
      );
      collectSchemaRef(reachableSchemas, declaration?.schema);
    }
  }

  for (const operation of Object.values(contract.operations ?? {})) {
    collectSchemaRef(reachableSchemas, operation.input);
    collectSchemaRef(reachableSchemas, operation.progress);
    collectSchemaRef(reachableSchemas, operation.output);
    for (const signal of Object.values(operation.signals ?? {})) {
      collectSchemaRef(reachableSchemas, signal.input);
    }
  }

  for (const event of Object.values(contract.events ?? {})) {
    collectSchemaRef(reachableSchemas, event.event);
  }

  for (const feed of Object.values(contract.feeds ?? {})) {
    collectSchemaRef(reachableSchemas, feed.input);
    collectSchemaRef(reachableSchemas, feed.event);
  }

  for (const job of Object.values(contract.jobs ?? {})) {
    collectSchemaRef(reachableSchemas, job.payload);
    collectSchemaRef(reachableSchemas, job.result);
  }

  for (const resource of Object.values(contract.resources?.kv ?? {})) {
    collectSchemaRef(reachableSchemas, resource.schema);
  }

  return reachableSchemas;
}

function projectReachableSchemas(
  contract: TrellisContractV1,
): ContractSchemas | undefined {
  const reachableNames = collectReachableSchemaNames(contract);
  if (!contract.schemas || reachableNames.size === 0) {
    return undefined;
  }

  const entries = Object.entries(contract.schemas).filter(([name]) =>
    reachableNames.has(name)
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function projectRpcDeclaredErrors(
  contract: TrellisContractV1,
): Record<string, ContractErrorDecl> | undefined {
  if (!contract.errors) {
    return undefined;
  }

  const declaredErrorTypes = new Set<string>();
  for (const method of Object.values(contract.rpc ?? {})) {
    for (const error of method.errors ?? []) {
      declaredErrorTypes.add(error.type);
    }
  }

  const entries = Object.entries(contract.errors).filter(([, error]) =>
    declaredErrorTypes.has(error.type)
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function projectDigestResources(
  resources: ContractResources | undefined,
): ContractResources | undefined {
  if (!resources?.kv && !resources?.store) {
    return undefined;
  }
  return {
    ...(resources.kv ? { kv: resources.kv } : {}),
    ...(resources.store ? { store: resources.store } : {}),
  };
}

function projectDigestUsesFlat(
  uses: ContractUsesFlat | undefined,
): ContractUsesFlat | undefined {
  if (!uses) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(uses).map(([alias, use]) => [
      alias,
      {
        contract: use.contract,
        ...(use.rpc?.call ? { rpc: { call: sortedUnique(use.rpc.call) } } : {}),
        ...(use.operations?.call
          ? { operations: { call: sortedUnique(use.operations.call) } }
          : {}),
        ...((use.events?.publish || use.events?.subscribe)
          ? {
            events: {
              ...(use.events.publish
                ? { publish: sortedUnique(use.events.publish) }
                : {}),
              ...(use.events.subscribe
                ? { subscribe: sortedUnique(use.events.subscribe) }
                : {}),
            },
          }
          : {}),
        ...(use.feeds?.subscribe
          ? { feeds: { subscribe: sortedUnique(use.feeds.subscribe) } }
          : {}),
      } satisfies ContractUse,
    ]),
  );
}

function omitRequiredUseAliases<TUse>(
  optional: Record<string, TUse> | undefined,
  required: Record<string, TUse> | undefined,
): Record<string, TUse> | undefined {
  if (!optional) {
    return undefined;
  }
  if (!required) {
    return optional;
  }
  const requiredAliases = new Set(Object.keys(required));
  const entries = Object.entries(optional).filter(([alias]) =>
    !requiredAliases.has(alias)
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function projectDigestUses(
  uses: ContractUses | undefined,
): ContractUses | undefined {
  if (!uses) {
    return undefined;
  }

  const required = projectDigestUsesFlat(uses.required);
  const optional = omitRequiredUseAliases(
    projectDigestUsesFlat(uses.optional),
    required,
  );
  if (!required && !optional) {
    return undefined;
  }
  return {
    ...(required ? { required } : {}),
    ...(optional ? { optional } : {}),
  };
}

function projectDigestRpc(
  rpc: Record<string, ContractRpcMethod> | undefined,
): Record<string, ContractRpcMethod> | undefined {
  if (!rpc) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(rpc).map(([name, method]) => [
      name,
      {
        ...method,
        ...(method.capabilities?.call
          ? { capabilities: { call: sortedUnique(method.capabilities.call) } }
          : {}),
        ...(method.errors
          ? {
            errors: sortedUnique(method.errors.map((error) => error.type)).map((
              type,
            ) => ({ type })),
          }
          : {}),
      } satisfies ContractRpcMethod,
    ]),
  );
}

function projectDigestOperations(
  operations: Record<string, ContractOperation> | undefined,
): Record<string, ContractOperation> | undefined {
  if (!operations) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(operations).map(([name, operation]) => [
      name,
      {
        ...operation,
        ...((operation.capabilities?.call || operation.capabilities?.read ||
            operation.capabilities?.cancel || operation.capabilities?.control)
          ? {
            capabilities: {
              ...(operation.capabilities.call
                ? { call: sortedUnique(operation.capabilities.call) }
                : {}),
              ...(operation.capabilities.read
                ? { read: sortedUnique(operation.capabilities.read) }
                : {}),
              ...(operation.capabilities.cancel
                ? { cancel: sortedUnique(operation.capabilities.cancel) }
                : {}),
              ...(operation.capabilities.control
                ? { control: sortedUnique(operation.capabilities.control) }
                : {}),
            },
          }
          : {}),
      } satisfies ContractOperation,
    ]),
  );
}

function projectDigestEvents(
  events: Record<string, ContractEvent> | undefined,
): Record<string, ContractEvent> | undefined {
  if (!events) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(events).map(([name, event]) => [
      name,
      {
        ...event,
        ...((event.capabilities?.publish || event.capabilities?.subscribe)
          ? {
            capabilities: {
              ...(event.capabilities.publish
                ? { publish: sortedUnique(event.capabilities.publish) }
                : {}),
              ...(event.capabilities.subscribe
                ? { subscribe: sortedUnique(event.capabilities.subscribe) }
                : {}),
            },
          }
          : {}),
      } satisfies ContractEvent,
    ]),
  );
}

function projectDigestFeeds(
  feeds: Record<string, ContractFeed> | undefined,
): Record<string, ContractFeed> | undefined {
  if (!feeds) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(feeds).map(([name, feed]) => [
      name,
      {
        ...feed,
        ...(feed.capabilities?.subscribe
          ? {
            capabilities: {
              subscribe: sortedUnique(feed.capabilities.subscribe),
            },
          }
          : {}),
      } satisfies ContractFeed,
    ]),
  );
}

function mapValues<TInput, TOutput>(
  values: Record<string, TInput> | undefined,
  map: (value: TInput) => TOutput,
): Record<string, TOutput> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, map(value)]),
  );
}

function schemaRef(ref: ContractSchemaRef): ContractSchemaRef {
  return { schema: ref.schema };
}

function capabilityMetadata(
  metadata: ContractCapabilityMetadata,
): ContractCapabilityMetadata {
  return {
    displayName: metadata.displayName,
    description: metadata.description,
    ...(metadata.consequence ? { consequence: metadata.consequence } : {}),
  };
}

function useRpc(use: ContractUsesRpc | undefined): ContractUsesRpc | undefined {
  if (!use) return undefined;
  return {
    ...(use.call ? { call: [...use.call] } : {}),
  };
}

function usePubSub(
  use: ContractUsesPubSub | undefined,
): ContractUsesPubSub | undefined {
  if (!use) return undefined;
  return {
    ...(use.publish ? { publish: [...use.publish] } : {}),
    ...(use.subscribe ? { subscribe: [...use.subscribe] } : {}),
  };
}

function contractUse(use: ContractUse): ContractUse {
  return {
    contract: use.contract,
    ...(use.rpc ? { rpc: useRpc(use.rpc) } : {}),
    ...(use.operations ? { operations: useRpc(use.operations) } : {}),
    ...(use.events ? { events: usePubSub(use.events) } : {}),
    ...(use.feeds
      ? {
        feeds: {
          ...(use.feeds.subscribe
            ? { subscribe: [...use.feeds.subscribe] }
            : {}),
        },
      }
      : {}),
  };
}

function contractUses(
  uses: ContractUses | undefined,
): ContractUses | undefined {
  if (!uses) return undefined;
  return {
    ...(uses.required
      ? { required: mapValues(uses.required, contractUse) }
      : {}),
    ...(uses.optional
      ? { optional: mapValues(uses.optional, contractUse) }
      : {}),
  };
}

function stateStore(store: ContractStateStore): ContractStateStore {
  return {
    kind: store.kind,
    schema: schemaRef(store.schema),
    ...(store.stateVersion ? { stateVersion: store.stateVersion } : {}),
    ...(store.acceptedVersions
      ? { acceptedVersions: mapValues(store.acceptedVersions, schemaRef) }
      : {}),
  };
}

function rpcMethod(method: ContractRpcMethod): ContractRpcMethod {
  return {
    version: method.version,
    subject: method.subject,
    input: schemaRef(method.input),
    output: schemaRef(method.output),
    ...(method.transfer
      ? { transfer: { direction: method.transfer.direction } }
      : {}),
    ...(method.capabilities?.call
      ? { capabilities: { call: [...method.capabilities.call] } }
      : {}),
    ...(method.errors
      ? { errors: method.errors.map((error) => ({ type: error.type })) }
      : {}),
  };
}

function operation(operation: ContractOperation): ContractOperation {
  return {
    version: operation.version,
    subject: operation.subject,
    input: schemaRef(operation.input),
    ...(operation.progress ? { progress: schemaRef(operation.progress) } : {}),
    output: schemaRef(operation.output),
    ...(operation.transfer
      ? {
        transfer: {
          direction: operation.transfer.direction,
          store: operation.transfer.store,
          key: operation.transfer.key,
          ...(operation.transfer.contentType
            ? { contentType: operation.transfer.contentType }
            : {}),
          ...(operation.transfer.metadata
            ? { metadata: operation.transfer.metadata }
            : {}),
          ...(operation.transfer.expiresInMs !== undefined
            ? { expiresInMs: operation.transfer.expiresInMs }
            : {}),
          ...(operation.transfer.maxBytes !== undefined
            ? { maxBytes: operation.transfer.maxBytes }
            : {}),
        },
      }
      : {}),
    ...(operation.capabilities
      ? {
        capabilities: {
          ...(operation.capabilities.call
            ? { call: [...operation.capabilities.call] }
            : {}),
          ...(operation.capabilities.read
            ? { read: [...operation.capabilities.read] }
            : {}),
          ...(operation.capabilities.cancel
            ? { cancel: [...operation.capabilities.cancel] }
            : {}),
          ...(operation.capabilities.control
            ? { control: [...operation.capabilities.control] }
            : {}),
        },
      }
      : {}),
    ...(operation.signals
      ? {
        signals: mapValues(
          operation.signals,
          (signal) => ({ input: schemaRef(signal.input) }),
        ),
      }
      : {}),
    ...(operation.cancel !== undefined ? { cancel: operation.cancel } : {}),
  };
}

function event(event: ContractEvent): ContractEvent {
  return {
    version: event.version,
    subject: event.subject,
    ...(event.params ? { params: [...event.params] } : {}),
    event: schemaRef(event.event),
    ...(event.capabilities
      ? {
        capabilities: {
          ...(event.capabilities.publish
            ? { publish: [...event.capabilities.publish] }
            : {}),
          ...(event.capabilities.subscribe
            ? { subscribe: [...event.capabilities.subscribe] }
            : {}),
        },
      }
      : {}),
  };
}

function feed(feed: ContractFeed): ContractFeed {
  return {
    version: feed.version,
    subject: feed.subject,
    input: schemaRef(feed.input),
    event: schemaRef(feed.event),
    ...(feed.capabilities?.subscribe
      ? { capabilities: { subscribe: [...feed.capabilities.subscribe] } }
      : {}),
  };
}

function errorDecl(error: ContractErrorDecl): ContractErrorDecl {
  return {
    type: error.type,
    ...(error.schema ? { schema: schemaRef(error.schema) } : {}),
  };
}

function jobQueue(queue: ContractJobQueue): ContractJobQueue {
  return {
    payload: schemaRef(queue.payload),
    ...(queue.result ? { result: schemaRef(queue.result) } : {}),
    ...(queue.maxDeliver !== undefined ? { maxDeliver: queue.maxDeliver } : {}),
    ...(queue.backoffMs ? { backoffMs: [...queue.backoffMs] } : {}),
    ...(queue.ackWaitMs !== undefined ? { ackWaitMs: queue.ackWaitMs } : {}),
    ...(queue.defaultDeadlineMs !== undefined
      ? { defaultDeadlineMs: queue.defaultDeadlineMs }
      : {}),
    ...(queue.progress !== undefined ? { progress: queue.progress } : {}),
    ...(queue.logs !== undefined ? { logs: queue.logs } : {}),
    ...(queue.dlq !== undefined ? { dlq: queue.dlq } : {}),
    ...(queue.concurrency !== undefined
      ? { concurrency: queue.concurrency }
      : {}),
  };
}

function kvResource(resource: ContractKvResource): ContractKvResource {
  return {
    purpose: resource.purpose,
    schema: schemaRef(resource.schema),
    ...(resource.required !== undefined ? { required: resource.required } : {}),
    ...(resource.history !== undefined ? { history: resource.history } : {}),
    ...(resource.ttlMs !== undefined ? { ttlMs: resource.ttlMs } : {}),
    ...(resource.maxValueBytes !== undefined
      ? { maxValueBytes: resource.maxValueBytes }
      : {}),
  };
}

function storeResource(resource: ContractStoreResource): ContractStoreResource {
  return {
    purpose: resource.purpose,
    ...(resource.required !== undefined ? { required: resource.required } : {}),
    ...(resource.ttlMs !== undefined ? { ttlMs: resource.ttlMs } : {}),
    ...(resource.maxObjectBytes !== undefined
      ? { maxObjectBytes: resource.maxObjectBytes }
      : {}),
    ...(resource.maxTotalBytes !== undefined
      ? { maxTotalBytes: resource.maxTotalBytes }
      : {}),
  };
}

/**
 * Return the canonical manifest shape used by Trellis runtimes before
 * validation, persistence, and digesting.
 *
 * This is not the digest projection: human-facing fields such as
 * `displayName` and `description` are preserved here even though they are not
 * part of contract identity. Unknown extension fields are intentionally omitted
 * until the runtime explicitly supports them.
 */
export function normalizeContractManifest(
  contract: TrellisContractV1,
): TrellisContractV1 {
  return {
    format: contract.format,
    id: contract.id,
    displayName: contract.displayName,
    description: contract.description,
    kind: contract.kind,
    ...(contract.capabilities
      ? { capabilities: mapValues(contract.capabilities, capabilityMetadata) }
      : {}),
    ...(contract.schemas ? { schemas: contract.schemas } : {}),
    ...(contract.exports
      ? {
        exports: {
          ...(contract.exports.schemas
            ? { schemas: [...contract.exports.schemas] }
            : {}),
        },
      }
      : {}),
    ...(contract.uses ? { uses: contractUses(contract.uses) } : {}),
    ...(contract.state ? { state: mapValues(contract.state, stateStore) } : {}),
    ...(contract.rpc ? { rpc: mapValues(contract.rpc, rpcMethod) } : {}),
    ...(contract.operations
      ? { operations: mapValues(contract.operations, operation) }
      : {}),
    ...(contract.events ? { events: mapValues(contract.events, event) } : {}),
    ...(contract.feeds ? { feeds: mapValues(contract.feeds, feed) } : {}),
    ...(contract.jobs ? { jobs: mapValues(contract.jobs, jobQueue) } : {}),
    ...(contract.resources
      ? {
        resources: {
          ...(contract.resources.kv
            ? { kv: mapValues(contract.resources.kv, kvResource) }
            : {}),
          ...(contract.resources.store
            ? { store: mapValues(contract.resources.store, storeResource) }
            : {}),
        },
      }
      : {}),
    ...(contract.errors
      ? { errors: mapValues(contract.errors, errorDecl) }
      : {}),
  };
}

/**
 * Parse untrusted contract JSON into the current Trellis v1 manifest shape.
 *
 * Unknown extension fields are accepted for forward compatibility but are not
 * returned. Callers must use the returned value for persistence and digesting.
 */
export function parseContractManifest(value: unknown): TrellisContractV1 {
  try {
    return normalizeContractManifest(
      Value.Parse(TrellisContractV1Schema, value) as TrellisContractV1,
    );
  } catch (error) {
    const details = [...Value.Errors(TrellisContractV1Schema, value)].map((
      entry,
    ) => `${entry.instancePath || "#"}: ${entry.message}`);
    throw new TypeError(
      `Invalid contract${details.length > 0 ? `:\n${details.join("\n")}` : ""}`,
      { cause: error },
    );
  }
}

/**
 * Build the normalized runtime/interface projection used for contract identity.
 */
export function projectContractDigestManifest(
  contract: TrellisContractV1,
): JsonValue {
  const schemas = projectReachableSchemas(contract);
  const errors = projectRpcDeclaredErrors(contract);
  const resources = projectDigestResources(contract.resources);
  const uses = projectDigestUses(contract.uses);
  const rpc = projectDigestRpc(contract.rpc);
  const operations = projectDigestOperations(contract.operations);
  const events = projectDigestEvents(contract.events);
  const feeds = projectDigestFeeds(contract.feeds);

  return {
    format: contract.format,
    id: contract.id,
    kind: contract.kind,
    ...(contract.capabilities ? { capabilities: contract.capabilities } : {}),
    ...(schemas ? { schemas } : {}),
    ...(contract.state ? { state: contract.state } : {}),
    ...(uses ? { uses } : {}),
    ...(rpc ? { rpc } : {}),
    ...(operations ? { operations } : {}),
    ...(events ? { events } : {}),
    ...(feeds ? { feeds } : {}),
    ...(errors ? { errors } : {}),
    ...(contract.jobs ? { jobs: contract.jobs } : {}),
    ...(resources ? { resources } : {}),
  };
}

/** Compute the v1 contract digest from the normalized digest projection. */
export function digestContractManifest(contract: TrellisContractV1): string {
  return digestCanonicalJson(
    projectContractDigestManifest(normalizeContractManifest(contract)),
  );
}

function rpcSubject(name: string, version: `v${number}`): string {
  return `rpc.${version}.${name}`;
}

function operationSubject(name: string, version: `v${number}`): string {
  return `operations.${version}.${name}`;
}

function feedSubject(name: string, version: `v${number}`): string {
  return `feeds.${version}.${name}`;
}

function eventSubject(
  name: string,
  version: `v${number}`,
  params: readonly SubjectParam[] | undefined,
): string {
  const suffix = params && params.length > 0
    ? `.${params.map((pointer) => `{${pointer}}`).join(".")}`
    : "";
  return `events.${version}.${name}${suffix}`;
}

function emitResources(
  resources: ContractSourceResources | undefined,
): ContractResources | undefined {
  if (!resources?.kv && !resources?.store) {
    return undefined;
  }

  return {
    ...(resources.kv
      ? {
        kv: Object.fromEntries(
          Object.entries(resources.kv).map(([alias, resource]) => [
            alias,
            {
              purpose: resource.purpose,
              schema: { ...resource.schema },
              required: resource.required ?? true,
              history: resource.history ?? 1,
              ttlMs: resource.ttlMs ?? 0,
              ...(resource.maxValueBytes
                ? { maxValueBytes: resource.maxValueBytes }
                : {}),
            } satisfies ContractKvResource,
          ]),
        ),
      }
      : {}),
    ...(resources.store
      ? {
        store: Object.fromEntries(
          Object.entries(resources.store).map(([alias, resource]) => [
            alias,
            {
              purpose: resource.purpose,
              required: resource.required ?? true,
              ttlMs: resource.ttlMs ?? 0,
              ...(resource.maxObjectBytes !== undefined
                ? { maxObjectBytes: resource.maxObjectBytes }
                : {}),
              ...(resource.maxTotalBytes !== undefined
                ? { maxTotalBytes: resource.maxTotalBytes }
                : {}),
            } satisfies ContractStoreResource,
          ]),
        ),
      }
      : {}),
  };
}

function emitJobs(
  jobs: ContractSourceJobs | undefined,
): ContractJobs | undefined {
  if (!jobs) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(jobs).map(([queueType, queue]) => [
      queueType,
      {
        payload: { ...queue.payload },
        ...(queue.result ? { result: { ...queue.result } } : {}),
        ...(queue.maxDeliver !== undefined
          ? { maxDeliver: queue.maxDeliver }
          : {}),
        ...(queue.backoffMs ? { backoffMs: [...queue.backoffMs] } : {}),
        ...(queue.ackWaitMs !== undefined
          ? { ackWaitMs: queue.ackWaitMs }
          : {}),
        ...(queue.defaultDeadlineMs !== undefined
          ? { defaultDeadlineMs: queue.defaultDeadlineMs }
          : {}),
        ...(queue.progress !== undefined ? { progress: queue.progress } : {}),
        ...(queue.logs !== undefined ? { logs: queue.logs } : {}),
        ...(queue.dlq !== undefined ? { dlq: queue.dlq } : {}),
        ...(queue.concurrency !== undefined
          ? { concurrency: queue.concurrency }
          : {}),
      } satisfies ContractJobQueue,
    ]),
  );
}

function buildContractJobsMetadata(
  jobs: ContractSourceJobs | undefined,
): ContractJobsMetadata {
  if (!jobs) {
    return {};
  }

  return Object.fromEntries(
    Object.keys(jobs).map((queueType) => [queueType, {
      payload: undefined,
      result: undefined,
    }]),
  ) as ContractJobsMetadata;
}

function buildContractKvMetadata(
  resources: ContractSourceResources | undefined,
  schemas: ContractSourceSchemas | undefined,
): ContractKvMetadata {
  const kv = resources?.kv;
  if (!kv) {
    return {};
  }

  const metadata: ContractKvMetadata = {};
  for (const [alias, resource] of Object.entries(kv)) {
    assertSchemaRefExists(schemas, resource.schema, `kv resource '${alias}'`);
    const schema = schemas?.[resource.schema.schema];
    if (!schema) {
      throw new Error(
        `kv resource '${alias}' references missing schema '${resource.schema.schema}'`,
      );
    }
    metadata[alias] = {
      required: resource.required ?? true,
      value: undefined,
      schema,
    };
  }
  return metadata;
}

function buildContractStateMetadata(
  state: ContractSourceState | undefined,
  schemas: ContractSourceSchemas | undefined,
): ContractStateMetadata {
  if (!state) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(state).map(([storeName, store]) => [storeName, {
      kind: store.kind,
      value: undefined,
      schema: resolveSchemaRef(
        schemas,
        store.schema,
        `state store '${storeName}'`,
      ),
      stateVersion: store.stateVersion ?? "v1",
      acceptedVersions: Object.fromEntries(
        Object.entries(store.acceptedVersions ?? {}).map((
          [version, schema],
        ) => [
          version,
          resolveSchemaRef(
            schemas,
            schema,
            `state store '${storeName}' accepted version '${version}'`,
          ),
        ]),
      ),
    }]),
  ) as ContractStateMetadata;
}

function emitState(
  state: ContractSourceState | undefined,
): ContractState | undefined {
  if (!state) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(state).map(([storeName, store]) => [
      storeName,
      {
        kind: store.kind,
        schema: { ...store.schema },
        ...(store.stateVersion === undefined
          ? {}
          : { stateVersion: store.stateVersion }),
        ...(store.acceptedVersions === undefined
          ? {}
          : { acceptedVersions: store.acceptedVersions }),
      } satisfies ContractStateStore,
    ]),
  );
}

function emitUsesFlat(
  uses: ContractSourceUsesFlat | undefined,
): ContractUsesFlat | undefined {
  if (!uses) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(uses).map(([alias, use]) => [
      alias,
      {
        contract: use.contract,
        ...(use.rpc?.call ? { rpc: { call: sortedUnique(use.rpc.call) } } : {}),
        ...(use.operations?.call
          ? { operations: { call: sortedUnique(use.operations.call) } }
          : {}),
        ...((use.events?.publish || use.events?.subscribe)
          ? {
            events: {
              ...(use.events.publish
                ? { publish: sortedUnique(use.events.publish) }
                : {}),
              ...(use.events.subscribe
                ? { subscribe: sortedUnique(use.events.subscribe) }
                : {}),
            },
          }
          : {}),
        ...(use.feeds?.subscribe
          ? { feeds: { subscribe: sortedUnique(use.feeds.subscribe) } }
          : {}),
      } satisfies ContractUse,
    ]),
  );
}

function emitUses(
  uses: ContractSourceUses | undefined,
): ContractUses | undefined {
  if (!uses) {
    return undefined;
  }

  const required = emitUsesFlat(uses.required);
  const optional = omitRequiredUseAliases(
    emitUsesFlat(uses.optional),
    required,
  );
  if (!required && !optional) {
    return undefined;
  }
  return {
    ...(required ? { required } : {}),
    ...(optional ? { optional } : {}),
  };
}

function emitContract(source: TrellisContractSource): TrellisContractV1 {
  const capabilities = emitCapabilities(source.id, source.capabilities);
  const rpc = source.rpc
    ? Object.fromEntries(
      Object.entries(source.rpc).map(([name, method]) => {
        const emitted: ContractRpcMethod = {
          version: method.version,
          subject: method.subject ?? rpcSubject(name, method.version),
          input: { ...method.input },
          output: { ...method.output },
        };
        if (method.capabilities?.call) {
          emitted.capabilities = {
            call: projectCapabilities(
              method.capabilities.call,
              source.id,
              source.capabilities,
              `rpc '${name}' call capabilities`,
            ) ?? [],
          };
        }
        if (method.transfer) {
          emitted.transfer = { ...method.transfer };
        }
        if (method.errors && method.errors.length > 0) {
          emitted.errors = sortedUnique(
            method.errors.map((errorName) =>
              source.errors?.[errorName]?.type ?? errorName
            ),
          ).map((type) => ({ type }));
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const operations = source.operations
    ? Object.fromEntries(
      Object.entries(source.operations).map(([name, operation]) => {
        if (operation.transfer) {
          const store = source.resources?.store?.[operation.transfer.store];
          if (!store) {
            throw new Error(
              `Operation '${name}' references unknown store resource '${operation.transfer.store}'`,
            );
          }

          const inputSchema = resolveSchemaRef(
            source.schemas,
            operation.input,
            `operation '${name}' input`,
          );
          for (
            const pointer of [
              operation.transfer.key,
              operation.transfer.contentType,
              operation.transfer.metadata,
            ]
          ) {
            if (!pointer) {
              continue;
            }
            if (getSubschemaAtDataPointer(inputSchema, pointer) === undefined) {
              throw new Error(
                `Invalid transfer pointer '${pointer}' for operation '${name}' (path not found in input schema)`,
              );
            }
          }
        }

        const emitted: ContractOperation = {
          version: operation.version,
          subject: operation.subject ??
            operationSubject(name, operation.version),
          input: { ...operation.input },
          output: { ...operation.output },
        };
        if (operation.progress) {
          emitted.progress = { ...operation.progress };
        }
        if (operation.transfer) {
          emitted.transfer = { ...operation.transfer, direction: "send" };
        }
        if (
          operation.capabilities?.call || operation.capabilities?.read ||
          operation.capabilities?.cancel || operation.capabilities?.control
        ) {
          emitted.capabilities = {
            ...(operation.capabilities.call
              ? {
                call: projectCapabilities(
                  operation.capabilities.call,
                  source.id,
                  source.capabilities,
                  `operation '${name}' call capabilities`,
                ) ?? [],
              }
              : {}),
            ...(operation.capabilities.read
              ? {
                read: projectCapabilities(
                  operation.capabilities.read,
                  source.id,
                  source.capabilities,
                  `operation '${name}' read capabilities`,
                ) ?? [],
              }
              : {}),
            ...(operation.capabilities.cancel
              ? {
                cancel: projectCapabilities(
                  operation.capabilities.cancel,
                  source.id,
                  source.capabilities,
                  `operation '${name}' cancel capabilities`,
                ) ?? [],
              }
              : {}),
            ...(operation.capabilities.control
              ? {
                control: projectCapabilities(
                  operation.capabilities.control,
                  source.id,
                  source.capabilities,
                  `operation '${name}' control capabilities`,
                ) ?? [],
              }
              : {}),
          };
        }
        if (operation.signals) {
          emitted.signals = Object.fromEntries(
            Object.entries(operation.signals).map(([signalName, signal]) => [
              signalName,
              { input: { ...signal.input } },
            ]),
          );
        }
        if (operation.cancel !== undefined) {
          emitted.cancel = operation.cancel;
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const events = source.events
    ? Object.fromEntries(
      Object.entries(source.events).map(([name, event]) => {
        if (event.params && event.params.length > 0) {
          assertDataPointersExistAndAreTokenable(
            name,
            resolveSchemaRef(source.schemas, event.event, `event '${name}'`),
            event.params,
          );
        }

        const emitted: ContractEvent = {
          version: event.version,
          subject: event.subject ??
            eventSubject(name, event.version, event.params),
          event: { ...event.event },
        };
        if (event.params && event.params.length > 0) {
          emitted.params = [...event.params];
        }
        if (event.capabilities?.publish || event.capabilities?.subscribe) {
          emitted.capabilities = {
            ...(event.capabilities.publish
              ? {
                publish: projectCapabilities(
                  event.capabilities.publish,
                  source.id,
                  source.capabilities,
                  `event '${name}' publish capabilities`,
                ) ?? [],
              }
              : {}),
            ...(event.capabilities.subscribe
              ? {
                subscribe: projectCapabilities(
                  event.capabilities.subscribe,
                  source.id,
                  source.capabilities,
                  `event '${name}' subscribe capabilities`,
                ) ?? [],
              }
              : {}),
          };
        }

        return [name, emitted];
      }),
    )
    : undefined;

  const feeds = source.feeds
    ? Object.fromEntries(
      Object.entries(source.feeds).map(([name, feed]) => {
        const emitted: ContractFeed = {
          version: feed.version,
          subject: feed.subject ?? feedSubject(name, feed.version),
          input: { ...feed.input },
          event: { ...feed.event },
        };
        if (feed.capabilities?.subscribe) {
          emitted.capabilities = {
            subscribe: projectCapabilities(
              feed.capabilities.subscribe,
              source.id,
              source.capabilities,
              `feed '${name}' subscribe capabilities`,
            ) ?? [],
          };
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const errors = source.errors
    ? Object.fromEntries(
      Object.entries(source.errors).map(([name, error]) => {
        const emitted: ContractErrorDecl = { type: error.type };
        const schemaRef = resolveErrorSchemaRef(source.schemas, name, error);
        if (schemaRef) {
          emitted.schema = { ...schemaRef };
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const jobs = emitJobs(source.jobs);
  const state = emitState(source.state);
  const resources = emitResources(source.resources);
  const uses = emitUses(source.uses);

  return {
    format: CONTRACT_FORMAT_V1,
    id: source.id,
    displayName: source.displayName,
    description: source.description,
    kind: source.kind,
    ...(capabilities ? { capabilities } : {}),
    ...(source.schemas ? { schemas: cloneSchemas(source.schemas) } : {}),
    ...(source.exports
      ? { exports: cloneContractExports(source.exports) }
      : {}),
    ...(state ? { state } : {}),
    ...(uses ? { uses } : {}),
    ...(rpc ? { rpc } : {}),
    ...(operations ? { operations } : {}),
    ...(events ? { events } : {}),
    ...(feeds ? { feeds } : {}),
    ...(errors ? { errors } : {}),
    ...(jobs ? { jobs } : {}),
    ...(resources ? { resources } : {}),
  };
}

function buildOwnedApi(source: TrellisContractSource): ApiShape {
  const localRuntimeErrors: Record<string, BuiltRuntimeErrorDesc> = {};
  for (const [name, errorDecl] of Object.entries(source.errors ?? {})) {
    const errorClass = getContractErrorRuntimeClass(errorDecl);
    if (!errorClass) {
      continue;
    }

    const errorSchemaRef = resolveErrorSchemaRef(
      source.schemas,
      name,
      errorDecl,
    );
    localRuntimeErrors[name] = {
      type: errorDecl.type,
      ...(errorSchemaRef
        ? {
          schema: schema(
            resolveSchemaRef(
              source.schemas,
              errorSchemaRef,
              `error '${name}' schema`,
            ),
          ),
        }
        : {}),
      fromSerializable(data: SerializableErrorData) {
        if (!isSerializableErrorData(data)) {
          throw new Error(
            `Transport error '${errorDecl.type}' is missing base error fields`,
          );
        }
        return errorClass.fromSerializable(data);
      },
    };
  }

  const rpc: Record<string, BuiltRpcDesc> = {};
  for (const [name, method] of Object.entries(source.rpc ?? {})) {
    rpc[name] = {
      subject: method.subject ?? rpcSubject(name, method.version),
      input: schema(
        resolveSchemaRef(source.schemas, method.input, `rpc '${name}' input`),
      ),
      output: schema(
        resolveSchemaRef(
          source.schemas,
          method.output,
          `rpc '${name}' output`,
        ),
      ),
      callerCapabilities: projectCapabilities(
        method.capabilities?.call,
        source.id,
        source.capabilities,
        `rpc '${name}' call capabilities`,
      ) ?? [],
      transfer: method.transfer ? { ...method.transfer } : undefined,
      authRequired: method.authRequired ?? true,
      errors: method.errors,
      declaredErrorTypes: method.errors?.map((errorName) =>
        source.errors?.[errorName]?.type ?? errorName
      ),
      runtimeErrors: method.errors?.flatMap((errorName) => {
        const runtimeError = localRuntimeErrors[errorName];
        return runtimeError ? [runtimeError] : [];
      }),
    };
  }

  const operations = Object.fromEntries(
    Object.entries(source.operations ?? {}).map(([name, operation]) => [
      name,
      {
        subject: operation.subject ?? operationSubject(name, operation.version),
        input: schema(
          resolveSchemaRef(
            source.schemas,
            operation.input,
            `operation '${name}' input`,
          ),
        ),
        progress: operation.progress
          ? schema(
            resolveSchemaRef(
              source.schemas,
              operation.progress,
              `operation '${name}' progress`,
            ),
          )
          : undefined,
        output: operation.output
          ? schema(
            resolveSchemaRef(
              source.schemas,
              operation.output,
              `operation '${name}' output`,
            ),
          )
          : undefined,
        transfer: operation.transfer
          ? { ...operation.transfer, direction: "send" }
          : undefined,
        signals: operation.signals
          ? Object.fromEntries(
            Object.entries(operation.signals).map(([signalName, signal]) => [
              signalName,
              {
                input: schema(
                  resolveSchemaRef(
                    source.schemas,
                    signal.input,
                    `operation '${name}' signal '${signalName}' input`,
                  ),
                ),
              },
            ]),
          )
          : undefined,
        callerCapabilities: projectCapabilities(
          operation.capabilities?.call,
          source.id,
          source.capabilities,
          `operation '${name}' call capabilities`,
        ) ?? [],
        readCapabilities: projectCapabilities(
          operation.capabilities?.read,
          source.id,
          source.capabilities,
          `operation '${name}' read capabilities`,
        ) ?? [],
        cancelCapabilities: projectCapabilities(
          operation.capabilities?.cancel,
          source.id,
          source.capabilities,
          `operation '${name}' cancel capabilities`,
        ) ?? [],
        controlCapabilities: projectCapabilities(
          operation.capabilities?.control,
          source.id,
          source.capabilities,
          `operation '${name}' control capabilities`,
        ) ?? [],
        cancel: operation.cancel,
      },
    ]),
  ) as Record<string, OperationDesc>;

  const events = Object.fromEntries(
    Object.entries(source.events ?? {}).map(([name, event]) => {
      if (event.params && event.params.length > 0) {
        assertDataPointersExistAndAreTokenable(
          name,
          resolveSchemaRef(source.schemas, event.event, `event '${name}'`),
          event.params,
        );
      }

      return [
        name,
        {
          subject: event.subject ??
            eventSubject(name, event.version, event.params),
          params: event.params,
          event: schema(
            resolveSchemaRef(source.schemas, event.event, `event '${name}'`),
          ),
          publishCapabilities: projectCapabilities(
            event.capabilities?.publish,
            source.id,
            source.capabilities,
            `event '${name}' publish capabilities`,
          ) ?? [],
          subscribeCapabilities: projectCapabilities(
            event.capabilities?.subscribe,
            source.id,
            source.capabilities,
            `event '${name}' subscribe capabilities`,
          ) ?? [],
        },
      ];
    }),
  ) as Record<string, EventDesc>;

  const feeds = Object.fromEntries(
    Object.entries(source.feeds ?? {}).map(([name, feed]) => [
      name,
      {
        subject: feed.subject ?? feedSubject(name, feed.version),
        input: schema(
          resolveSchemaRef(source.schemas, feed.input, `feed '${name}' input`),
        ),
        event: schema(
          resolveSchemaRef(source.schemas, feed.event, `feed '${name}' event`),
        ),
        subscribeCapabilities: projectCapabilities(
          feed.capabilities?.subscribe,
          source.id,
          source.capabilities,
          `feed '${name}' subscribe capabilities`,
        ) ?? [],
      },
    ]),
  ) as Record<string, FeedDesc>;

  return { rpc, operations, events, feeds, subjects: {} } as ApiShape;
}

function mergeRecord(
  kind: "rpc" | "operations" | "events" | "feeds" | "subjects",
  out: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(next)) {
    if (Object.hasOwn(out, key)) {
      throw new Error(
        `Duplicate ${kind} key '${key}' while deriving contract API`,
      );
    }
    out[key] = value;
  }
}

function assertSelectedKeysExist(
  contractId: string,
  kind: "rpc" | "operations" | "events" | "feeds" | "subjects",
  keys: readonly string[] | undefined,
  api: Record<string, unknown>,
) {
  if (!keys) {
    return;
  }

  for (const key of keys) {
    if (!Object.hasOwn(api, key)) {
      throw new Error(
        `Contract '${contractId}' does not expose ${kind} key '${key}'`,
      );
    }
  }
}

function assertValidUseSpec<TApi extends TrellisApiLike>(
  contractId: string,
  spec: UseSpec<TApi>,
  api: TApi,
) {
  assertSelectedKeysExist(contractId, "rpc", spec.rpc?.call, api.rpc);
  assertSelectedKeysExist(
    contractId,
    "operations",
    spec.operations?.call,
    api.operations,
  );
  assertSelectedKeysExist(
    contractId,
    "events",
    spec.events?.publish,
    api.events,
  );
  assertSelectedKeysExist(
    contractId,
    "events",
    spec.events?.subscribe,
    api.events,
  );
  assertSelectedKeysExist(
    contractId,
    "feeds",
    spec.feeds?.subscribe,
    api.feeds ?? {},
  );
}

function attachContractModuleMetadata<
  TValue extends object,
  TContractModule,
>(
  value: TValue,
  contractModule: TContractModule,
): TValue & ContractModuleMarker<TContractModule> {
  Object.defineProperty(value, CONTRACT_MODULE_METADATA, {
    value: contractModule,
    enumerable: false,
  });
  return value as TValue & ContractModuleMarker<TContractModule>;
}

function attachContractErrorRuntimeMetadata<
  TValue extends object,
  TClass extends RpcErrorClass,
>(
  value: TValue,
  errorClass: TClass,
): TValue & ContractErrorRuntimeMarker<TClass> {
  Object.defineProperty(value, CONTRACT_ERROR_RUNTIME_METADATA, {
    value: errorClass,
    enumerable: false,
  });
  return value as TValue & ContractErrorRuntimeMarker<TClass>;
}

function getContractErrorRuntimeClass(
  errorDecl: ContractSourceErrorDecl,
): ErrorClass | undefined {
  const value = Object.getOwnPropertyDescriptor(
    errorDecl,
    CONTRACT_ERROR_RUNTIME_METADATA,
  )?.value;
  if (isErrorClass(value)) {
    return value;
  }
  return undefined;
}

function resolveErrorSchemaRef(
  schemas: ContractSourceSchemas | undefined,
  errorName: string,
  errorDecl: ContractSourceErrorDecl,
): ContractSchemaRef | undefined {
  if (errorDecl.schema) {
    return errorDecl.schema;
  }

  const runtimeSchema = getErrorRuntimeSchema(errorDecl);
  if (!runtimeSchema) {
    return undefined;
  }

  const schemaName = findMatchingSchemaName(schemas, runtimeSchema);
  if (schemaName) {
    return { schema: schemaName };
  }

  throw new Error(
    `error '${errorName}' schema must be declared in contract.schemas`,
  );
}

/**
 * Define a transportable Trellis error class from a payload-object schema.
 *
 * The returned value is a real runtime error class that carries the wire schema
 * and reconstruction logic needed by `defineServiceContract(...)`.
 */
export function defineError<
  const TType extends string,
  const TFields extends TProperties,
>(
  options: DefineErrorOptions<TType, TFields>,
): DefinedErrorClass<TType, TFields> {
  assertNoReservedDefinedErrorFieldNames(options.fields);

  const errorSchema = createDefinedErrorSchema(options.type, options.fields);
  const fieldNames = definedErrorPayloadFieldNames(options.fields);

  type TPayload = DefinedErrorPayload<TFields>;
  type TData = DefinedErrorData<TType, TFields>;
  type TInit = DefinedErrorInit<TFields>;

  class DefinedErrorImpl extends TrellisError<SerializableErrorData>
    implements DefinedErrorPayloadCarrier<TPayload> {
    static readonly type = options.type;
    static readonly schema = errorSchema;
    override readonly name = options.type;
    [DEFINED_ERROR_PAYLOAD]: Readonly<TPayload>;

    constructor(payload: TInit) {
      const customPayload = pickDefinedErrorPayload(fieldNames, payload);
      const message = typeof options.message === "function"
        ? options.message(customPayload)
        : options.message;
      super(message, definedErrorBaseOptions(payload));
      this[DEFINED_ERROR_PAYLOAD] = customPayload;
      Object.assign(this, customPayload);
    }

    static fromSerializable(data: TData): DefinedErrorInstance<TType, TFields> {
      const customPayload = pickDefinedErrorPayload(fieldNames, data);
      const ErrorCtor = DefinedErrorImpl as new (
        payload: object,
      ) =>
        & TrellisError<SerializableErrorData>
        & DefinedErrorPayloadCarrier<Record<string, unknown>>;
      const error = new ErrorCtor({
        ...customPayload,
        id: data.id,
        context: data.context,
        traceId: data.traceId,
      });
      error[DEFINED_ERROR_PAYLOAD] = customPayload;
      return Object.assign(error, customPayload) as DefinedErrorInstance<
        TType,
        TFields
      >;
    }

    override toSerializable(): SerializableErrorData {
      return {
        ...this.baseSerializable(),
        type: this.name,
        ...this[DEFINED_ERROR_PAYLOAD],
      };
    }
  }

  // @ts-expect-error TypeScript cannot model the dynamically assigned payload
  // fields on the generated class instance constructor return type.
  return DefinedErrorImpl;
}

function createUseHelper<
  TContractId extends string,
  TOwnedApi extends TrellisApiLike,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
>(
  getContractModule: () => ContractModule<
    TContractId,
    TOwnedApi,
    TUsedApi,
    TTrellisApi
  >,
) {
  return ((spec) => {
    const contractModule = getContractModule();
    assertValidUseSpec(
      contractModule.CONTRACT_ID,
      spec,
      contractModule.API.owned,
    );

    const dependencyUse = {
      contract: contractModule.CONTRACT_ID,
      ...(spec.rpc?.call ? { rpc: { call: [...spec.rpc.call] } } : {}),
      ...(spec.operations?.call
        ? { operations: { call: [...spec.operations.call] } }
        : {}),
      ...((spec.events?.publish || spec.events?.subscribe)
        ? {
          events: {
            ...(spec.events.publish
              ? { publish: [...spec.events.publish] }
              : {}),
            ...(spec.events.subscribe
              ? { subscribe: [...spec.events.subscribe] }
              : {}),
          },
        }
        : {}),
      ...(spec.feeds?.subscribe
        ? { feeds: { subscribe: [...spec.feeds.subscribe] } }
        : {}),
    };

    return attachContractModuleMetadata(
      dependencyUse,
      contractModule,
    );
  }) as ContractUseFn<TContractId, TOwnedApi>;
}

function getContractModuleFromUse(
  alias: string,
  useValue: ContractSourceUse | AuthorContractDependencyUse,
): ContractModule<string, TrellisApiLike, TrellisApiLike, TrellisApiLike> {
  const contractModule = Object.getOwnPropertyDescriptor(
    useValue,
    CONTRACT_MODULE_METADATA,
  )?.value as
    | ContractModule<
      string,
      TrellisApiLike,
      TrellisApiLike,
      TrellisApiLike
    >
    | undefined;
  if (!contractModule) {
    throw new Error(
      `Contract use '${alias}' must be created with contractModule.use(...) from @qlever-llc/trellis/contracts`,
    );
  }
  return contractModule;
}

function normalizeUseEntries(
  uses: AuthorContractUsesFlat | undefined,
): {
  manifestUses: Record<string, ContractSourceUse> | undefined;
  usedApi: TrellisApiLike;
} {
  if (!uses) {
    return {
      manifestUses: undefined,
      usedApi: { rpc: {}, operations: {}, events: {}, feeds: {}, subjects: {} },
    };
  }

  const manifestUses: Record<string, ContractSourceUse> = {};
  const usedApi: TrellisApiLike = {
    rpc: {},
    operations: {},
    events: {},
    feeds: {},
    subjects: {},
  };

  for (const [alias, useValue] of Object.entries(uses)) {
    const contractModule = getContractModuleFromUse(alias, useValue);
    const rpcCall = useValue.rpc?.call as readonly string[] | undefined;
    const operationsCall = useValue.operations?.call as
      | readonly string[]
      | undefined;
    const eventsPublish = useValue.events?.publish as
      | readonly string[]
      | undefined;
    const eventsSubscribe = useValue.events?.subscribe as
      | readonly string[]
      | undefined;
    const feedsSubscribe = useValue.feeds?.subscribe as
      | readonly string[]
      | undefined;
    if (useValue.contract !== contractModule.CONTRACT_ID) {
      throw new Error(
        `Contract use '${alias}' references '${useValue.contract}' but module id is '${contractModule.CONTRACT_ID}'`,
      );
    }

    assertValidUseSpec(
      contractModule.CONTRACT_ID,
      {
        ...(rpcCall ? { rpc: { call: rpcCall } } : {}),
        ...(operationsCall ? { operations: { call: operationsCall } } : {}),
        ...((eventsPublish || eventsSubscribe)
          ? {
            events: {
              ...(eventsPublish ? { publish: eventsPublish } : {}),
              ...(eventsSubscribe ? { subscribe: eventsSubscribe } : {}),
            },
          }
          : {}),
        ...(feedsSubscribe ? { feeds: { subscribe: feedsSubscribe } } : {}),
      },
      contractModule.API.owned,
    );

    manifestUses[alias] = {
      contract: contractModule.CONTRACT_ID,
      ...(rpcCall ? { rpc: { call: [...rpcCall] } } : {}),
      ...(operationsCall ? { operations: { call: [...operationsCall] } } : {}),
      ...((eventsPublish || eventsSubscribe)
        ? {
          events: {
            ...(eventsPublish ? { publish: [...eventsPublish] } : {}),
            ...(eventsSubscribe ? { subscribe: [...eventsSubscribe] } : {}),
          },
        }
        : {}),
      ...(feedsSubscribe ? { feeds: { subscribe: [...feedsSubscribe] } } : {}),
    };

    const rpcKeys = selectedKeys(
      rpcCall,
    );
    if (rpcKeys.length > 0) {
      mergeRecord(
        "rpc",
        usedApi.rpc,
        Object.fromEntries(
          rpcKeys.map((key) => [key, contractModule.API.owned.rpc[key]]),
        ),
      );
    }

    const operationKeys = selectedKeys(
      operationsCall,
    );
    if (operationKeys.length > 0) {
      mergeRecord(
        "operations",
        usedApi.operations,
        Object.fromEntries(
          operationKeys.map((
            key,
          ) => [key, contractModule.API.owned.operations[key]]),
        ),
      );
    }

    const eventKeys = new Set([
      ...selectedKeys(eventsPublish),
      ...selectedKeys(eventsSubscribe),
    ]);
    if (eventKeys.size > 0) {
      mergeRecord(
        "events",
        usedApi.events,
        Object.fromEntries(
          [...eventKeys].map((
            key,
          ) => [key, contractModule.API.owned.events[key]]),
        ),
      );
    }

    const feedKeys = selectedKeys(feedsSubscribe);
    if (feedKeys.length > 0) {
      mergeRecord(
        "feeds",
        usedApi.feeds ?? {},
        Object.fromEntries(
          feedKeys.map((key) => [key, contractModule.API.owned.feeds?.[key]]),
        ),
      );
    }
  }

  return { manifestUses, usedApi };
}

function normalizeUses(
  uses: AuthorContractUses | undefined,
): {
  manifestUses: ContractSourceUses | undefined;
  usedApi: TrellisApiLike;
} {
  if (!uses) {
    return {
      manifestUses: undefined,
      usedApi: emptyApi(),
    };
  }

  const required = normalizeUseEntries(uses.required);
  const optional = normalizeUseEntries(
    omitRequiredUseAliases(uses.optional, uses.required),
  );
  const usedApi = emptyApi();
  mergeUseIntoApi(usedApi, required.usedApi);
  mergeUseIntoApi(usedApi, optional.usedApi);

  return {
    manifestUses: {
      ...(required.manifestUses ? { required: required.manifestUses } : {}),
      ...(optional.manifestUses ? { optional: optional.manifestUses } : {}),
    },
    usedApi,
  };
}

type NormalizedUse = {
  manifestUse: ContractSourceUse;
  api: TrellisApiLike;
};

function emptyApi(): TrellisApiLike {
  return { rpc: {}, operations: {}, events: {}, feeds: {}, subjects: {} };
}

function addUniqueStrings(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function mergeUseIntoManifest(
  manifestUses: Record<string, ContractSourceUse>,
  alias: string,
  use: ContractSourceUse,
): void {
  const existing = manifestUses[alias];
  if (!existing) {
    manifestUses[alias] = use;
    return;
  }

  if (existing.contract !== use.contract) {
    throw new Error(
      `Contract use '${alias}' references both '${existing.contract}' and '${use.contract}'`,
    );
  }

  const rpcCall = [...(existing.rpc?.call ?? [])];
  addUniqueStrings(rpcCall, use.rpc?.call ?? []);
  const operationsCall = [...(existing.operations?.call ?? [])];
  addUniqueStrings(operationsCall, use.operations?.call ?? []);
  const eventsPublish = [...(existing.events?.publish ?? [])];
  addUniqueStrings(eventsPublish, use.events?.publish ?? []);
  const eventsSubscribe = [...(existing.events?.subscribe ?? [])];
  addUniqueStrings(eventsSubscribe, use.events?.subscribe ?? []);
  const feedsSubscribe = [...(existing.feeds?.subscribe ?? [])];
  addUniqueStrings(feedsSubscribe, use.feeds?.subscribe ?? []);
  manifestUses[alias] = {
    contract: existing.contract,
    ...(rpcCall.length > 0 ? { rpc: { call: rpcCall } } : {}),
    ...(operationsCall.length > 0
      ? { operations: { call: operationsCall } }
      : {}),
    ...((eventsPublish.length > 0 || eventsSubscribe.length > 0)
      ? {
        events: {
          ...(eventsPublish.length > 0 ? { publish: eventsPublish } : {}),
          ...(eventsSubscribe.length > 0 ? { subscribe: eventsSubscribe } : {}),
        },
      }
      : {}),
    ...(feedsSubscribe.length > 0
      ? { feeds: { subscribe: feedsSubscribe } }
      : {}),
  };
}

function mergeApiAllowDuplicateSubject(
  kind: "rpc" | "operations" | "events" | "feeds" | "subjects",
  out: Record<string, unknown>,
  next: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(next)) {
    const existing = out[key];
    if (existing !== undefined) {
      const existingSubject = typeof existing === "object" && existing !== null
        ? (existing as { subject?: unknown }).subject
        : undefined;
      const nextSubject = typeof value === "object" && value !== null
        ? (value as { subject?: unknown }).subject
        : undefined;
      if (
        typeof existingSubject === "string" && existingSubject === nextSubject
      ) {
        continue;
      }
      throw new Error(
        `Duplicate ${kind} key '${key}' while deriving contract API`,
      );
    }
    out[key] = value;
  }
}

function mergeUseIntoApi(target: TrellisApiLike, api: TrellisApiLike): void {
  mergeApiAllowDuplicateSubject("rpc", target.rpc, api.rpc);
  mergeApiAllowDuplicateSubject(
    "operations",
    target.operations,
    api.operations,
  );
  mergeApiAllowDuplicateSubject("events", target.events, api.events);
  mergeApiAllowDuplicateSubject("feeds", target.feeds ?? {}, api.feeds ?? {});
  mergeApiAllowDuplicateSubject("subjects", target.subjects, api.subjects);
}

function baselineUse(
  contract: string,
  use: Omit<ContractSourceUse, "contract">,
  api: TrellisApiLike,
): NormalizedUse {
  return { manifestUse: { contract, ...use }, api };
}

function deriveImplicitTrellisUses(source: DefineContractSource): Record<
  string,
  NormalizedUse
> {
  const uses: Record<string, NormalizedUse> = {};

  if (
    source.kind === "app" || source.kind === "agent" || source.kind === "device"
  ) {
    uses.auth = baselineUse(
      TRELLIS_AUTH_CONTRACT_ID,
      { rpc: { call: [...BASELINE_AUTH_RPC_CALL] } },
      BASELINE_AUTH_API,
    );
  }

  if (source.state) {
    uses.state = baselineUse(
      TRELLIS_STATE_CONTRACT_ID,
      { rpc: { call: [...BASELINE_STATE_RPC_CALL] } },
      BASELINE_STATE_API,
    );
  }

  if (
    (source.kind === "service" || source.kind === "device") &&
    source.id !== TRELLIS_HEALTH_CONTRACT_ID
  ) {
    uses.health = baselineUse(
      TRELLIS_HEALTH_CONTRACT_ID,
      { events: { publish: [...BASELINE_HEALTH_EVENTS_PUBLISH] } },
      BASELINE_HEALTH_API,
    );
  }

  return uses;
}

function normalizeContractUses(source: DefineContractSource): {
  manifestUses: ContractSourceUses | undefined;
  usedApi: TrellisApiLike;
} {
  const explicit = normalizeUses(source.uses);
  const usedApi = emptyApi();
  mergeUseIntoApi(usedApi, explicit.usedApi);

  const required: Record<string, ContractSourceUse> = {
    ...(explicit.manifestUses?.required ?? {}),
  };
  const optional = explicit.manifestUses?.optional
    ? { ...explicit.manifestUses.optional }
    : undefined;

  for (
    const [alias, use] of Object.entries(deriveImplicitTrellisUses(source))
  ) {
    mergeUseIntoManifest(required, alias, use.manifestUse);
    mergeUseIntoApi(usedApi, use.api);
  }

  return {
    manifestUses: Object.keys(required).length > 0 ||
        (optional && Object.keys(optional).length > 0)
      ? {
        ...(Object.keys(required).length > 0 ? { required } : {}),
        ...(optional && Object.keys(optional).length > 0 ? { optional } : {}),
      }
      : undefined,
    usedApi,
  };
}

function selectedKeys(keys: readonly string[] | undefined): readonly string[] {
  return keys ?? [];
}

function mergeApiSection(
  kind: keyof TrellisApiLike,
  usedEntries: Record<string, unknown>,
  ownedEntries: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  mergeRecord(kind, merged, usedEntries);
  mergeRecord(kind, merged, ownedEntries);
  return merged;
}

function mergeDerivedApis<
  TOwnedApi extends TrellisApiLike,
  TUsedApi extends TrellisApiLike,
>(
  ownedApi: TOwnedApi,
  usedApi: TUsedApi,
): MergeApis<TOwnedApi, TUsedApi> {
  return {
    rpc: mergeApiSection("rpc", usedApi.rpc, ownedApi.rpc) as MergeApis<
      TOwnedApi,
      TUsedApi
    >["rpc"],
    operations: mergeApiSection(
      "operations",
      usedApi.operations,
      ownedApi.operations,
    ) as MergeApis<TOwnedApi, TUsedApi>["operations"],
    events: mergeApiSection(
      "events",
      usedApi.events,
      ownedApi.events,
    ) as MergeApis<TOwnedApi, TUsedApi>["events"],
    feeds: mergeApiSection(
      "feeds",
      usedApi.feeds ?? {},
      ownedApi.feeds ?? {},
    ) as MergeApis<TOwnedApi, TUsedApi>["feeds"],
    subjects: mergeApiSection(
      "subjects",
      usedApi.subjects,
      ownedApi.subjects,
    ) as MergeApis<TOwnedApi, TUsedApi>["subjects"],
  };
}

function defineContract(
  registry: AnyDefineContractRegistry,
  build: (
    ref: ContractRefBuilder,
  ) => Omit<DefineContractSource, "schemas" | "errors">,
): DefinedContract<TrellisApiLike, ApiShape, ApiShape, string>;
function defineContract(
  registry: AnyDefineContractRegistry,
  build: (
    ref: ContractRefBuilder,
  ) => Omit<DefineContractSource, "schemas" | "errors">,
): DefinedContract<
  TrellisApiLike,
  ApiShape,
  ApiShape,
  string
> {
  assertRegistryDoesNotDeclareExports(registry);
  assertRegistryDoesNotDeclareCapabilities(registry);
  const errorClasses = getErrorClassRegistry(registry.errors);
  const normalizedErrors = normalizeErrorRegistry(registry.errors);
  const body = build(createContractRefBuilder({
    ...(registry.schemas ? { schemas: registry.schemas } : {}),
    ...(errorClasses ? { errors: errorClasses } : {}),
  }));
  const materializedSchemas = materializeErrorSchemas(
    registry.schemas,
    normalizedErrors,
  );
  const source: DefineContractSource = {
    ...body,
    ...(materializedSchemas ? { schemas: materializedSchemas } : {}),
    ...(normalizedErrors ? { errors: normalizedErrors } : {}),
  };
  assertExportedSchemasExist(source.schemas, source.exports);

  const { manifestUses, usedApi } = normalizeContractUses(source);
  const emittedSource: TrellisContractSource = {
    id: source.id,
    displayName: source.displayName,
    description: source.description,
    kind: source.kind,
    ...(source.capabilities ? { capabilities: source.capabilities } : {}),
    ...(source.schemas ? { schemas: source.schemas } : {}),
    ...(source.exports ? { exports: source.exports } : {}),
    ...(source.state ? { state: source.state } : {}),
    ...(manifestUses ? { uses: manifestUses } : {}),
    ...(source.rpc ? { rpc: source.rpc } : {}),
    ...(source.operations ? { operations: source.operations } : {}),
    ...(source.events ? { events: source.events } : {}),
    ...(source.feeds ? { feeds: source.feeds } : {}),
    ...(source.errors ? { errors: source.errors } : {}),
    ...(source.jobs ? { jobs: source.jobs } : {}),
    ...(source.resources ? { resources: source.resources } : {}),
  };

  const ownedApi = buildOwnedApi(emittedSource);
  const trellisApi = mergeDerivedApis(
    ownedApi as ApiShape & TrellisApiLike,
    usedApi as ApiShape & TrellisApiLike,
  ) as ApiShape;
  const CONTRACT = emitContract(emittedSource);
  const CONTRACT_DIGEST = digestContractManifest(CONTRACT);

  type ConcreteDefinedContract = DefinedContract<
    TrellisApiLike,
    ApiShape,
    ApiShape,
    string
  >;

  let contract!: ConcreteDefinedContract;
  contract = {
    CONTRACT_ID: source.id,
    CONTRACT,
    CONTRACT_DIGEST,
    API: {
      owned: ownedApi as TrellisApiLike,
      used: usedApi as ApiShape,
      trellis: trellisApi,
    },
    use: createUseHelper(
      () => contract,
    ),
    [CONTRACT_JOBS_METADATA]: buildContractJobsMetadata(source.jobs),
    [CONTRACT_KV_METADATA]: buildContractKvMetadata(
      source.resources,
      source.schemas,
    ),
    [CONTRACT_STATE_METADATA]: buildContractStateMetadata(
      source.state,
      source.schemas,
    ),
  };

  return contract;
}

export function defineServiceContract<
  const TErrors extends Readonly<Record<string, unknown>> | undefined,
  const TRegistry extends DefineContractRegistry<
    Readonly<Record<string, TSchema>> | undefined,
    TErrors
  >,
  const TCapabilities extends ContractCapabilities | undefined,
  const TUses extends AuthorContractUses | undefined,
  const TRpc extends
    | Readonly<
      Record<
        string,
        ContractSourceRpcMethod<
          SchemaNameOf<RegistrySchemas<TRegistry>>,
          ErrorNameOf<RegistryErrors<TRegistry>>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined,
  const TOperations extends
    | Readonly<
      Record<
        string,
        ContractSourceOperation<
          SchemaNameOf<RegistrySchemas<TRegistry>>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined,
  const TEvents extends
    | Readonly<
      Record<
        string,
        ContractSourceEvent<
          SchemaNameOf<RegistrySchemas<TRegistry>>,
          CapabilityRef<TCapabilities>
        >
      >
    >
    | undefined,
  const TBody extends ServiceContractBodyInput<
    TCapabilities,
    RegistrySchemas<TRegistry>,
    TUses,
    RegistryErrors<TRegistry>,
    TRpc,
    TOperations,
    TEvents
  >,
>(
  registry: TRegistry & { capabilities?: never; exports?: never },
  build: (
    ref: ContractRefBuilder<
      RegistrySchemas<TRegistry>,
      RegistryErrors<TRegistry>
    >,
  ) => TBody,
): DefinedContract<
  OwnedApiFromSource<
    BuiltContractSource<TRegistry, WithKind<TBody, "service">>
  >,
  UsedApiFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
  MergeApis<
    OwnedApiFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >,
    UsedApiFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >
  >,
  TBody["id"],
  ProjectedJobs<
    JobsFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
    SchemasFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >
  >,
  ProjectedState<
    StateFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
    SchemasFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >
  >,
  ProjectedKvResources<
    ResourcesFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >,
    SchemasFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >
  >
> {
  return defineContract(
    registry,
    (ref) => ({
      ...build(ref),
      kind: "service",
    }),
  ) as unknown as DefinedContract<
    OwnedApiFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >,
    UsedApiFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >,
    MergeApis<
      OwnedApiFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >,
      UsedApiFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >
    >,
    TBody["id"],
    ProjectedJobs<
      JobsFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >,
      SchemasFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >
    >,
    ProjectedState<
      StateFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >,
      SchemasFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >
    >,
    ProjectedKvResources<
      ResourcesFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >,
      SchemasFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >
    >
  >;
}

function defineClientContract<
  const TKind extends Exclude<ContractKind, "service">,
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends AuthorContractUses | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  kind: TKind,
  registry: ClientContractRegistry<TSchemas> & {
    capabilities?: never;
    exports?: never;
  },
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<
    BuiltContractSource<
      ClientContractRegistry<TSchemas>,
      WithKind<TBody, TKind>
    >
  >,
  UsedApiFromSource<
    BuiltContractSource<
      ClientContractRegistry<TSchemas>,
      WithKind<TBody, TKind>
    >
  >,
  MergeApis<
    OwnedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, TKind>
      >
    >,
    UsedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, TKind>
      >
    >
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, TKind>
      >
    >,
    SchemasFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, TKind>
      >
    >
  >
> {
  return defineContract(
    registry,
    (ref) => ({ ...build(ref), kind }),
  ) as unknown as DefinedContract<
    OwnedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, TKind>
      >
    >,
    UsedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, TKind>
      >
    >,
    MergeApis<
      OwnedApiFromSource<
        BuiltContractSource<
          ClientContractRegistry<TSchemas>,
          WithKind<TBody, TKind>
        >
      >,
      UsedApiFromSource<
        BuiltContractSource<
          ClientContractRegistry<TSchemas>,
          WithKind<TBody, TKind>
        >
      >
    >,
    TBody["id"],
    {},
    ProjectedState<
      StateFromSource<
        BuiltContractSource<
          ClientContractRegistry<TSchemas>,
          WithKind<TBody, TKind>
        >
      >,
      SchemasFromSource<
        BuiltContractSource<
          ClientContractRegistry<TSchemas>,
          WithKind<TBody, TKind>
        >
      >
    >
  >;
}

export function defineAppContract<
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends AuthorContractUses | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  registry: ClientContractRegistry<TSchemas> & {
    capabilities?: never;
    exports?: never;
  },
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<
    BuiltContractSource<
      ClientContractRegistry<TSchemas>,
      WithKind<TBody, "app">
    >
  >,
  UsedApiFromSource<
    BuiltContractSource<
      ClientContractRegistry<TSchemas>,
      WithKind<TBody, "app">
    >
  >,
  MergeApis<
    OwnedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "app">
      >
    >,
    UsedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "app">
      >
    >
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "app">
      >
    >,
    SchemasFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "app">
      >
    >
  >
>;
export function defineAppContract<
  const TUses extends AuthorContractUses | undefined,
  const TBody extends ClientContractBodyInput<undefined, TUses>,
>(build: () => TBody): DefinedContract<
  OwnedApiFromSource<WithKind<TBody, "app">>,
  UsedApiFromSource<WithKind<TBody, "app">>,
  MergeApis<
    OwnedApiFromSource<WithKind<TBody, "app">>,
    UsedApiFromSource<WithKind<TBody, "app">>
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<WithKind<TBody, "app">>,
    SchemasFromSource<WithKind<TBody, "app">>
  >
>;
export function defineAppContract(
  ...args:
    | [() => ContractIdentityFields & Record<string, unknown>]
    | [
      ClientContractRegistry<Readonly<Record<string, TSchema>>> & {
        capabilities?: never;
        exports?: never;
      },
      (
        ref: ContractRefBuilder<Readonly<Record<string, TSchema>>>,
      ) => ContractIdentityFields & Record<string, unknown>,
    ]
) {
  const [registryOrBuild, maybeBuild] = args;
  if (typeof registryOrBuild === "function") {
    return defineClientContract("app", {}, () => registryOrBuild());
  }

  return defineClientContract("app", registryOrBuild, maybeBuild!);
}

export function defineAgentContract<
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends AuthorContractUses | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  registry: ClientContractRegistry<TSchemas> & {
    capabilities?: never;
    exports?: never;
  },
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<
    BuiltContractSource<
      ClientContractRegistry<TSchemas>,
      WithKind<TBody, "agent">
    >
  >,
  UsedApiFromSource<
    BuiltContractSource<
      ClientContractRegistry<TSchemas>,
      WithKind<TBody, "agent">
    >
  >,
  MergeApis<
    OwnedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "agent">
      >
    >,
    UsedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "agent">
      >
    >
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "agent">
      >
    >,
    SchemasFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "agent">
      >
    >
  >
>;
export function defineAgentContract<
  const TUses extends AuthorContractUses | undefined,
  const TBody extends ClientContractBodyInput<undefined, TUses>,
>(build: () => TBody): DefinedContract<
  OwnedApiFromSource<WithKind<TBody, "agent">>,
  UsedApiFromSource<WithKind<TBody, "agent">>,
  MergeApis<
    OwnedApiFromSource<WithKind<TBody, "agent">>,
    UsedApiFromSource<WithKind<TBody, "agent">>
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<WithKind<TBody, "agent">>,
    SchemasFromSource<WithKind<TBody, "agent">>
  >
>;
export function defineAgentContract(
  ...args:
    | [() => ContractIdentityFields & Record<string, unknown>]
    | [
      ClientContractRegistry<Readonly<Record<string, TSchema>>> & {
        capabilities?: never;
        exports?: never;
      },
      (
        ref: ContractRefBuilder<Readonly<Record<string, TSchema>>>,
      ) => ContractIdentityFields & Record<string, unknown>,
    ]
) {
  const [registryOrBuild, maybeBuild] = args;
  if (typeof registryOrBuild === "function") {
    return defineClientContract("agent", {}, () => registryOrBuild());
  }

  return defineClientContract("agent", registryOrBuild, maybeBuild!);
}

export function defineDeviceContract<
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends AuthorContractUses | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  registry: ClientContractRegistry<TSchemas> & {
    capabilities?: never;
    exports?: never;
  },
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<
    BuiltContractSource<
      ClientContractRegistry<TSchemas>,
      WithKind<TBody, "device">
    >
  >,
  UsedApiFromSource<
    BuiltContractSource<
      ClientContractRegistry<TSchemas>,
      WithKind<TBody, "device">
    >
  >,
  MergeApis<
    OwnedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "device">
      >
    >,
    UsedApiFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "device">
      >
    >
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "device">
      >
    >,
    SchemasFromSource<
      BuiltContractSource<
        ClientContractRegistry<TSchemas>,
        WithKind<TBody, "device">
      >
    >
  >
>;
export function defineDeviceContract<
  const TUses extends AuthorContractUses | undefined,
  const TBody extends ClientContractBodyInput<undefined, TUses>,
>(build: () => TBody): DefinedContract<
  OwnedApiFromSource<WithKind<TBody, "device">>,
  UsedApiFromSource<WithKind<TBody, "device">>,
  MergeApis<
    OwnedApiFromSource<WithKind<TBody, "device">>,
    UsedApiFromSource<WithKind<TBody, "device">>
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<WithKind<TBody, "device">>,
    SchemasFromSource<WithKind<TBody, "device">>
  >
>;
export function defineDeviceContract(
  ...args:
    | [() => ContractIdentityFields & Record<string, unknown>]
    | [
      ClientContractRegistry<Readonly<Record<string, TSchema>>> & {
        capabilities?: never;
        exports?: never;
      },
      (
        ref: ContractRefBuilder<Readonly<Record<string, TSchema>>>,
      ) => ContractIdentityFields & Record<string, unknown>,
    ]
) {
  const [registryOrBuild, maybeBuild] = args;
  if (typeof registryOrBuild === "function") {
    return defineClientContract("device", {}, () => registryOrBuild());
  }

  return defineClientContract("device", registryOrBuild, maybeBuild!);
}

export type {
  EventDesc,
  FeedDesc,
  InferRuntimeRpcError,
  InferSchemaType,
  JsonValue,
  RPCDesc,
  RpcErrorClass,
  RuntimeRpcErrorDesc,
  Schema,
  SchemaLike,
  SerializableErrorData,
  TrellisAPI,
};
export { canonicalizeJson, digestJson, isJsonValue, schema, unwrapSchema };
