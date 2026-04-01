/**
 * @module
 *
 * Trellis server-side authentication library for session-key based authentication.
 *
 * - Session keys are Ed25519 keys represented as base64url (32-byte raw public key).
 * - Proofs are Ed25519 signatures over SHA-256(buildProofInput(...)).
 * - Services load their session key seed from `TRELLIS_SESSION_KEY_SEED`.
 */

export {
  type AuthConfig,
  bindSession,
  buildLoginUrl,
  clearSessionKey,
  createRpcProof,
  extractAuthErrorFromFragment,
  extractAuthTokenFromFragment,
  generateSessionKey,
  getOrCreateSessionKey,
  getPublicSessionKey,
  hasSessionKey,
  isBindSuccessResponse,
  loadSessionKey,
  natsConnectSigForBindingToken,
  type SessionKeyHandle,
  signBytes,
} from "./browser.ts";
export {
  buildProofInput,
  createProof,
  type ProofParams,
  verifyProof,
} from "./proof.ts";
export {
  ApprovalRecordViewSchema,
  AuthenticatedUserSchema,
  AuthGetInstalledContractResponseSchema,
  AuthGetInstalledContractSchema,
  AuthInstallServiceResponseSchema,
  AuthInstallServiceSchema,
  AuthListApprovalsResponseSchema,
  AuthListApprovalsSchema,
  AuthListInstalledContractsResponseSchema,
  AuthListInstalledContractsSchema,
  AuthListServicesResponseSchema,
  AuthListServicesSchema,
  AuthListUsersResponseSchema,
  AuthListUsersSchema,
  AuthMeResponseSchema,
  AuthMeSchema,
  AuthRemoveServiceResponseSchema,
  AuthRemoveServiceSchema,
  AuthRevokeApprovalResponseSchema,
  AuthRevokeApprovalSchema,
  AuthUpdateUserResponseSchema,
  AuthUpdateUserSchema,
  AuthUpgradeServiceContractResponseSchema,
  AuthUpgradeServiceContractSchema,
  AuthValidateRequestResponseSchema,
  AuthValidateRequestSchema,
  ContractAnalysisSchema,
  ContractAnalysisSummarySchema,
  DigestSchema,
  InstalledContractDetailSchema,
  InstalledContractSchema,
  OpenObjectSchema,
  ServiceViewSchema,
  UserViewSchema,
} from "./protocol.ts";
export {
  type ApprovalDecision,
  ApprovalDecisionSchema,
  type BindRequest,
  BindRequestSchema,
  type BindResponse,
  BindResponseSchema,
  type BindSuccessResponse,
  BindSuccessResponseSchema,
  type ContractApproval,
  ContractApprovalSchema,
  type LoginQuery,
  LoginQuerySchema,
  type NatsAuthTokenV1,
  NatsAuthTokenV1Schema,
  type SentinelCreds,
  SentinelCredsSchema,
} from "./schemas.ts";
export { createAuth, type NatsConnectOptions, type TrellisAuth } from "./session_auth.ts";
export { trellisIdFromOriginId } from "./trellis_id.ts";
export {
  base64urlDecode,
  base64urlEncode,
  sha256,
  toArrayBuffer,
  utf8,
} from "./utils.ts";
