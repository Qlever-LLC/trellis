import Type, { type Static } from "typebox";
import { TrellisIDSchema } from "../../trellis/TrellisID.ts";

export const DeleteUserSchema = Type.Object(
  {
    userId: TrellisIDSchema,
  },
  { additionalProperties: false },
);
export type DeleteUser = Static<typeof DeleteUserSchema>;

export const DeleteUserResponseSchema = Type.Object(
  {
    deleted: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type DeleteUserResponse = Static<typeof DeleteUserResponseSchema>;
