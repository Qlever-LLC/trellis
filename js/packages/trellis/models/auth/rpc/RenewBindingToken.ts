import Type, { type Static } from "typebox";

export const AuthRenewBindingTokenSchema = Type.Object(
  {},
  { additionalProperties: false },
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
      { additionalProperties: false },
    ),
    natsServers: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type AuthRenewBindingTokenResponse = Static<
  typeof AuthRenewBindingTokenResponseSchema
>;
