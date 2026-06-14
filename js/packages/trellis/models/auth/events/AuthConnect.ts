import Type, { type Static } from "typebox";

export const AuthConnectionsOpenedEventSchema = Type.Object({
  origin: Type.String(),
  id: Type.String(),
  sessionKey: Type.String(),
  userNkey: Type.String(),
});

export type AuthConnectionsOpenedEvent = Static<
  typeof AuthConnectionsOpenedEventSchema
>;
