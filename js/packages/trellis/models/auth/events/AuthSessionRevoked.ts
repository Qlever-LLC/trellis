import Type, { type Static } from "typebox";

export const AuthSessionsRevokedEventSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  sessionKey: Type.String(),
  revokedBy: Type.String(),
});

export type AuthSessionsRevokedEvent = Static<
  typeof AuthSessionsRevokedEventSchema
>;
