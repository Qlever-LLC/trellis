import Type, { type Static } from "typebox";

export const TrellisSurfaceStatusRequestSchema = Type.Object({
  contractId: Type.String({ minLength: 1 }),
  kind: Type.Union([
    Type.Literal("rpc"),
    Type.Literal("operation"),
    Type.Literal("event"),
    Type.Literal("feed"),
  ]),
  surface: Type.String({ minLength: 1 }),
  action: Type.Optional(
    Type.Union([
      Type.Literal("call"),
      Type.Literal("publish"),
      Type.Literal("subscribe"),
      Type.Literal("observe"),
    ]),
  ),
});
export type TrellisSurfaceStatusRequest = Static<
  typeof TrellisSurfaceStatusRequestSchema
>;

export const TrellisSurfaceStatusResponseSchema = Type.Object({
  status: Type.Union([
    Type.Object({
      state: Type.Literal("available"),
      liveImplementer: Type.Boolean(),
      runtime: Type.Union([
        Type.Literal("live"),
        Type.Literal("no_live_implementer"),
        Type.Literal("disabled"),
      ]),
    }),
    Type.Object({
      state: Type.Literal("unavailable"),
      reason: Type.Union([
        Type.Literal("authority_unavailable"),
      ]),
    }),
    Type.Object({
      state: Type.Literal("unauthorized"),
      missingCapabilities: Type.Array(Type.String()),
    }),
    Type.Object({
      state: Type.Literal("unknown_contract"),
      contractId: Type.String({ minLength: 1 }),
    }),
    Type.Object({
      state: Type.Literal("unknown_surface"),
      contractId: Type.String({ minLength: 1 }),
      kind: Type.String({ minLength: 1 }),
      surface: Type.String({ minLength: 1 }),
    }),
  ]),
});
export type TrellisSurfaceStatusResponse = Static<
  typeof TrellisSurfaceStatusResponseSchema
>;
