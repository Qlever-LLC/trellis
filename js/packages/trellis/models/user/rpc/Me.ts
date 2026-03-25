import Type, { type Static } from "typebox";
import { UserSchema } from "../models/User.ts";

export const MeSchema = Type.Object({});
export type Me = Static<typeof MeSchema>;

export const MeResponseSchema = Type.Object({
  user: UserSchema,
});
export type MeResponse = Static<typeof MeResponseSchema>;
