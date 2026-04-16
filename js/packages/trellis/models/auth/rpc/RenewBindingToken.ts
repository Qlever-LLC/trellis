import Type, { type Static } from "typebox";

export const AuthRenewBindingTokenSchema = Type.Object(
  {},
);
export type AuthRenewBindingTokenInput = Static<
  typeof AuthRenewBindingTokenSchema
>;

export const AuthRenewBindingTokenResponseSchema = Type.Object(
  {
    status: Type.Literal("bound"),
    bindingToken: Type.String(),
    inboxPrefix: Type.String(),
    expires: Type.String(),
    sentinel: Type.Object(
      {
        jwt: Type.String(),
        seed: Type.String(),
      },
    ),
    transports: Type.Object(
      {
        native: Type.Optional(Type.Object({
          natsServers: Type.Array(Type.String()),
        })),
        websocket: Type.Optional(Type.Object({
          natsServers: Type.Array(Type.String()),
        })),
      },
    ),
  },
);
export type AuthRenewBindingTokenResponse = Static<
  typeof AuthRenewBindingTokenResponseSchema
>;
