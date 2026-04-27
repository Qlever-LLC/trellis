import type { StaticDecode } from "typebox";
import { Type } from "typebox";

export interface NatsClientInfo {
  ip?: string;
  host?: string;
  id?: number;
}

export const NatsClientInfoSchema = Type.Object({
  ip: Type.Optional(Type.String()),
  host: Type.Optional(Type.String()),
  id: Type.Optional(Type.Number()),
}, { additionalProperties: true });

export interface NatsConnectOpts {
  auth_token?: string;
  jwt?: string;
  nkey?: string;
}

export const NatsConnectOptsSchema = Type.Object({
  auth_token: Type.Optional(Type.String()),
  jwt: Type.Optional(Type.String()),
  nkey: Type.Optional(Type.String()),
}, { additionalProperties: true });

export interface NatsAuthRequest {
  user_nkey?: string;
  server_id?: { name?: string; id?: string };
  client_info?: NatsClientInfo;
  connect_opts?: NatsConnectOpts;
}

export const NatsAuthRequestSchema = Type.Object({
  user_nkey: Type.Optional(Type.String()),
  server_id: Type.Optional(Type.Object({
    name: Type.Optional(Type.String()),
    id: Type.Optional(Type.String()),
  }, { additionalProperties: true })),
  client_info: Type.Optional(NatsClientInfoSchema),
  connect_opts: Type.Optional(NatsConnectOptsSchema),
}, { additionalProperties: true });

export interface AuthCalloutClaims {
  nats?: NatsAuthRequest;
  sub?: string;
}

export const AuthCalloutClaimsSchema = Type.Object({
  nats: Type.Optional(NatsAuthRequestSchema),
  sub: Type.Optional(Type.String()),
}, { additionalProperties: true });

export type AuthCalloutClaimsData = StaticDecode<
  typeof AuthCalloutClaimsSchema
>;

export const NatsDisconnectEventSchema = Type.Object({
  client: Type.Optional(Type.Object({
    user_nkey: Type.Optional(Type.String()),
  }, { additionalProperties: true })),
}, { additionalProperties: true });

export type NatsDisconnectEvent = StaticDecode<
  typeof NatsDisconnectEventSchema
>;
