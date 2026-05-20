import Type, { type Static } from "typebox";

export const TrellisCatalogEntrySchema = Type.Object({
  id: Type.String(),
  digest: Type.String(),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
});

export const TrellisCatalogIssueSchema = Type.Object({
  issueId: Type.String({ minLength: 1 }),
  kind: Type.Union([
    Type.Literal("missing-active-contract"),
    Type.Literal("invalid-active-contract"),
    Type.Literal("incompatible-active-contract"),
    Type.Literal("invalid-active-contract-uses"),
  ]),
  contractId: Type.Optional(Type.String()),
  digest: Type.Optional(Type.String()),
  message: Type.String({ minLength: 1 }),
  deploymentIds: Type.Array(Type.String()),
  effectiveDigests: Type.Optional(Type.Array(Type.String())),
  conflictingDigest: Type.Optional(Type.String()),
  conflictingDigests: Type.Optional(Type.Array(Type.String())),
  effectiveDeploymentIds: Type.Optional(Type.Array(Type.String())),
  conflictingDeploymentIds: Type.Optional(Type.Array(Type.String())),
  actions: Type.Array(Type.Object({
    action: Type.Union([
      Type.Literal("keep-current"),
      Type.Literal("force-replace"),
    ]),
    label: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    risk: Type.Union([Type.Literal("recommended"), Type.Literal("dangerous")]),
    deploymentIds: Type.Array(Type.String()),
    digests: Type.Array(Type.String()),
  })),
});

export const TrellisCatalogSchema = Type.Object({
  format: Type.Literal("trellis.catalog.v1"),
  contracts: Type.Array(TrellisCatalogEntrySchema),
  issues: Type.Optional(Type.Array(TrellisCatalogIssueSchema)),
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
