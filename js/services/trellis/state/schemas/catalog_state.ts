import { ContractResourceBindingsSchema, ContractResourcesSchema, IsoDateSchema } from "@qlever-llc/trellis-contracts";
import type { StaticDecode } from "typebox";
import { Type } from "typebox";

export const ServiceRegistrySchema = Type.Object({
  displayName: Type.String(),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
  namespaces: Type.Optional(Type.Array(Type.String())),
  description: Type.String(),
  contractId: Type.Optional(Type.String({ minLength: 1 })),
  contractDigest: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9_-]+$" })),
  resourceBindings: Type.Optional(ContractResourceBindingsSchema),
  createdAt: IsoDateSchema,
}, { additionalProperties: false });
export type ServiceRegistryEntry = StaticDecode<typeof ServiceRegistrySchema>;

export const ContractMetadataSchema = Type.Object({
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type ContractMetadata = StaticDecode<typeof ContractMetadataSchema>;

export const ContractRecordSchema = Type.Object({
  digest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
  sessionKey: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" })),
  installedAt: IsoDateSchema,
  contract: Type.String({ minLength: 1 }),
  analysisSummary: Type.Optional(Type.Object({
    namespaces: Type.Array(Type.String()),
    rpcMethods: Type.Number(),
    events: Type.Number(),
    natsPublish: Type.Number(),
    natsSubscribe: Type.Number(),
    kvResources: Type.Number({ default: 0 }),
  }, { additionalProperties: false })),
  analysis: Type.Optional(Type.Object({
    namespaces: Type.Array(Type.String()),
    rpc: Type.Object({
      methods: Type.Array(Type.Object({
        key: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        callerCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    events: Type.Object({
      events: Type.Array(Type.Object({
        key: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        publishCapabilities: Type.Array(Type.String()),
        subscribeCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    subjects: Type.Optional(Type.Object({
      subjects: Type.Array(Type.Object({
        key: Type.String(),
        subject: Type.String(),
        publishCapabilities: Type.Array(Type.String()),
        subscribeCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false })),
    nats: Type.Object({
      publish: Type.Array(Type.Object({
        kind: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        requiredCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
      subscribe: Type.Array(Type.Object({
        kind: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        requiredCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    resources: Type.Object({
      kv: Type.Array(Type.Object({
        alias: Type.String({ minLength: 1 }),
        purpose: Type.String({ minLength: 1 }),
        required: Type.Boolean(),
        history: Type.Number(),
        ttlMs: Type.Number(),
        maxValueBytes: Type.Optional(Type.Number()),
      }, { additionalProperties: false }), { default: [] }),
    }, { additionalProperties: false, default: { kv: [] } }),
  }, { additionalProperties: false })),
  resources: Type.Optional(ContractResourcesSchema),
  resourceBindings: Type.Optional(ContractResourceBindingsSchema),
}, { additionalProperties: false });
export type ContractRecord = StaticDecode<typeof ContractRecordSchema>;

export const UserProjectionSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  active: Type.Boolean(),
  capabilities: Type.Array(Type.String()),
}, { additionalProperties: false });
export type UserProjectionEntry = StaticDecode<typeof UserProjectionSchema>;
