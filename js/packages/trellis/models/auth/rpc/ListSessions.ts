import Type, { type Static } from "typebox";

export const AuthListSessionsSchema = Type.Object(
  {
    user: Type.Optional(Type.String()),
  },
);
export type AuthListSessionsInput = Static<typeof AuthListSessionsSchema>;

export const AuthListSessionsResponseSchema = Type.Object(
  {
    sessions: Type.Array(
      Type.Object(
        {
          key: Type.String(),
          type: Type.Union([
            Type.Literal("user"),
            Type.Literal("service"),
            Type.Literal("device"),
          ]),
          createdAt: Type.String(),
          lastAuth: Type.String(),
        },
      ),
    ),
  },
);
export type AuthListSessionsResponse = Static<
  typeof AuthListSessionsResponseSchema
>;
