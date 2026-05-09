import Type, { type Static } from "typebox";

export const AuthConnectionsKickSchema = Type.Object(
  {
    userNkey: Type.String(),
  },
);
export type AuthConnectionsKickInput = Static<typeof AuthConnectionsKickSchema>;

export const AuthConnectionsKickResponseSchema = Type.Object(
  { success: Type.Boolean() },
);
export type AuthConnectionsKickResponse = Static<
  typeof AuthConnectionsKickResponseSchema
>;
