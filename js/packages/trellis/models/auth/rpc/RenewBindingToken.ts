import Type, { type Static } from "typebox";

export const AuthRenewBindingTokenSchema = Type.Object(
  {
    contractDigest: Type.String(),
  },
  { additionalProperties: false },
);
export type AuthRenewBindingTokenInput = Static<
  typeof AuthRenewBindingTokenSchema
>;

export const AuthRenewBindingTokenBoundResponseSchema = Type.Object(
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
    transports: Type.Object(
      {
        native: Type.Optional(Type.Object({
          natsServers: Type.Array(Type.String()),
        }, { additionalProperties: false })),
        websocket: Type.Optional(Type.Object({
          natsServers: Type.Array(Type.String()),
        }, { additionalProperties: false })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AuthRenewBindingTokenContractChangedResponseSchema = Type.Object(
  {
    status: Type.Literal("contract_changed"),
  },
  { additionalProperties: false },
);

export const AuthRenewBindingTokenResponseSchema = Type.Union([
  AuthRenewBindingTokenBoundResponseSchema,
  AuthRenewBindingTokenContractChangedResponseSchema,
]);

export type AuthRenewBindingTokenBoundResponse = Static<
  typeof AuthRenewBindingTokenBoundResponseSchema
>;
export type AuthRenewBindingTokenContractChangedResponse = Static<
  typeof AuthRenewBindingTokenContractChangedResponseSchema
>;
export type AuthRenewBindingTokenResponse = Static<
  typeof AuthRenewBindingTokenResponseSchema
>;
