import Type, { type Static } from "typebox";

export const AuthConnectionsClosedEventSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  sessionKey: Type.String(),
  userNkey: Type.String(),
});

export type AuthConnectionsClosedEvent = Static<
  typeof AuthConnectionsClosedEventSchema
>;
