import Type, { type Static } from "typebox";
import { EventHeaderSchema } from "../../trellis/EventHeader.ts";

export const AuthSessionRevokedEventSchema = Type.Intersect([
  EventHeaderSchema,
  Type.Object({
    origin: Type.String(),
    id: Type.String(),
    sessionKey: Type.String(),
    revokedBy: Type.String(),
  }),
]);

export type AuthSessionRevokedEvent = Static<
  typeof AuthSessionRevokedEventSchema
>;
