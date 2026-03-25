import { UserViewSchema as UserSchema } from "@trellis/auth";
import { PaginatedSchema } from "@trellis/contracts";
import Type, { type Static } from "typebox";
import { PaginateSchema } from "../../trellis/Paginate.ts";

export const ListUsersFilterSchema = Type.Object({
  name: Type.Optional(Type.String()),
});
export type ListUsersFilter = Static<typeof ListUsersFilterSchema>;

export const ListUsersSchema = Type.Intersect([
  PaginateSchema,
  Type.Object({
    filter: ListUsersFilterSchema,
  }),
]);
export type ListUsers = Static<typeof ListUsersSchema>;

export const ListUsersResponseSchema = Type.Intersect([
  PaginatedSchema,
  Type.Object({
    users: Type.Array(UserSchema, { default: [] }),
  }),
]);
export type ListUsersResponse = Static<typeof ListUsersResponseSchema>;
