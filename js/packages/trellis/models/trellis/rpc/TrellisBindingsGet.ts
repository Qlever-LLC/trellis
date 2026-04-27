import Type, { type Static } from "typebox";

import { InstalledServiceContractSchema } from "../ContractResources.ts";

export const TrellisBindingsGetRequestSchema = Type.Object({
  contractId: Type.Optional(Type.String({ minLength: 1 })),
  digest: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9_-]+$" })),
});

export type TrellisBindingsGetRequest = Static<
  typeof TrellisBindingsGetRequestSchema
>;

export const TrellisBindingsGetResponseSchema = Type.Object({
  binding: Type.Optional(InstalledServiceContractSchema),
});

export type TrellisBindingsGetResponse = Static<
  typeof TrellisBindingsGetResponseSchema
>;
