import Type, { type Static } from "typebox";
import { UserSchema } from "../models/User.ts";
import { TrellisIDSchema } from "../../trellis/TrellisID.ts";

export const FindUserSchema = Type.Object({
  userId: TrellisIDSchema,
});
export type FindUser = Static<typeof FindUserSchema>;

export const FindUserResponseSchema = Type.Object({
  user: UserSchema,
});
export type FindUserResponse = Static<typeof FindUserResponseSchema>;
