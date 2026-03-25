import Type, { type Static } from "typebox";

export const ContractKvResourceSchema = Type.Object({
  purpose: Type.String({ minLength: 1 }),
  required: Type.Optional(Type.Boolean({ default: true })),
  history: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  ttlMs: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  maxValueBytes: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export type ContractKvResource = Static<typeof ContractKvResourceSchema>;

export const ContractResourcesSchema = Type.Object({
  kv: Type.Optional(Type.Record(Type.String({ minLength: 1 }), ContractKvResourceSchema)),
});

export type ContractResources = Static<typeof ContractResourcesSchema>;

export const KvResourceBindingSchema = Type.Object({
  bucket: Type.String({ minLength: 1 }),
  history: Type.Integer({ minimum: 1 }),
  ttlMs: Type.Integer({ minimum: 0 }),
  maxValueBytes: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export type KvResourceBinding = Static<typeof KvResourceBindingSchema>;

export const ContractResourceBindingsSchema = Type.Object({
  kv: Type.Optional(Type.Record(Type.String({ minLength: 1 }), KvResourceBindingSchema)),
});

export type ContractResourceBindings = Static<typeof ContractResourceBindingsSchema>;

export const InstalledServiceContractSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  digest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  resources: ContractResourceBindingsSchema,
}, { additionalProperties: false });

export type InstalledServiceContract = Static<typeof InstalledServiceContractSchema>;
