import Type from "typebox";

export const GroupsListRequest = Type.Object({});
export const GroupsListResponse = Type.Object({
  groups: Type.Array(Type.String({ minLength: 1 })),
});
