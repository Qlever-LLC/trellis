import Type, { type Static } from "typebox";
import { EventHeaderSchema } from "../../trellis/EventHeader.ts";

export const AuthConnectEventSchema = Type.Intersect([
  EventHeaderSchema,
  Type.Object({
    origin: Type.String(),
    id: Type.String(),
    sessionKey: Type.String(),
    userNkey: Type.String(),
  }),
]);

export type AuthConnectEvent = Static<typeof AuthConnectEventSchema>;
