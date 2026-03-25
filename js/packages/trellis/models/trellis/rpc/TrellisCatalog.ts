import Type, { type Static } from "typebox";

export const TrellisCatalogEntrySchema = Type.Object({
  id: Type.String(),
  digest: Type.String(),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const TrellisCatalogSchema = Type.Object({
  format: Type.Literal("trellis.catalog.v1"),
  contracts: Type.Array(TrellisCatalogEntrySchema),
}, { additionalProperties: false });

export type TrellisCatalog = Static<typeof TrellisCatalogSchema>;

export const TrellisCatalogRequestSchema = Type.Object({}, {
  additionalProperties: false,
});
export type TrellisCatalogRequest = Static<typeof TrellisCatalogRequestSchema>;

export const TrellisCatalogResponseSchema = Type.Object({
  catalog: TrellisCatalogSchema,
}, { additionalProperties: false });
export type TrellisCatalogResponse = Static<
  typeof TrellisCatalogResponseSchema
>;
