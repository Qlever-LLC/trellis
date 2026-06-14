import Type, { type Static } from "typebox";

export const AuthConnectionsKickedEventSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  userNkey: Type.String(),
  kickedBy: Type.String(),
});

export type AuthConnectionsKickedEvent = Static<
  typeof AuthConnectionsKickedEventSchema
>;
