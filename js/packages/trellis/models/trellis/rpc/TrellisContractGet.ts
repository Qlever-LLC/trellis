import Type, { type Static } from "typebox";

import { ContractResourcesSchema } from "../ContractResources.ts";

const OpenValueSchema = Type.Unsafe<Record<string, unknown>>({ type: "object" });
const OpenSchemaValueSchema = Type.Unsafe<Record<string, unknown> | boolean>({
  anyOf: [{ type: "object" }, { type: "boolean" }],
});

export const TrellisContractSchema = Type.Object({
  format: Type.Literal("trellis.contract.v1"),
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  schemas: Type.Optional(Type.Record(Type.String({ minLength: 1 }), OpenSchemaValueSchema)),
  uses: Type.Optional(Type.Record(Type.String({ minLength: 1 }), OpenValueSchema)),
  rpc: Type.Optional(Type.Record(Type.String({ minLength: 1 }), OpenValueSchema)),
  events: Type.Optional(Type.Record(Type.String({ minLength: 1 }), OpenValueSchema)),
  subjects: Type.Optional(Type.Record(Type.String({ minLength: 1 }), OpenValueSchema)),
  errors: Type.Optional(Type.Record(Type.String({ minLength: 1 }), OpenValueSchema)),
  resources: Type.Optional(ContractResourcesSchema),
});
export type TrellisContract = Static<typeof TrellisContractSchema>;

export const TrellisContractGetRequestSchema = Type.Object({
  digest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
}, { additionalProperties: false });
export type TrellisContractGetRequest = Static<
  typeof TrellisContractGetRequestSchema
>;

export const TrellisContractGetResponseSchema = Type.Object({
  contract: TrellisContractSchema,
}, { additionalProperties: false });
export type TrellisContractGetResponse = Static<
  typeof TrellisContractGetResponseSchema
>;
