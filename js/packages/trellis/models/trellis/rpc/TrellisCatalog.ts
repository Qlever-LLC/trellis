import Type, { type Static } from "typebox";

export const TrellisCatalogEntrySchema = Type.Object({
  id: Type.String(),
  digest: Type.String(),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
});

export const TrellisCatalogSchema = Type.Object({
  format: Type.Literal("trellis.catalog.v1"),
  contracts: Type.Array(TrellisCatalogEntrySchema),
});

export type TrellisCatalog = Static<typeof TrellisCatalogSchema>;

export const TrellisCatalogRequestSchema = Type.Object({});
export type TrellisCatalogRequest = Static<typeof TrellisCatalogRequestSchema>;

export const TrellisCatalogResponseSchema = Type.Object({
  catalog: TrellisCatalogSchema,
});
export type TrellisCatalogResponse = Static<
  typeof TrellisCatalogResponseSchema
>;
