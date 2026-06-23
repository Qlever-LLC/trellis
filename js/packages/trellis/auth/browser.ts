/**
 * @module
 * Browser-based authentication utilities for session-key based authentication.
 * Uses WebCrypto API and IndexedDB for secure key storage.
 */

export {
  type AuthConfig,
  type AuthStartFlowResponse,
  type AuthStartRequest,
  type AuthStartResponse,
  bindFlow,
  type BindResponse,
  type BindSuccessResponse,
  buildLoginUrl,
  isBindSuccessResponse,
  type SentinelCreds,
  startAuthRequest,
} from "./browser/login.ts";
export {
  type BrowserLogoutInput,
  type BrowserLogoutResponse,
  completeBrowserLogout,
  type CompleteBrowserLogoutArgs,
} from "./browser/logout.ts";
export {
  type ApprovalDecision,
  fetchPortalFlowState,
  portalFlowIdFromUrl,
  type PortalFlowState,
  type PortalFlowState as BrowserPortalFlowState,
  portalProviderLoginUrl,
  portalRedirectLocation,
  submitPortalApproval,
} from "./browser/portal.ts";
export {
  bindFlowSig,
  clearSessionKey,
  createRpcProof,
  generateSessionKey,
  getOrCreateSessionKey,
  getPublicSessionKey,
  hasSessionKey,
  loadSessionKey,
  natsConnectSigForIat,
  type SessionKeyHandle,
  type SessionKeyOptions,
  type SessionKeyPersistenceMode,
  signBytes,
} from "./browser/session.ts";
export { deleteKeyPair, hasKeyPair } from "./browser/storage.ts";
export {
  classifyBrowserAuthError,
  isRecoverableBrowserAuthError,
} from "./browser_recovery.ts";
export type {
  BrowserAuthRecoveryClassification,
  BrowserAuthRecoveryKind,
} from "./browser_recovery.ts";
export {
  approvalCapabilityKeys,
  type ApprovalDecision as ApprovalDecisionData,
  ApprovalDecisionSchema,
  type AuthStartFlowResponse as AuthStartFlowResponseData,
  AuthStartFlowResponseSchema,
  type AuthStartRequest as AuthStartRequestData,
  AuthStartRequestSchema,
  type AuthStartResponse as AuthStartResponseData,
  AuthStartResponseSchema,
  type BindResponse as BindResponseData,
  BindResponseSchema,
  type BindSuccessResponse as BindSuccessResponseData,
  BindSuccessResponseSchema,
  type ClientTransportEndpoints as ClientTransportEndpointsData,
  ClientTransportEndpointsSchema,
  type ClientTransports as ClientTransportsData,
  ClientTransportsSchema,
  type ContractApproval as ContractApprovalData,
  type ContractApprovalCapability as ContractApprovalCapabilityData,
  ContractApprovalSchema,
  type NatsAuthTokenV1 as NatsAuthTokenV1Data,
  NatsAuthTokenV1Schema,
  type SentinelCreds as SentinelCredsData,
  SentinelCredsSchema,
} from "./schemas.ts";

export type { NatsAuthTokenV1 } from "./types.ts";
export {
  base64urlDecode,
  base64urlEncode,
  sha256,
  toArrayBuffer,
  utf8,
} from "./utils.ts";
