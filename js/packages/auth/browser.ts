/**
 * @module
 * Browser-based authentication utilities for session-key based authentication.
 * Uses WebCrypto API and IndexedDB for secure key storage.
 */


export {
  type AuthConfig,
  type BindResponse,
  type BindSuccessResponse,
  bindFlow,
  bindSession,
  buildLoginUrl,
  isBindSuccessResponse,
  type SentinelCreds,
} from "./browser/login.ts";
export {
  fetchPortalFlowState,
  portalFlowIdFromUrl,
  portalProviderLoginUrl,
  portalRedirectLocation,
  submitPortalApproval,
  type ApprovalDecision,
  type PortalFlowState as BrowserPortalFlowState,
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
  natsConnectSigForBindingToken,
  type SessionKeyHandle,
  signBytes,
} from "./browser/session.ts";
export { deleteKeyPair, hasKeyPair } from "./browser/storage.ts";
export {
  type BindResponse as BindResponseData,
  BindResponseSchema,
  type BindSuccessResponse as BindSuccessResponseData,
  BindSuccessResponseSchema,
  type ContractApproval as ContractApprovalData,
  ContractApprovalSchema,
  type NatsAuthTokenV1 as NatsAuthTokenV1Data,
  NatsAuthTokenV1Schema,
  type ApprovalDecision as ApprovalDecisionData,
  ApprovalDecisionSchema,
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
