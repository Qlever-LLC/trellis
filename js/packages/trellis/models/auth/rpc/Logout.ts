import Type, { type Static } from "typebox";

export const AuthSessionsLogoutSchema = Type.Object(
  {
    browser: Type.Optional(Type.Object({
      returnTo: Type.Optional(Type.String({ format: "uri" })),
      includeProviderLogout: Type.Optional(Type.Boolean()),
      federatedProviderLogout: Type.Optional(Type.Boolean()),
    })),
  },
);
export type AuthSessionsLogoutInput = Static<typeof AuthSessionsLogoutSchema>;

export const AuthSessionsLogoutResponseSchema = Type.Object(
  {
    success: Type.Boolean(),
    providerLogoutUrl: Type.Optional(Type.String({ format: "uri" })),
  },
);
export type AuthSessionsLogoutResponse = Static<
  typeof AuthSessionsLogoutResponseSchema
>;
