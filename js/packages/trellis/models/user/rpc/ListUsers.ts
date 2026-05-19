import { UserViewSchema as UserSchema } from "../../../auth.ts";
import Type, { type Static } from "typebox";
import { PageResponseSchema } from "../../trellis/Page.ts";

export const ListUsersFilterSchema = Type.Object({
  name: Type.Optional(Type.String()),
});
export type ListUsersFilter = Static<typeof ListUsersFilterSchema>;

export const ListUsersSchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 0 }),
  filter: ListUsersFilterSchema,
});
export type ListUsers = Static<typeof ListUsersSchema>;

export const ListUsersResponseSchema = PageResponseSchema(UserSchema);
export type ListUsersResponse = Static<typeof ListUsersResponseSchema>;
