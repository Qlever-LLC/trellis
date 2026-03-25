import type { TSchema } from "typebox";
import {
  canonicalizeJson,
  digestJson,
  isJsonValue,
  type JsonValue,
  sha256Base64urlSync,
} from "./canonical.ts";
import {
  type EventDesc,
  type InferSchemaType,
  type RPCDesc,
  type Schema,
  type SchemaLike,
  type SubjectDesc,
  schema,
  type TrellisAPI,
  unwrapSchema,
} from "./runtime.ts";
import {
  assertDataPointersExistAndAreTokenable,
  type SubjectParam,
} from "./schema_pointers.ts";

export {
  ContractKvResourceSchema,
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
  type EventHeader,
  EventHeaderSchema,
  type InstalledServiceContract,
  InstalledServiceContractSchema,
  IsoDateSchema,
  type KvResourceBinding,
  KvResourceBindingSchema,
  type Paginated,
  PaginatedSchema,
} from "./protocol.ts";

export const CONTRACT_FORMAT_V1 = "trellis.contract.v1" as const;
export const CATALOG_FORMAT_V1 = "trellis.catalog.v1" as const;

const CONTRACT_MODULE_METADATA = Symbol.for("@trellis/contracts/contract-module");

type UnionToIntersection<U> =
  (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I
    : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type StringKeyOf<T> = Extract<keyof T, string>;
type KeysFromList<T> = T extends readonly (infer K)[] ? Extract<K, string> : never;

export type ContractKind = string;

export type ContractManifestMetadata = {
  displayName: string;
  description: string;
  kind: ContractKind;
};

export type Capability = string;
export type JsonSchema = JsonValue | boolean;

export type ContractErrorDecl = {
  type: string;
  schema?: JsonSchema;
};

export type ContractErrorRef = {
  type: string;
};

export type ContractRpcMethod = {
  version: `v${number}`;
  subject: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  capabilities?: { call?: Capability[] };
  errors?: ContractErrorRef[];
};

export type ContractEvent = {
  version: `v${number}`;
  subject: string;
  params?: string[];
  eventSchema: JsonSchema;
  capabilities?: { publish?: Capability[]; subscribe?: Capability[] };
};

export type ContractSubject = {
  subject: string;
  schema?: JsonSchema;
  capabilities?: { publish?: Capability[]; subscribe?: Capability[] };
};

export type ContractKvResource = {
  purpose: string;
  required?: boolean;
  history?: number;
  ttlMs?: number;
  maxValueBytes?: number;
};

export type ContractResources = {
  kv?: Record<string, ContractKvResource>;
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
  events?: ContractUsesPubSub;
  subjects?: ContractUsesPubSub;
};

export type ContractUses = Record<string, ContractUse>;

export type TrellisContractV1 = {
  format: typeof CONTRACT_FORMAT_V1;
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  uses?: ContractUses;
  rpc?: Record<string, ContractRpcMethod>;
  events?: Record<string, ContractEvent>;
  subjects?: Record<string, ContractSubject>;
  errors?: Record<string, ContractErrorDecl>;
  resources?: ContractResources;
};

export type TrellisCatalogEntry = {
  id: string;
  digest: string;
  displayName: string;
  description: string;
  kind: ContractKind;
};

export type TrellisCatalogV1 = {
  format: typeof CATALOG_FORMAT_V1;
  contracts: TrellisCatalogEntry[];
};

export type ContractSourceErrorDecl = {
  type: string;
  schema?: TSchema;
};

export type ContractSourceRpcMethod = {
  version: `v${number}`;
  inputSchema: TSchema;
  outputSchema: TSchema;
  capabilities?: { call?: readonly Capability[] };
  errors?: readonly string[];
  authRequired?: boolean;
  subject?: string;
};

export type ContractSourceEvent = {
  version: `v${number}`;
  eventSchema: TSchema;
  params?: readonly SubjectParam[];
  capabilities?: { publish?: readonly Capability[]; subscribe?: readonly Capability[] };
  subject?: string;
};

export type ContractSourceSubject = {
  subject: string;
  schema?: TSchema;
  capabilities?: { publish?: readonly Capability[]; subscribe?: readonly Capability[] };
};

export type ContractSourceKvResource = {
  purpose: string;
  required?: boolean;
  history?: number;
  ttlMs?: number;
  maxValueBytes?: number;
};

export type ContractSourceResources = {
  kv?: Record<string, ContractSourceKvResource>;
};

export type ContractSourceUse = {
  contract: string;
  rpc?: { call?: readonly string[] };
  events?: { publish?: readonly string[]; subscribe?: readonly string[] };
  subjects?: { publish?: readonly string[]; subscribe?: readonly string[] };
};

export type TrellisContractSource = {
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  uses?: Record<string, ContractSourceUse>;
  rpc?: Record<string, ContractSourceRpcMethod>;
  events?: Record<string, ContractSourceEvent>;
  subjects?: Record<string, ContractSourceSubject>;
  errors?: Record<string, ContractSourceErrorDecl>;
  resources?: ContractSourceResources;
};

export type TrellisApiLike = {
  rpc: Record<string, RPCDesc>;
  events: Record<string, EventDesc>;
  subjects: Record<string, SubjectDesc>;
};

type ApiShape = {
  rpc: Record<string, unknown>;
  events: Record<string, unknown>;
  subjects: Record<string, unknown>;
};

export type EmptyApi = {
  rpc: {};
  events: {};
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
  events?: {
    publish?: readonly StringKeyOf<TApi["events"]>[];
    subscribe?: readonly StringKeyOf<TApi["events"]>[];
  };
  subjects?: {
    publish?: readonly StringKeyOf<TApi["subjects"]>[];
    subscribe?: readonly StringKeyOf<TApi["subjects"]>[];
  };
};

type UseRpcCall<TSpec> = NonNullable<TSpec extends { rpc?: infer TRpc } ? TRpc : never> extends
  { call?: infer TCall } ? TCall
  : never;
type UseEventsPublish<TSpec> =
  NonNullable<TSpec extends { events?: infer TEvents } ? TEvents : never> extends
    { publish?: infer TPublish } ? TPublish
    : never;
type UseEventsSubscribe<TSpec> =
  NonNullable<TSpec extends { events?: infer TEvents } ? TEvents : never> extends
    { subscribe?: infer TSubscribe } ? TSubscribe
    : never;
type UseSubjectsPublish<TSpec> =
  NonNullable<TSpec extends { subjects?: infer TSubjects } ? TSubjects : never> extends
    { publish?: infer TPublish } ? TPublish
    : never;
type UseSubjectsSubscribe<TSpec> =
  NonNullable<TSpec extends { subjects?: infer TSubjects } ? TSubjects : never> extends
    { subscribe?: infer TSubscribe } ? TSubscribe
    : never;

type ContractModuleMarker = {
  readonly [CONTRACT_MODULE_METADATA]: ContractModule<string, TrellisApiLike, TrellisApiLike, TrellisApiLike>;
};

export type ContractDependencyUse<
  TContractId extends string,
  TApi extends ApiShape,
  TSpec extends UseSpec<TApi> = UseSpec<TApi>,
> = {
  contract: TContractId;
  rpc?: { call?: UseRpcCall<TSpec> };
  events?: {
    publish?: UseEventsPublish<TSpec>;
    subscribe?: UseEventsSubscribe<TSpec>;
  };
  subjects?: {
    publish?: UseSubjectsPublish<TSpec>;
    subscribe?: UseSubjectsSubscribe<TSpec>;
  };
} & ContractModuleMarker;

type AnyContractDependencyUse = ContractDependencyUse<string, TrellisApiLike, UseSpec<TrellisApiLike>>;

export type ContractUseFn<TContractId extends string, TApi extends ApiShape> = <
  const TRpcCall extends readonly StringKeyOf<TApi["rpc"]>[] | undefined = undefined,
  const TEventsPublish extends readonly StringKeyOf<TApi["events"]>[] | undefined = undefined,
  const TEventsSubscribe extends readonly StringKeyOf<TApi["events"]>[] | undefined = undefined,
  const TSubjectsPublish extends readonly StringKeyOf<TApi["subjects"]>[] | undefined = undefined,
  const TSubjectsSubscribe extends readonly StringKeyOf<TApi["subjects"]>[] | undefined = undefined,
>(spec: {
  rpc?: { call?: TRpcCall };
  events?: { publish?: TEventsPublish; subscribe?: TEventsSubscribe };
  subjects?: { publish?: TSubjectsPublish; subscribe?: TSubjectsSubscribe };
}) => ContractDependencyUse<TContractId, TApi, {
  rpc?: { call?: TRpcCall };
  events?: { publish?: TEventsPublish; subscribe?: TEventsSubscribe };
  subjects?: { publish?: TSubjectsPublish; subscribe?: TSubjectsSubscribe };
}>;

type MergeRecordUnion<U> = [U] extends [never] ? {} : Simplify<UnionToIntersection<U>>;

type ProjectedRpc<T extends Readonly<Record<string, ContractSourceRpcMethod>> | undefined> = T extends
  Readonly<Record<string, ContractSourceRpcMethod>> ? {
    [K in keyof T]: RPCDesc<
      Schema<T[K]["inputSchema"] extends TSchema ? import("./runtime.ts").InferSchemaType<T[K]["inputSchema"]>
        : unknown>,
      Schema<T[K]["outputSchema"] extends TSchema ? import("./runtime.ts").InferSchemaType<T[K]["outputSchema"]>
        : unknown>,
      T[K]["errors"]
    > & { authRequired?: boolean };
  }
  : {};

type ProjectedEvents<T extends Readonly<Record<string, ContractSourceEvent>> | undefined> = T extends
  Readonly<Record<string, ContractSourceEvent>> ? {
    [K in keyof T]: EventDesc<
      Schema<T[K]["eventSchema"] extends TSchema ? import("./runtime.ts").InferSchemaType<T[K]["eventSchema"]>
        : unknown>
    >;
  }
  : {};

type ProjectedSubjects<T extends Readonly<Record<string, ContractSourceSubject>> | undefined> = T extends
  Readonly<Record<string, ContractSourceSubject>> ? {
    [K in keyof T]: SubjectDesc<
      T[K]["schema"] extends TSchema ? Schema<import("./runtime.ts").InferSchemaType<T[K]["schema"]>> : never
    >;
  }
  : {};

type OwnedApiFromSource<T extends {
  rpc?: Readonly<Record<string, ContractSourceRpcMethod>>;
  events?: Readonly<Record<string, ContractSourceEvent>>;
  subjects?: Readonly<Record<string, ContractSourceSubject>>;
}> = {
  rpc: ProjectedRpc<T["rpc"]>;
  events: ProjectedEvents<T["events"]>;
  subjects: ProjectedSubjects<T["subjects"]>;
};

type RpcKeysFromSpec<TSpec> = TSpec extends { rpc?: { call?: infer TCall } } ? KeysFromList<TCall>
  : never;
type EventKeysFromSpec<TSpec> =
  | (TSpec extends { events?: { publish?: infer TPublish } } ? KeysFromList<TPublish> : never)
  | (TSpec extends { events?: { subscribe?: infer TSubscribe } } ? KeysFromList<TSubscribe> : never);
type SubjectKeysFromSpec<TSpec> =
  | (TSpec extends { subjects?: { publish?: infer TPublish } } ? KeysFromList<TPublish> : never)
  | (TSpec extends { subjects?: { subscribe?: infer TSubscribe } } ? KeysFromList<TSubscribe> : never);

type ApiFromDependencyUse<TUse> = TUse extends ContractDependencyUse<string, infer TApi, infer TSpec> ? {
    rpc: Pick<TApi["rpc"], RpcKeysFromSpec<TSpec>>;
    events: Pick<TApi["events"], EventKeysFromSpec<TSpec>>;
    subjects: Pick<TApi["subjects"], SubjectKeysFromSpec<TSpec>>;
  }
  : EmptyApi;

type UsedApiFromUses<TUses> = [TUses] extends [undefined] ? EmptyApi : TUses extends Record<string, unknown> ? {
    rpc: MergeRecordUnion<ApiFromDependencyUse<TUses[keyof TUses]>["rpc"]>;
    events: MergeRecordUnion<ApiFromDependencyUse<TUses[keyof TUses]>["events"]>;
    subjects: MergeRecordUnion<ApiFromDependencyUse<TUses[keyof TUses]>["subjects"]>;
  }
  : EmptyApi;

type MergeApis<TOwnedApi extends ApiShape, TUsedApi extends ApiShape> = {
  rpc: Simplify<TUsedApi["rpc"] & TOwnedApi["rpc"]>;
  events: Simplify<TUsedApi["events"] & TOwnedApi["events"]>;
  subjects: Simplify<TUsedApi["subjects"] & TOwnedApi["subjects"]>;
};

export type ContractModule<
  TContractId extends string,
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
> = {
  CONTRACT_ID: TContractId;
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST: string;
  API: ContractApiViews<TOwnedApi, TUsedApi, TTrellisApi>;
  use: ContractUseFn<TContractId, TOwnedApi>;
};

export type SdkContractModule<
  TContractId extends string,
  TOwnedApi extends ApiShape,
> = ContractModule<TContractId, TOwnedApi, EmptyApi, TOwnedApi>;

export type DefinedContract<
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
  TContractId extends string = string,
> = ContractModule<TContractId, TOwnedApi, TUsedApi, TTrellisApi>;

export type DefineContractInput<
  TUses extends Readonly<Record<string, AnyContractDependencyUse>> | undefined = undefined,
  TRpc extends Readonly<Record<string, ContractSourceRpcMethod>> | undefined = undefined,
  TEvents extends Readonly<Record<string, ContractSourceEvent>> | undefined = undefined,
  TSubjects extends Readonly<Record<string, ContractSourceSubject>> | undefined = undefined,
> = {
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  uses?: TUses;
  rpc?: TRpc;
  events?: TEvents;
  subjects?: TSubjects;
  errors?: Record<string, ContractSourceErrorDecl>;
  resources?: ContractSourceResources;
};

function cloneSchema(schemaValue: TSchema): JsonSchema {
  const cloned = JSON.parse(JSON.stringify(schemaValue)) as unknown;
  if (!isJsonValue(cloned)) {
    throw new Error("Contract schema is not JSON-serializable");
  }
  return cloned as JsonSchema;
}

function digestCanonicalJson(value: JsonValue): string {
  return sha256Base64urlSync(canonicalizeJson(value));
}

function rpcSubject(name: string, version: `v${number}`): string {
  return `rpc.${version}.${name}`;
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

function emitResources(resources: ContractSourceResources | undefined): ContractResources | undefined {
  if (!resources?.kv) {
    return undefined;
  }

  return {
    kv: Object.fromEntries(
      Object.entries(resources.kv).map(([alias, resource]) => [
        alias,
        {
          purpose: resource.purpose,
          required: resource.required ?? true,
          history: resource.history ?? 1,
          ttlMs: resource.ttlMs ?? 0,
          ...(resource.maxValueBytes ? { maxValueBytes: resource.maxValueBytes } : {}),
        } satisfies ContractKvResource,
      ]),
    ),
  };
}

function emitUses(uses: Record<string, ContractSourceUse> | undefined): ContractUses | undefined {
  if (!uses) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(uses).map(([alias, use]) => [
      alias,
      {
        contract: use.contract,
        ...(use.rpc?.call ? { rpc: { call: [...use.rpc.call] } } : {}),
        ...((use.events?.publish || use.events?.subscribe)
          ? {
            events: {
              ...(use.events.publish ? { publish: [...use.events.publish] } : {}),
              ...(use.events.subscribe ? { subscribe: [...use.events.subscribe] } : {}),
            },
          }
          : {}),
        ...((use.subjects?.publish || use.subjects?.subscribe)
          ? {
            subjects: {
              ...(use.subjects.publish ? { publish: [...use.subjects.publish] } : {}),
              ...(use.subjects.subscribe ? { subscribe: [...use.subjects.subscribe] } : {}),
            },
          }
          : {}),
      } satisfies ContractUse,
    ]),
  );
}

function emitContract(source: TrellisContractSource): TrellisContractV1 {
  const rpc = source.rpc
    ? Object.fromEntries(
      Object.entries(source.rpc).map(([name, method]) => {
        const emitted: ContractRpcMethod = {
          version: method.version,
          subject: method.subject ?? rpcSubject(name, method.version),
          inputSchema: cloneSchema(method.inputSchema),
          outputSchema: cloneSchema(method.outputSchema),
        };
        if (method.capabilities?.call) {
          emitted.capabilities = { call: [...method.capabilities.call] };
        }
        if (method.errors && method.errors.length > 0) {
          emitted.errors = method.errors.map((type) => ({ type }));
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const events = source.events
    ? Object.fromEntries(
      Object.entries(source.events).map(([name, event]) => {
        if (event.params && event.params.length > 0) {
          assertDataPointersExistAndAreTokenable(name, event.eventSchema, event.params);
        }

        const emitted: ContractEvent = {
          version: event.version,
          subject: event.subject ?? eventSubject(name, event.version, event.params),
          eventSchema: cloneSchema(event.eventSchema),
        };
        if (event.params && event.params.length > 0) {
          emitted.params = [...event.params];
        }
        if (event.capabilities?.publish || event.capabilities?.subscribe) {
          emitted.capabilities = {
            ...(event.capabilities.publish ? { publish: [...event.capabilities.publish] } : {}),
            ...(event.capabilities.subscribe ? { subscribe: [...event.capabilities.subscribe] } : {}),
          };
        }

        return [name, emitted];
      }),
    )
    : undefined;

  const subjects = source.subjects
    ? Object.fromEntries(
      Object.entries(source.subjects).map(([name, subject]) => {
        const emitted: ContractSubject = {
          subject: subject.subject,
        };
        if (subject.schema) {
          emitted.schema = cloneSchema(subject.schema);
        }
        if (subject.capabilities?.publish || subject.capabilities?.subscribe) {
          emitted.capabilities = {
            ...(subject.capabilities.publish ? { publish: [...subject.capabilities.publish] } : {}),
            ...(subject.capabilities.subscribe ? { subscribe: [...subject.capabilities.subscribe] } : {}),
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
        if (error.schema) {
          emitted.schema = cloneSchema(error.schema);
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const resources = emitResources(source.resources);
  const uses = emitUses(source.uses);

  return {
    format: CONTRACT_FORMAT_V1,
    id: source.id,
    displayName: source.displayName,
    description: source.description,
    kind: source.kind,
    ...(uses ? { uses } : {}),
    ...(rpc ? { rpc } : {}),
    ...(events ? { events } : {}),
    ...(subjects ? { subjects } : {}),
    ...(errors ? { errors } : {}),
    ...(resources ? { resources } : {}),
  };
}

function buildOwnedApi(source: TrellisContractSource): TrellisApiLike {
  const rpc = Object.fromEntries(
    Object.entries(source.rpc ?? {}).map(([name, method]) => [
      name,
      {
        subject: method.subject ?? rpcSubject(name, method.version),
        input: schema(cloneSchema(method.inputSchema)),
        output: schema(cloneSchema(method.outputSchema)),
        callerCapabilities: method.capabilities?.call ?? [],
        authRequired: method.authRequired ?? true,
        errors: method.errors,
      },
    ]),
  ) as Record<string, RPCDesc>;

  const events = Object.fromEntries(
    Object.entries(source.events ?? {}).map(([name, event]) => {
      if (event.params && event.params.length > 0) {
        assertDataPointersExistAndAreTokenable(name, event.eventSchema, event.params);
      }

      return [
        name,
        {
          subject: event.subject ?? eventSubject(name, event.version, event.params),
          params: event.params,
          event: schema(cloneSchema(event.eventSchema)),
          publishCapabilities: event.capabilities?.publish ?? [],
          subscribeCapabilities: event.capabilities?.subscribe ?? [],
        },
      ];
    }),
  ) as Record<string, EventDesc>;

  const subjects = Object.fromEntries(
    Object.entries(source.subjects ?? {}).map(([name, subject]) => [
      name,
      {
        subject: subject.subject,
        schema: subject.schema ? schema(cloneSchema(subject.schema)) : undefined,
        publishCapabilities: subject.capabilities?.publish ?? [],
        subscribeCapabilities: subject.capabilities?.subscribe ?? [],
      },
    ]),
  ) as Record<string, SubjectDesc>;

  return { rpc, events, subjects };
}

function mergeRecord(
  kind: "rpc" | "events" | "subjects",
  out: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(next)) {
    if (Object.hasOwn(out, key)) {
      throw new Error(`Duplicate ${kind} key '${key}' while deriving contract API`);
    }
    out[key] = value;
  }
}

function assertSelectedKeysExist(
  contractId: string,
  kind: "rpc" | "events" | "subjects",
  keys: readonly string[] | undefined,
  api: Record<string, unknown>,
) {
  if (!keys) {
    return;
  }

  for (const key of keys) {
    if (!Object.hasOwn(api, key)) {
      throw new Error(`Contract '${contractId}' does not expose ${kind} key '${key}'`);
    }
  }
}

function assertValidUseSpec<TApi extends TrellisApiLike>(
  contractId: string,
  spec: UseSpec<TApi>,
  api: TApi,
) {
  assertSelectedKeysExist(contractId, "rpc", spec.rpc?.call, api.rpc);
  assertSelectedKeysExist(contractId, "events", spec.events?.publish, api.events);
  assertSelectedKeysExist(contractId, "events", spec.events?.subscribe, api.events);
  assertSelectedKeysExist(contractId, "subjects", spec.subjects?.publish, api.subjects);
  assertSelectedKeysExist(contractId, "subjects", spec.subjects?.subscribe, api.subjects);
}

function attachContractModuleMetadata<TValue extends object>(
  value: TValue,
  contractModule: ContractModule<string, TrellisApiLike, TrellisApiLike, TrellisApiLike>,
): TValue & ContractModuleMarker {
  Object.defineProperty(value, CONTRACT_MODULE_METADATA, {
    value: contractModule,
    enumerable: false,
  });
  return value as TValue & ContractModuleMarker;
}

function createUseHelper<TContractId extends string, TOwnedApi extends TrellisApiLike>(
  getContractModule: () => ContractModule<TContractId, TOwnedApi, TrellisApiLike, TrellisApiLike>,
) {
  return ((spec) => {
    const contractModule = getContractModule();
    assertValidUseSpec(contractModule.CONTRACT_ID, spec, contractModule.API.owned);

    const dependencyUse = {
      contract: contractModule.CONTRACT_ID,
      ...(spec.rpc?.call ? { rpc: { call: [...spec.rpc.call] } } : {}),
      ...((spec.events?.publish || spec.events?.subscribe)
        ? {
          events: {
            ...(spec.events.publish ? { publish: [...spec.events.publish] } : {}),
            ...(spec.events.subscribe ? { subscribe: [...spec.events.subscribe] } : {}),
          },
        }
        : {}),
      ...((spec.subjects?.publish || spec.subjects?.subscribe)
        ? {
          subjects: {
            ...(spec.subjects.publish ? { publish: [...spec.subjects.publish] } : {}),
            ...(spec.subjects.subscribe ? { subscribe: [...spec.subjects.subscribe] } : {}),
          },
        }
        : {}),
    };

    return attachContractModuleMetadata(
      dependencyUse,
      contractModule as unknown as ContractModule<string, TrellisApiLike, TrellisApiLike, TrellisApiLike>,
    );
  }) as ContractUseFn<TContractId, TOwnedApi>;
}

function getContractModuleFromUse(
  alias: string,
  useValue: ContractSourceUse | ContractDependencyUse<string, TrellisApiLike>,
): ContractModule<string, TrellisApiLike, TrellisApiLike, TrellisApiLike> {
  const contractModule = (useValue as ContractModuleMarker)[CONTRACT_MODULE_METADATA];
  if (!contractModule) {
    throw new Error(
      `Contract use '${alias}' must be created with contractModule.use(...) from @trellis/contracts`,
    );
  }
  return contractModule;
}

function normalizeUses(
  uses: Readonly<Record<string, AnyContractDependencyUse>> | undefined,
): {
  manifestUses: Record<string, ContractSourceUse> | undefined;
  usedApi: TrellisApiLike;
} {
  if (!uses) {
    return {
      manifestUses: undefined,
      usedApi: { rpc: {}, events: {}, subjects: {} },
    };
  }

  const manifestUses: Record<string, ContractSourceUse> = {};
  const usedApi: TrellisApiLike = { rpc: {}, events: {}, subjects: {} };

  for (const [alias, useValue] of Object.entries(uses)) {
    const contractModule = getContractModuleFromUse(alias, useValue);
    if (useValue.contract !== contractModule.CONTRACT_ID) {
      throw new Error(
        `Contract use '${alias}' references '${useValue.contract}' but module id is '${contractModule.CONTRACT_ID}'`,
      );
    }

    assertValidUseSpec(contractModule.CONTRACT_ID, useValue, contractModule.API.owned);

    manifestUses[alias] = {
      contract: contractModule.CONTRACT_ID,
      ...(useValue.rpc?.call ? { rpc: { call: [...useValue.rpc.call] } } : {}),
      ...((useValue.events?.publish || useValue.events?.subscribe)
        ? {
          events: {
            ...(useValue.events.publish ? { publish: [...useValue.events.publish] } : {}),
            ...(useValue.events.subscribe ? { subscribe: [...useValue.events.subscribe] } : {}),
          },
        }
        : {}),
      ...((useValue.subjects?.publish || useValue.subjects?.subscribe)
        ? {
          subjects: {
            ...(useValue.subjects.publish ? { publish: [...useValue.subjects.publish] } : {}),
            ...(useValue.subjects.subscribe ? { subscribe: [...useValue.subjects.subscribe] } : {}),
          },
        }
        : {}),
    };

    const rpcKeys = selectedKeys(useValue.rpc?.call as readonly string[] | undefined);
    if (rpcKeys.length > 0) {
      mergeRecord(
        "rpc",
        usedApi.rpc,
        Object.fromEntries(rpcKeys.map((key) => [key, contractModule.API.owned.rpc[key]])),
      );
    }

    const eventKeys = new Set([
      ...selectedKeys(useValue.events?.publish as readonly string[] | undefined),
      ...selectedKeys(useValue.events?.subscribe as readonly string[] | undefined),
    ]);
    if (eventKeys.size > 0) {
      mergeRecord(
        "events",
        usedApi.events,
        Object.fromEntries([...eventKeys].map((key) => [key, contractModule.API.owned.events[key]])),
      );
    }

    const subjectKeys = new Set([
      ...selectedKeys(useValue.subjects?.publish as readonly string[] | undefined),
      ...selectedKeys(useValue.subjects?.subscribe as readonly string[] | undefined),
    ]);
    if (subjectKeys.size > 0) {
      mergeRecord(
        "subjects",
        usedApi.subjects,
        Object.fromEntries([...subjectKeys].map((key) => [key, contractModule.API.owned.subjects[key]])),
      );
    }
  }

  return { manifestUses, usedApi };
}

function selectedKeys(keys: readonly string[] | undefined): readonly string[] {
  return keys ?? [];
}

function mergeDerivedApis(ownedApi: TrellisApiLike, usedApi: TrellisApiLike): TrellisApiLike {
  const trellisApi: TrellisApiLike = { rpc: {}, events: {}, subjects: {} };
  mergeRecord("rpc", trellisApi.rpc, usedApi.rpc);
  mergeRecord("events", trellisApi.events, usedApi.events);
  mergeRecord("subjects", trellisApi.subjects, usedApi.subjects);
  mergeRecord("rpc", trellisApi.rpc, ownedApi.rpc);
  mergeRecord("events", trellisApi.events, ownedApi.events);
  mergeRecord("subjects", trellisApi.subjects, ownedApi.subjects);
  return trellisApi;
}

export function defineContract<
  const T extends DefineContractInput<any, any, any, any>,
>(
  source: T,
): DefinedContract<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>, MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>>, T["id"]> {
  const { manifestUses, usedApi } = normalizeUses(source.uses);
  const emittedSource: TrellisContractSource = {
    id: source.id,
    displayName: source.displayName,
    description: source.description,
    kind: source.kind,
    ...(manifestUses ? { uses: manifestUses } : {}),
    ...(source.rpc ? { rpc: source.rpc } : {}),
    ...(source.events ? { events: source.events } : {}),
    ...(source.subjects ? { subjects: source.subjects } : {}),
    ...(source.errors ? { errors: source.errors } : {}),
    ...(source.resources ? { resources: source.resources } : {}),
  };

  const ownedApi = buildOwnedApi(emittedSource);
  const trellisApi = mergeDerivedApis(ownedApi, usedApi);
  const CONTRACT = emitContract(emittedSource);
  const CONTRACT_DIGEST = digestCanonicalJson(CONTRACT as JsonValue);

  const contract: DefinedContract<
    OwnedApiFromSource<T>,
    UsedApiFromUses<T["uses"]>,
    MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>>,
    T["id"]
  > = {
    CONTRACT_ID: source.id,
    CONTRACT,
    CONTRACT_DIGEST,
    API: {
      owned: ownedApi as OwnedApiFromSource<T>,
      used: usedApi as UsedApiFromUses<T["uses"]>,
      trellis: trellisApi as unknown as MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>>,
    },
    use: createUseHelper(
      () => contract as unknown as ContractModule<T["id"], OwnedApiFromSource<T>, TrellisApiLike, TrellisApiLike>,
    ),
  };

  return contract;
}

export {
  canonicalizeJson,
  digestJson,
  isJsonValue,
  schema,
  unwrapSchema,
};

export type {
  EventDesc,
  InferSchemaType,
  JsonValue,
  RPCDesc,
  Schema,
  SchemaLike,
  SubjectDesc,
  TrellisAPI,
};
