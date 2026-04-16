import Type, { type Static } from "typebox";

export const AuthListConnectionsSchema = Type.Object(
  {
    user: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
  },
);
export type AuthListConnectionsInput = Static<typeof AuthListConnectionsSchema>;

export const AuthListConnectionsResponseSchema = Type.Object(
  {
    connections: Type.Array(
      Type.Object(
        {
          key: Type.String(),
          serverId: Type.String(),
          clientId: Type.Number(),
          connectedAt: Type.String(),
        },
      ),
    ),
  },
);
export type AuthListConnectionsResponse = Static<
  typeof AuthListConnectionsResponseSchema
>;
