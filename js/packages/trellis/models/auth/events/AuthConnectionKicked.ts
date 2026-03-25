import Type, { type Static } from "typebox";
import { EventHeaderSchema } from "../../trellis/EventHeader.ts";

export const AuthConnectionKickedEventSchema = Type.Intersect([
  EventHeaderSchema,
  Type.Object({
    origin: Type.String(),
    id: Type.String(),
    userNkey: Type.String(),
    kickedBy: Type.String(),
  }),
]);

export type AuthConnectionKickedEvent = Static<
  typeof AuthConnectionKickedEventSchema
>;
