import { type Static, Type } from "typebox";

import type {
  AuthorizationContextVerificationPolicy,
  PermissionAtom,
} from "../protocol_wasm.ts";

/** Pinned root and connected NATS KV registry binding. */
export const AuthorizationRegistryBindingSchema = Type.Object({
  trustBucket: Type.String({ minLength: 1 }),
  contextBucket: Type.String({ minLength: 1 }),
});

/** Wire binding for Trellis' internal authorization registry. */
export type AuthorizationRegistryBinding = Static<
  typeof AuthorizationRegistryBindingSchema
>;

/** Wire schema for bootstrap authorization trust material. */
export const AuthorizationTrustBundleSchema = Type.Object({
  root: Type.Unknown(),
  manifest: Type.Unknown(),
  authorizationRegistry: AuthorizationRegistryBindingSchema,
  policy: Type.Object({
    allowedClockSkewSeconds: Type.Integer({ minimum: 0 }),
    maximumContextLifetimeSeconds: Type.Integer({ minimum: 1 }),
    // Canonical signed-context JSON size in UTF-8 bytes.
    maximumContextBytes: Type.Integer({ minimum: 1 }),
    maximumPermissions: Type.Integer({ minimum: 1 }),
    maximumCapabilities: Type.Integer({ minimum: 1 }),
    refreshLeadSeconds: Type.Integer({ minimum: 1 }),
    refreshJitterSeconds: Type.Integer({ minimum: 0 }),
  }),
});

/** Bootstrap authorization trust material. */
export type AuthorizationTrustBundle = Static<
  typeof AuthorizationTrustBundleSchema
>;

/** Wire schema for one published authorization context bundle. */
export const AuthorizationContextBundleSchema = Type.Object({
  context: Type.Unknown(),
  trust: AuthorizationTrustBundleSchema,
});

/** Published signed context and the trust information needed to verify it. */
export type AuthorizationContextBundle = Static<
  typeof AuthorizationContextBundleSchema
>;

/** Route-selection JWT installed atomically with a context. */
export type AuthorizationRoutingMaterial = {
  bootstrapJwt: string;
  bootstrapJwtExpiresAt: number;
};

/** Stable session evidence retained across short-lived context expiry. */
export type AuthorizationSessionBinding = {
  sessionId: string;
  participantDigest: string;
  needsDigest: string;
};

/** Transport endpoints retained for reconnect recovery. */
export type AuthorizationRuntimeTransports = {
  native?: { natsServers: string[] };
  websocket?: { natsServers: string[] };
};

/** Transport metadata retained for reconnect recovery. */
export type AuthorizationRuntimeBinding = {
  sessionId: string;
  participantId: string;
  participantArtifactDigest: string;
  participantNeedsDigest: string;
  inboxPrefix: string;
  transports: AuthorizationRuntimeTransports;
};

/** Trusted context projection returned by the Rust/WASM verifier. */
export type VerifiedAuthorizationContext = {
  authority: string;
  rootKeyId: string;
  rootDigest: string;
  manifestDigest: string;
  contextDigest: string;
  manifestGeneration: number;
  refreshAt: number;
  context: Record<string, unknown> & {
    sessionId: string;
    participant: {
      id: string;
      artifactDigest: string;
      needsDigest: string;
    };
    inboxPrefix: string;
    issuedAt: number;
    notBefore: number;
    expiresAt: number;
  };
};

/** Installed trust material that a provider-side verifier may reuse. */
export type AuthorizationContextVerificationMaterial = {
  root: unknown;
  manifest: unknown;
  context: unknown;
  contextDigest: string;
  policy: AuthorizationContextVerificationPolicy;
  verified: VerifiedAuthorizationContext;
};

/** Durable rollback floor for one authorization authority. */
export type AuthorizationTrustState = {
  format: "trellis.authorization-client-trust.v1";
  authority: string;
  rootKeyId: string;
  rootDigest: string;
  minimumManifestGeneration: number;
  manifestDigestAtMinimumGeneration: string;
};

/** Atomically persisted trust floor and current context for one client binding. */
export type AuthorizationClientState = {
  format: "trellis.authorization-client-state.v1";
  binding: string;
  trust: AuthorizationTrustState;
  session: AuthorizationSessionBinding | null;
  context: AuthorizationContextBundle | null;
  contextDigest: string | null;
  contextExpiresAt: number | null;
  routing: AuthorizationRoutingMaterial | null;
  serverClockOffsetMs: number;
  runtime?: AuthorizationRuntimeBinding;
};

/** Presented request proof data supplied by a provider transport adapter. */
export type AuthorizationProviderRequest = {
  contextDigest: string;
  subject: string;
  reply: string | null;
  payload: Uint8Array;
  iat: number;
  requestId: string;
  proof: string;
  requiredPermissions: PermissionAtom[];
  requiredCapabilities: string[];
};

/** Presented event proof data supplied by a provider event adapter. */
export type AuthorizationProviderEvent = {
  contextDigest: string;
  subject: string;
  payload: Uint8Array;
  eventId: string;
  eventTime: string;
  proof: string;
  requiredPermissions: PermissionAtom[];
  requiredCapabilities: string[];
};

/** Proactive refresh response returned by the Rust auth service. */
export const AuthorizationContextRefreshResponseSchema = Type.Object({
  serverNow: Type.Integer({ minimum: 0 }),
  authorizationContext: AuthorizationContextBundleSchema,
  session: Type.Object({
    sessionId: Type.String({ minLength: 1 }),
    principalId: Type.String({ minLength: 1 }),
    principalKind: Type.Union([
      Type.Literal("user"),
      Type.Literal("service"),
      Type.Literal("device"),
    ]),
    participantId: Type.String({ minLength: 1 }),
    participantKind: Type.Union([
      Type.Literal("service"),
      Type.Literal("app"),
      Type.Literal("device"),
      Type.Literal("agent"),
    ]),
    participantArtifactDigest: Type.String({ minLength: 1 }),
    participantNeedsDigest: Type.String({ minLength: 1 }),
    sessionPublicKey: Type.String({ minLength: 1 }),
    sessionKeyId: Type.String({ minLength: 1 }),
    inboxPrefix: Type.String({ minLength: 1 }),
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("expired"),
      Type.Literal("revoked"),
    ]),
    createdAt: Type.Integer({ minimum: 0 }),
    lastSeenAt: Type.Integer({ minimum: 0 }),
    expiresAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    revokedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    version: Type.Integer({ minimum: 1 }),
  }),
  nats: Type.Object({
    jwt: Type.String({ minLength: 1 }),
    jwtExpiresAt: Type.Integer({ minimum: 1 }),
    transports: Type.Object({
      native: Type.Optional(Type.Object({
        natsServers: Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
        }),
      })),
      websocket: Type.Optional(Type.Object({
        natsServers: Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
        }),
      })),
    }),
  }),
});

/** Proactive refresh response with its verified installed context. */
export type AuthorizationContextRefreshResponse = Static<
  typeof AuthorizationContextRefreshResponseSchema
>;

/** Result returned by the metadata-preserving refresh helper. */
export type AuthorizationContextRefreshResult = {
  context: VerifiedAuthorizationContext;
  response: AuthorizationContextRefreshResponse;
};
