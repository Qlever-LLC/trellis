import type { StaticDecode } from "typebox";
import { Type } from "typebox";

const SessionKeySchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{43}$",
});

const SignatureSchema = Type.String({
  pattern: "^[A-Za-z0-9_-]{86}$",
});

export const LoginQuerySchema = Type.Object({
  redirectTo: Type.String(),
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
  contract: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type LoginQuery = StaticDecode<typeof LoginQuerySchema>;

export const SentinelCredsSchema = Type.Object({
  jwt: Type.String(),
  seed: Type.String(),
}, { additionalProperties: false });

export type SentinelCreds = StaticDecode<typeof SentinelCredsSchema>;

export const ApprovalDecisionSchema = Type.Union([
  Type.Literal("approved"),
  Type.Literal("denied"),
]);

export type ApprovalDecision = StaticDecode<typeof ApprovalDecisionSchema>;

export const ContractApprovalSchema = Type.Object({
  contractDigest: Type.String(),
  contractId: Type.String(),
  displayName: Type.String(),
  description: Type.String(),
  kind: Type.String(),
  capabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export type ContractApproval = StaticDecode<typeof ContractApprovalSchema>;

export const BindRequestSchema = Type.Object({
  authToken: Type.String(),
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
}, { additionalProperties: false });

export type BindRequest = StaticDecode<typeof BindRequestSchema>;

export const BindSuccessResponseSchema = Type.Object({
  status: Type.Literal("bound"),
  bindingToken: Type.String(),
  inboxPrefix: Type.String(),
  expires: Type.String({ format: "date-time" }),
  sentinel: SentinelCredsSchema,
}, { additionalProperties: false });

export const BindInsufficientCapabilitiesResponseSchema = Type.Object({
  status: Type.Literal("insufficient_capabilities"),
  approval: ContractApprovalSchema,
  missingCapabilities: Type.Array(Type.String()),
  userCapabilities: Type.Array(Type.String()),
}, { additionalProperties: false });

export const BindResponseSchema = Type.Union([
  BindSuccessResponseSchema,
  BindInsufficientCapabilitiesResponseSchema,
]);

export type BindResponse = StaticDecode<typeof BindResponseSchema>;
export type BindSuccessResponse = StaticDecode<typeof BindSuccessResponseSchema>;
export type BindInsufficientCapabilitiesResponse = StaticDecode<
  typeof BindInsufficientCapabilitiesResponseSchema
>;

export const NatsAuthTokenV1Schema = Type.Object({
  v: Type.Literal(1),
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
  bindingToken: Type.Optional(Type.String()),
  iat: Type.Optional(Type.Integer()),
}, { additionalProperties: false });

export type NatsAuthTokenV1 = StaticDecode<typeof NatsAuthTokenV1Schema>;
