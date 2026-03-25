import { type Static, Type } from "typebox";

export const ServiceAuthSchema = Type.Object({
  name: Type.String(),
  version: Type.Optional(Type.String()),
});
export type ServiceAuth = Static<typeof ServiceAuthSchema>;

export const ServiceAuthResponseSchema = Type.Object({
  token: Type.String(),
  expiresAt: Type.String(),
});
export type ServiceAuthResponse = Static<typeof ServiceAuthResponseSchema>;
