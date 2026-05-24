//! Shared request and response types for `trellis.auth@v1`.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
/// Generated schema type `AuthCapabilitiesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilitiesListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthCapabilitiesListResponse`.
/// Generated schema type `AuthCapabilitiesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilitiesListResponseEntriesItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consequence: Option<String>,
    #[serde(rename = "contractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_digest: Option<String>,
    #[serde(rename = "contractDisplayName")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_display_name: Option<String>,
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub key: String,
    pub source: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilitiesListResponse {
    pub count: i64,
    pub entries: Vec<AuthCapabilitiesListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthCapabilityGroupsDeleteRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsDeleteRequest {
    #[serde(rename = "groupKey")]
    pub group_key: String,
}
/// Generated schema type `AuthCapabilityGroupsDeleteResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsDeleteResponse {
    pub success: bool,
}
/// Generated schema type `AuthCapabilityGroupsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsGetRequest {
    #[serde(rename = "groupKey")]
    pub group_key: String,
}
/// Generated schema type `AuthCapabilityGroupsGetResponse`.
/// Generated schema type `AuthCapabilityGroupsGetResponseGroup`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsGetResponseGroup {
    pub capabilities: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "groupKey")]
    pub group_key: String,
    #[serde(rename = "includedGroups")]
    pub included_groups: Vec<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsGetResponse {
    pub group: AuthCapabilityGroupsGetResponseGroup,
}
/// Generated schema type `AuthCapabilityGroupsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthCapabilityGroupsListResponse`.
/// Generated schema type `AuthCapabilityGroupsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsListResponseEntriesItem {
    pub capabilities: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "groupKey")]
    pub group_key: String,
    #[serde(rename = "includedGroups")]
    pub included_groups: Vec<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsListResponse {
    pub count: i64,
    pub entries: Vec<AuthCapabilityGroupsListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthCapabilityGroupsPutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsPutRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "groupKey")]
    pub group_key: String,
    #[serde(rename = "includedGroups")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub included_groups: Option<Vec<String>>,
}
/// Generated schema type `AuthCapabilityGroupsPutResponse`.
/// Generated schema type `AuthCapabilityGroupsPutResponseGroup`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsPutResponseGroup {
    pub capabilities: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "groupKey")]
    pub group_key: String,
    #[serde(rename = "includedGroups")]
    pub included_groups: Vec<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsPutResponse {
    pub group: AuthCapabilityGroupsPutResponseGroup,
}
/// Generated schema type `AuthCatalogIssuesResolveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCatalogIssuesResolveRequest {
    pub action: Value,
    #[serde(rename = "issueId")]
    pub issue_id: String,
}
/// Generated schema type `AuthCatalogIssuesResolveResponse`.
/// Generated schema type `AuthCatalogIssuesResolveResponseDeletedEvidenceItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCatalogIssuesResolveResponseDeletedEvidenceItem {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "firstSeenAt")]
    pub first_seen_at: String,
    #[serde(rename = "ignoreReason")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_reason: Option<Value>,
    #[serde(rename = "ignoredAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_at: Option<Value>,
    #[serde(rename = "ignoredBy")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_by: Option<Value>,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCatalogIssuesResolveResponse {
    pub action: Value,
    #[serde(rename = "deletedEvidence")]
    pub deleted_evidence: Vec<AuthCatalogIssuesResolveResponseDeletedEvidenceItem>,
    #[serde(rename = "issueId")]
    pub issue_id: String,
    pub success: bool,
}
/// Generated schema type `AuthConnectionsKickRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsKickRequest {
    #[serde(rename = "userNkey")]
    pub user_nkey: String,
}
/// Generated schema type `AuthConnectionsKickResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsKickResponse {
    pub success: bool,
}
/// Generated schema type `AuthConnectionsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthConnectionsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListResponse {
    pub count: i64,
    pub entries: Vec<Value>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthDeploymentsCreateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsCreateRequest(pub Value);
/// Generated schema type `AuthDeploymentsCreateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsCreateResponse {
    pub deployment: Value,
}
/// Generated schema type `AuthDeploymentsDisableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsDisableRequest {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub kind: Value,
}
/// Generated schema type `AuthDeploymentsDisableResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsDisableResponse {
    pub deployment: Value,
}
/// Generated schema type `AuthDeploymentsEnableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsEnableRequest {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub kind: Value,
}
/// Generated schema type `AuthDeploymentsEnableResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsEnableResponse {
    pub deployment: Value,
}
/// Generated schema type `AuthDeploymentsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsListRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<Value>,
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthDeploymentsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsListResponse {
    pub count: i64,
    pub entries: Vec<Value>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthDeploymentsRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsRemoveRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cascade: Option<bool>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub kind: Value,
    #[serde(rename = "purgeUnusedContracts")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purge_unused_contracts: Option<bool>,
}
/// Generated schema type `AuthDeploymentsRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsRemoveResponse {
    pub success: bool,
}
/// Generated schema type `AuthDeviceUserAuthoritiesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListRequest {
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    #[serde(rename = "instanceId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Value>,
}
/// Generated schema type `AuthDeviceUserAuthoritiesListResponse`.
/// Generated schema type `AuthDeviceUserAuthoritiesListResponseEntriesItem`.
/// Generated schema type `AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedBy`.
/// Generated schema type `AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByIdentity {
    #[serde(rename = "identityId")]
    pub identity_id: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedBy {
    pub identity: AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByIdentity,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListResponseEntriesItem {
    #[serde(rename = "activatedAt")]
    pub activated_at: String,
    #[serde(rename = "activatedBy")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activated_by: Option<AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedBy>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Value,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListResponse {
    pub count: i64,
    pub entries: Vec<AuthDeviceUserAuthoritiesListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideRequest {
    pub decision: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "reviewId")]
    pub review_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponse`.
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseActivation`.
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedBy`.
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByIdentity {
    #[serde(rename = "identityId")]
    pub identity_id: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedBy {
    pub identity: AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByIdentity,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponseActivation {
    #[serde(rename = "activatedAt")]
    pub activated_at: String,
    #[serde(rename = "activatedBy")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activated_by: Option<AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedBy>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Value,
    pub state: Value,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseReview`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponseReview {
    #[serde(rename = "decidedAt")]
    pub decided_at: Value,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    #[serde(rename = "reviewId")]
    pub review_id: String,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activation: Option<AuthDeviceUserAuthoritiesReviewsDecideResponseActivation>,
    #[serde(rename = "confirmationCode")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation_code: Option<String>,
    pub review: AuthDeviceUserAuthoritiesReviewsDecideResponseReview,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsListRequest {
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    #[serde(rename = "instanceId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Value>,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsListResponse`.
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsListResponseEntriesItem {
    #[serde(rename = "decidedAt")]
    pub decided_at: Value,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    #[serde(rename = "reviewId")]
    pub review_id: String,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsListResponse {
    pub count: i64,
    pub entries: Vec<AuthDeviceUserAuthoritiesReviewsListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthDeviceUserAuthoritiesRevokeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRevokeRequest {
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesRevokeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRevokeResponse {
    pub success: bool,
}
/// Generated schema type `AuthDevicesConnectInfoGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetRequest {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    pub iat: f64,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    pub sig: String,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponse`.
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfo`.
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoAuth`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoAuth {
    pub authority: Value,
    #[serde(rename = "iatSkewSeconds")]
    pub iat_skew_seconds: f64,
    pub mode: String,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransport`.
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransportSentinel`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransportSentinel {
    pub jwt: String,
    pub seed: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransport {
    pub sentinel: AuthDevicesConnectInfoGetResponseConnectInfoTransportSentinel,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransports`.
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransportsNative`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransportsNative {
    #[serde(rename = "natsServers")]
    pub nats_servers: Vec<String>,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransportsWebsocket`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransportsWebsocket {
    #[serde(rename = "natsServers")]
    pub nats_servers: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransports {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native: Option<AuthDevicesConnectInfoGetResponseConnectInfoTransportsNative>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket: Option<AuthDevicesConnectInfoGetResponseConnectInfoTransportsWebsocket>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfo {
    pub auth: AuthDevicesConnectInfoGetResponseConnectInfoAuth,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    pub transport: AuthDevicesConnectInfoGetResponseConnectInfoTransport,
    pub transports: AuthDevicesConnectInfoGetResponseConnectInfoTransports,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponse {
    #[serde(rename = "connectInfo")]
    pub connect_info: AuthDevicesConnectInfoGetResponseConnectInfo,
    pub status: String,
}
/// Generated schema type `AuthDevicesDisableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesDisableRequest {
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthDevicesDisableResponse`.
/// Generated schema type `AuthDevicesDisableResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesDisableResponseInstance {
    #[serde(rename = "activatedAt")]
    pub activated_at: Value,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "currentContractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_digest: Option<String>,
    #[serde(rename = "currentContractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_id: Option<String>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Value,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesDisableResponse {
    pub instance: AuthDevicesDisableResponseInstance,
}
/// Generated schema type `AuthDevicesEnableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesEnableRequest {
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthDevicesEnableResponse`.
/// Generated schema type `AuthDevicesEnableResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesEnableResponseInstance {
    #[serde(rename = "activatedAt")]
    pub activated_at: Value,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "currentContractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_digest: Option<String>,
    #[serde(rename = "currentContractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_id: Option<String>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Value,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesEnableResponse {
    pub instance: AuthDevicesEnableResponseInstance,
}
/// Generated schema type `AuthDevicesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesListRequest {
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Value>,
}
/// Generated schema type `AuthDevicesListResponse`.
/// Generated schema type `AuthDevicesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesListResponseEntriesItem {
    #[serde(rename = "activatedAt")]
    pub activated_at: Value,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "currentContractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_digest: Option<String>,
    #[serde(rename = "currentContractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_id: Option<String>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Value,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesListResponse {
    pub count: i64,
    pub entries: Vec<AuthDevicesListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthDevicesProvisionRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesProvisionRequest {
    #[serde(rename = "activationKey")]
    pub activation_key: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
}
/// Generated schema type `AuthDevicesProvisionResponse`.
/// Generated schema type `AuthDevicesProvisionResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesProvisionResponseInstance {
    #[serde(rename = "activatedAt")]
    pub activated_at: Value,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "currentContractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_digest: Option<String>,
    #[serde(rename = "currentContractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_id: Option<String>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Value,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesProvisionResponse {
    pub instance: AuthDevicesProvisionResponseInstance,
}
/// Generated schema type `AuthDevicesRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesRemoveRequest {
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthDevicesRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesRemoveResponse {
    pub success: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "requestId")]
    pub request_id: String,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponse`.
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseContractEvidence`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseContractEvidence {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "firstSeenAt")]
    pub first_seen_at: String,
    #[serde(rename = "ignoreReason")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_reason: Option<Value>,
    #[serde(rename = "ignoredAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_at: Option<Value>,
    #[serde(rename = "ignoredBy")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_by: Option<Value>,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: String,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseDelta`.
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseDeltaContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseDeltaContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseDeltaResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseDeltaResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseDeltaSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseDeltaSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseDelta {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopeExpansionsApproveResponseDeltaContractsItem>,
    pub resources: Vec<AuthEnvelopeExpansionsApproveResponseDeltaResourcesItem>,
    pub surfaces: Vec<AuthEnvelopeExpansionsApproveResponseDeltaSurfacesItem>,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseEnvelope`.
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseEnvelopeBoundary`.
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseEnvelopeBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseEnvelopeBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseEnvelopeBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseEnvelopeBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseEnvelopeBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseEnvelopeBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseEnvelopeBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopeExpansionsApproveResponseEnvelopeBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopeExpansionsApproveResponseEnvelopeBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopeExpansionsApproveResponseEnvelopeBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseEnvelope {
    pub boundary: AuthEnvelopeExpansionsApproveResponseEnvelopeBoundary,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    pub kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseRequest`.
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseRequestDelta`.
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseRequestDeltaContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseRequestDeltaContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseRequestDeltaResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseRequestDeltaResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseRequestDeltaSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseRequestDeltaSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseRequestDelta {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopeExpansionsApproveResponseRequestDeltaContractsItem>,
    pub resources: Vec<AuthEnvelopeExpansionsApproveResponseRequestDeltaResourcesItem>,
    pub surfaces: Vec<AuthEnvelopeExpansionsApproveResponseRequestDeltaSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseRequest {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "decidedAt")]
    pub decided_at: Value,
    #[serde(rename = "decidedBy")]
    pub decided_by: Value,
    #[serde(rename = "decisionReason")]
    pub decision_reason: Value,
    pub delta: AuthEnvelopeExpansionsApproveResponseRequestDelta,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "requestedBy")]
    pub requested_by: BTreeMap<String, Value>,
    #[serde(rename = "requestedByKind")]
    pub requested_by_kind: Value,
    pub state: Value,
}
/// Generated schema type `AuthEnvelopeExpansionsApproveResponseResourceBindingsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponseResourceBindingsItem {
    pub alias: String,
    pub binding: BTreeMap<String, Value>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub kind: Value,
    pub limits: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsApproveResponse {
    #[serde(rename = "contractEvidence")]
    pub contract_evidence: AuthEnvelopeExpansionsApproveResponseContractEvidence,
    pub delta: AuthEnvelopeExpansionsApproveResponseDelta,
    pub envelope: AuthEnvelopeExpansionsApproveResponseEnvelope,
    pub request: AuthEnvelopeExpansionsApproveResponseRequest,
    #[serde(rename = "resourceBindings")]
    pub resource_bindings: Vec<AuthEnvelopeExpansionsApproveResponseResourceBindingsItem>,
}
/// Generated schema type `AuthEnvelopeExpansionsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsListRequest {
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Value>,
}
/// Generated schema type `AuthEnvelopeExpansionsListResponse`.
/// Generated schema type `AuthEnvelopeExpansionsListResponseEntriesItem`.
/// Generated schema type `AuthEnvelopeExpansionsListResponseEntriesItemDelta`.
/// Generated schema type `AuthEnvelopeExpansionsListResponseEntriesItemDeltaContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsListResponseEntriesItemDeltaContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsListResponseEntriesItemDeltaResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsListResponseEntriesItemDeltaResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsListResponseEntriesItemDeltaSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsListResponseEntriesItemDeltaSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsListResponseEntriesItemDelta {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopeExpansionsListResponseEntriesItemDeltaContractsItem>,
    pub resources: Vec<AuthEnvelopeExpansionsListResponseEntriesItemDeltaResourcesItem>,
    pub surfaces: Vec<AuthEnvelopeExpansionsListResponseEntriesItemDeltaSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsListResponseEntriesItem {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "decidedAt")]
    pub decided_at: Value,
    #[serde(rename = "decidedBy")]
    pub decided_by: Value,
    #[serde(rename = "decisionReason")]
    pub decision_reason: Value,
    pub delta: AuthEnvelopeExpansionsListResponseEntriesItemDelta,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "requestedBy")]
    pub requested_by: BTreeMap<String, Value>,
    #[serde(rename = "requestedByKind")]
    pub requested_by_kind: Value,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsListResponse {
    pub count: i64,
    pub entries: Vec<AuthEnvelopeExpansionsListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthEnvelopeExpansionsRejectRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsRejectRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "requestId")]
    pub request_id: String,
}
/// Generated schema type `AuthEnvelopeExpansionsRejectResponse`.
/// Generated schema type `AuthEnvelopeExpansionsRejectResponseRequest`.
/// Generated schema type `AuthEnvelopeExpansionsRejectResponseRequestDelta`.
/// Generated schema type `AuthEnvelopeExpansionsRejectResponseRequestDeltaContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsRejectResponseRequestDeltaContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsRejectResponseRequestDeltaResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsRejectResponseRequestDeltaResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopeExpansionsRejectResponseRequestDeltaSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsRejectResponseRequestDeltaSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsRejectResponseRequestDelta {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopeExpansionsRejectResponseRequestDeltaContractsItem>,
    pub resources: Vec<AuthEnvelopeExpansionsRejectResponseRequestDeltaResourcesItem>,
    pub surfaces: Vec<AuthEnvelopeExpansionsRejectResponseRequestDeltaSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsRejectResponseRequest {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "decidedAt")]
    pub decided_at: Value,
    #[serde(rename = "decidedBy")]
    pub decided_by: Value,
    #[serde(rename = "decisionReason")]
    pub decision_reason: Value,
    pub delta: AuthEnvelopeExpansionsRejectResponseRequestDelta,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "requestedBy")]
    pub requested_by: BTreeMap<String, Value>,
    #[serde(rename = "requestedByKind")]
    pub requested_by_kind: Value,
    pub state: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopeExpansionsRejectResponse {
    pub request: AuthEnvelopeExpansionsRejectResponseRequest,
}
/// Generated schema type `AuthEnvelopesChangesPreviewRequest`.
/// Generated schema type `AuthEnvelopesChangesPreviewRequestProposedBoundary`.
/// Generated schema type `AuthEnvelopesChangesPreviewRequestProposedBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewRequestProposedBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewRequestProposedBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewRequestProposedBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewRequestProposedBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewRequestProposedBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewRequestProposedBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesChangesPreviewRequestProposedBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopesChangesPreviewRequestProposedBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesChangesPreviewRequestProposedBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewRequest {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "proposedBoundary")]
    pub proposed_boundary: AuthEnvelopesChangesPreviewRequestProposedBoundary,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponse`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseCurrent`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseCurrentBoundary`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseCurrentBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseCurrentBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseCurrentBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseCurrentBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseCurrentBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseCurrentBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseCurrentBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesChangesPreviewResponseCurrentBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopesChangesPreviewResponseCurrentBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesChangesPreviewResponseCurrentBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseCurrent {
    pub boundary: AuthEnvelopesChangesPreviewResponseCurrentBoundary,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    pub kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpact`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItem`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissing`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissing {
    pub capabilities: Vec<String>,
    pub contracts: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingContractsItem,
    >,
    pub resources: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingResourcesItem,
    >,
    pub surfaces:
        Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissingSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItem {
    #[serde(rename = "contractDigest")]
    pub contract_digest: Value,
    #[serde(rename = "contractId")]
    pub contract_id: Value,
    pub missing: AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItemMissing,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub r#type: Value,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItem`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissing`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingContractsItem
{
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingResourcesItem
{
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingSurfacesItem
{
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissing {
    pub capabilities: Vec<String>,
    pub contracts: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingContractsItem,
    >,
    pub resources: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingResourcesItem,
    >,
    pub surfaces: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissingSurfacesItem,
    >,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItem {
    #[serde(rename = "identityAnchor")]
    pub identity_anchor: Value,
    #[serde(rename = "identityEnvelopeId")]
    pub identity_envelope_id: String,
    pub missing: AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItemMissing,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItem`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissing`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingContractsItem
{
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingResourcesItem
{
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissing {
    pub capabilities: Vec<String>,
    pub contracts: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingContractsItem,
    >,
    pub resources: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingResourcesItem,
    >,
    pub surfaces: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissingSurfacesItem,
    >,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItem {
    pub missing: AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItemMissing,
    #[serde(rename = "requestId")]
    pub request_id: String,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItem`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissing`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingContractsItem
{
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingResourcesItem
{
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingSurfacesItem
{
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissing {
    pub capabilities: Vec<String>,
    pub contracts: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingContractsItem,
    >,
    pub resources: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingResourcesItem,
    >,
    pub surfaces: Vec<
        AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissingSurfacesItem,
    >,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItem {
    pub missing: AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItemMissing,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItem`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissing`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissing {
    pub capabilities: Vec<String>,
    pub contracts:
        Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingContractsItem>,
    pub resources:
        Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingResourcesItem>,
    pub surfaces:
        Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissingSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItem {
    #[serde(rename = "contractDigest")]
    pub contract_digest: Value,
    #[serde(rename = "contractId")]
    pub contract_id: Value,
    pub missing: AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItemMissing,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub r#type: Value,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactOrphanedResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactOrphanedResourcesItem {
    pub alias: String,
    pub kind: Value,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactRemoved`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactRemovedContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactRemovedContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactRemovedResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactRemovedResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseImpactRemovedSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactRemovedSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpactRemoved {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesChangesPreviewResponseImpactRemovedContractsItem>,
    pub resources: Vec<AuthEnvelopesChangesPreviewResponseImpactRemovedResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesChangesPreviewResponseImpactRemovedSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseImpact {
    #[serde(rename = "impactedDeviceSessions")]
    pub impacted_device_sessions:
        Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedDeviceSessionsItem>,
    #[serde(rename = "impactedIdentityEnvelopes")]
    pub impacted_identity_envelopes:
        Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedIdentityEnvelopesItem>,
    #[serde(rename = "impactedPendingRequests")]
    pub impacted_pending_requests:
        Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedPendingRequestsItem>,
    #[serde(rename = "impactedServiceInstances")]
    pub impacted_service_instances:
        Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedServiceInstancesItem>,
    #[serde(rename = "impactedSessions")]
    pub impacted_sessions: Vec<AuthEnvelopesChangesPreviewResponseImpactImpactedSessionsItem>,
    #[serde(rename = "orphanedResources")]
    pub orphaned_resources: Vec<AuthEnvelopesChangesPreviewResponseImpactOrphanedResourcesItem>,
    pub removed: AuthEnvelopesChangesPreviewResponseImpactRemoved,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseProposed`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseProposedBoundary`.
/// Generated schema type `AuthEnvelopesChangesPreviewResponseProposedBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseProposedBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseProposedBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseProposedBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesChangesPreviewResponseProposedBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseProposedBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseProposedBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesChangesPreviewResponseProposedBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopesChangesPreviewResponseProposedBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesChangesPreviewResponseProposedBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponseProposed {
    pub boundary: AuthEnvelopesChangesPreviewResponseProposedBoundary,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    pub kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesChangesPreviewResponse {
    pub current: AuthEnvelopesChangesPreviewResponseCurrent,
    pub impact: AuthEnvelopesChangesPreviewResponseImpact,
    pub proposed: AuthEnvelopesChangesPreviewResponseProposed,
}
/// Generated schema type `AuthEnvelopesExpandRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandRequest {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "expectedDigest")]
    pub expected_digest: String,
}
/// Generated schema type `AuthEnvelopesExpandResponse`.
/// Generated schema type `AuthEnvelopesExpandResponseContractEvidence`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseContractEvidence {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "firstSeenAt")]
    pub first_seen_at: String,
    #[serde(rename = "ignoreReason")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_reason: Option<Value>,
    #[serde(rename = "ignoredAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_at: Option<Value>,
    #[serde(rename = "ignoredBy")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_by: Option<Value>,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: String,
}
/// Generated schema type `AuthEnvelopesExpandResponseDelta`.
/// Generated schema type `AuthEnvelopesExpandResponseDeltaContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseDeltaContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesExpandResponseDeltaResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseDeltaResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesExpandResponseDeltaSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseDeltaSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseDelta {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesExpandResponseDeltaContractsItem>,
    pub resources: Vec<AuthEnvelopesExpandResponseDeltaResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesExpandResponseDeltaSurfacesItem>,
}
/// Generated schema type `AuthEnvelopesExpandResponseEnvelope`.
/// Generated schema type `AuthEnvelopesExpandResponseEnvelopeBoundary`.
/// Generated schema type `AuthEnvelopesExpandResponseEnvelopeBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseEnvelopeBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesExpandResponseEnvelopeBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseEnvelopeBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesExpandResponseEnvelopeBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseEnvelopeBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseEnvelopeBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesExpandResponseEnvelopeBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopesExpandResponseEnvelopeBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesExpandResponseEnvelopeBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseEnvelope {
    pub boundary: AuthEnvelopesExpandResponseEnvelopeBoundary,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    pub kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthEnvelopesExpandResponseResourceBindingsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponseResourceBindingsItem {
    pub alias: String,
    pub binding: BTreeMap<String, Value>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub kind: Value,
    pub limits: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesExpandResponse {
    #[serde(rename = "contractEvidence")]
    pub contract_evidence: AuthEnvelopesExpandResponseContractEvidence,
    pub delta: AuthEnvelopesExpandResponseDelta,
    pub envelope: AuthEnvelopesExpandResponseEnvelope,
    #[serde(rename = "resourceBindings")]
    pub resource_bindings: Vec<AuthEnvelopesExpandResponseResourceBindingsItem>,
}
/// Generated schema type `AuthEnvelopesGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetRequest {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
}
/// Generated schema type `AuthEnvelopesGetResponse`.
/// Generated schema type `AuthEnvelopesGetResponseContractEvidenceItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseContractEvidenceItem {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "firstSeenAt")]
    pub first_seen_at: String,
    #[serde(rename = "ignoreReason")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_reason: Option<Value>,
    #[serde(rename = "ignoredAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_at: Option<Value>,
    #[serde(rename = "ignoredBy")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_by: Option<Value>,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: String,
}
/// Generated schema type `AuthEnvelopesGetResponseEnvelope`.
/// Generated schema type `AuthEnvelopesGetResponseEnvelopeBoundary`.
/// Generated schema type `AuthEnvelopesGetResponseEnvelopeBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseEnvelopeBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesGetResponseEnvelopeBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseEnvelopeBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesGetResponseEnvelopeBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseEnvelopeBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseEnvelopeBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesGetResponseEnvelopeBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopesGetResponseEnvelopeBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesGetResponseEnvelopeBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseEnvelope {
    pub boundary: AuthEnvelopesGetResponseEnvelopeBoundary,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    pub kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthEnvelopesGetResponseExpansionRequestsItem`.
/// Generated schema type `AuthEnvelopesGetResponseExpansionRequestsItemDelta`.
/// Generated schema type `AuthEnvelopesGetResponseExpansionRequestsItemDeltaContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseExpansionRequestsItemDeltaContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesGetResponseExpansionRequestsItemDeltaResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseExpansionRequestsItemDeltaResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesGetResponseExpansionRequestsItemDeltaSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseExpansionRequestsItemDeltaSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseExpansionRequestsItemDelta {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesGetResponseExpansionRequestsItemDeltaContractsItem>,
    pub resources: Vec<AuthEnvelopesGetResponseExpansionRequestsItemDeltaResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesGetResponseExpansionRequestsItemDeltaSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseExpansionRequestsItem {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "decidedAt")]
    pub decided_at: Value,
    #[serde(rename = "decidedBy")]
    pub decided_by: Value,
    #[serde(rename = "decisionReason")]
    pub decision_reason: Value,
    pub delta: AuthEnvelopesGetResponseExpansionRequestsItemDelta,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "requestedBy")]
    pub requested_by: BTreeMap<String, Value>,
    #[serde(rename = "requestedByKind")]
    pub requested_by_kind: Value,
    pub state: Value,
}
/// Generated schema type `AuthEnvelopesGetResponseResourceBindingsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponseResourceBindingsItem {
    pub alias: String,
    pub binding: BTreeMap<String, Value>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub kind: Value,
    pub limits: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGetResponse {
    #[serde(rename = "contractEvidence")]
    pub contract_evidence: Vec<AuthEnvelopesGetResponseContractEvidenceItem>,
    pub envelope: AuthEnvelopesGetResponseEnvelope,
    #[serde(rename = "expansionRequests")]
    pub expansion_requests: Vec<AuthEnvelopesGetResponseExpansionRequestsItem>,
    #[serde(rename = "grantOverrides")]
    pub grant_overrides: Vec<Value>,
    #[serde(rename = "portalRoute")]
    pub portal_route: Value,
    #[serde(rename = "resourceBindings")]
    pub resource_bindings: Vec<AuthEnvelopesGetResponseResourceBindingsItem>,
}
/// Generated schema type `AuthEnvelopesGrantOverridesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGrantOverridesListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthEnvelopesGrantOverridesListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGrantOverridesListResponse {
    pub count: i64,
    pub entries: Vec<Value>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthEnvelopesGrantOverridesPutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGrantOverridesPutRequest {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub overrides: Vec<Value>,
}
/// Generated schema type `AuthEnvelopesGrantOverridesPutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGrantOverridesPutResponse {
    #[serde(rename = "grantOverrides")]
    pub grant_overrides: Vec<Value>,
}
/// Generated schema type `AuthEnvelopesGrantOverridesRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGrantOverridesRemoveRequest {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub overrides: Vec<Value>,
}
/// Generated schema type `AuthEnvelopesGrantOverridesRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesGrantOverridesRemoveResponse {
    #[serde(rename = "grantOverrides")]
    pub grant_overrides: Vec<Value>,
}
/// Generated schema type `AuthEnvelopesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesListRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<Value>,
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthEnvelopesListResponse`.
/// Generated schema type `AuthEnvelopesListResponseEntriesItem`.
/// Generated schema type `AuthEnvelopesListResponseEntriesItemBoundary`.
/// Generated schema type `AuthEnvelopesListResponseEntriesItemBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesListResponseEntriesItemBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesListResponseEntriesItemBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesListResponseEntriesItemBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesListResponseEntriesItemBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesListResponseEntriesItemBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesListResponseEntriesItemBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesListResponseEntriesItemBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopesListResponseEntriesItemBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesListResponseEntriesItemBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesListResponseEntriesItem {
    pub boundary: AuthEnvelopesListResponseEntriesItemBoundary,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    pub kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesListResponse {
    pub count: i64,
    pub entries: Vec<AuthEnvelopesListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthEnvelopesShrinkRequest`.
/// Generated schema type `AuthEnvelopesShrinkRequestProposedBoundary`.
/// Generated schema type `AuthEnvelopesShrinkRequestProposedBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkRequestProposedBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkRequestProposedBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkRequestProposedBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkRequestProposedBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkRequestProposedBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkRequestProposedBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesShrinkRequestProposedBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopesShrinkRequestProposedBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesShrinkRequestProposedBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkRequest {
    pub confirm: bool,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "proposedBoundary")]
    pub proposed_boundary: AuthEnvelopesShrinkRequestProposedBoundary,
}
/// Generated schema type `AuthEnvelopesShrinkResponse`.
/// Generated schema type `AuthEnvelopesShrinkResponseEnvelope`.
/// Generated schema type `AuthEnvelopesShrinkResponseEnvelopeBoundary`.
/// Generated schema type `AuthEnvelopesShrinkResponseEnvelopeBoundaryContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseEnvelopeBoundaryContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseEnvelopeBoundaryResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseEnvelopeBoundaryResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseEnvelopeBoundarySurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseEnvelopeBoundarySurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseEnvelopeBoundary {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesShrinkResponseEnvelopeBoundaryContractsItem>,
    pub resources: Vec<AuthEnvelopesShrinkResponseEnvelopeBoundaryResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesShrinkResponseEnvelopeBoundarySurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseEnvelope {
    pub boundary: AuthEnvelopesShrinkResponseEnvelopeBoundary,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    pub kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpact`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItem`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissing`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissing {
    pub capabilities: Vec<String>,
    pub contracts:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingContractsItem>,
    pub resources:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingResourcesItem>,
    pub surfaces:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissingSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItem {
    #[serde(rename = "contractDigest")]
    pub contract_digest: Value,
    #[serde(rename = "contractId")]
    pub contract_id: Value,
    pub missing: AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItemMissing,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub r#type: Value,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItem`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissing`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissing {
    pub capabilities: Vec<String>,
    pub contracts:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingContractsItem>,
    pub resources:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingResourcesItem>,
    pub surfaces:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissingSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItem {
    #[serde(rename = "identityAnchor")]
    pub identity_anchor: Value,
    #[serde(rename = "identityEnvelopeId")]
    pub identity_envelope_id: String,
    pub missing: AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItemMissing,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItem`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissing`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissing {
    pub capabilities: Vec<String>,
    pub contracts:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingContractsItem>,
    pub resources:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingResourcesItem>,
    pub surfaces:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissingSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItem {
    pub missing: AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItemMissing,
    #[serde(rename = "requestId")]
    pub request_id: String,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItem`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissing`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissing {
    pub capabilities: Vec<String>,
    pub contracts:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingContractsItem>,
    pub resources:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingResourcesItem>,
    pub surfaces:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissingSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItem {
    pub missing: AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItemMissing,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedSessionsItem`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissing`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissing {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingContractsItem>,
    pub resources: Vec<AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissingSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactImpactedSessionsItem {
    #[serde(rename = "contractDigest")]
    pub contract_digest: Value,
    #[serde(rename = "contractId")]
    pub contract_id: Value,
    pub missing: AuthEnvelopesShrinkResponseImpactImpactedSessionsItemMissing,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub r#type: Value,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactOrphanedResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactOrphanedResourcesItem {
    pub alias: String,
    pub kind: Value,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactRemoved`.
/// Generated schema type `AuthEnvelopesShrinkResponseImpactRemovedContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactRemovedContractsItem {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactRemovedResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactRemovedResourcesItem {
    pub alias: String,
    pub kind: Value,
    pub required: bool,
}
/// Generated schema type `AuthEnvelopesShrinkResponseImpactRemovedSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactRemovedSurfacesItem {
    pub action: Value,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: Value,
    pub name: String,
    pub required: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpactRemoved {
    pub capabilities: Vec<String>,
    pub contracts: Vec<AuthEnvelopesShrinkResponseImpactRemovedContractsItem>,
    pub resources: Vec<AuthEnvelopesShrinkResponseImpactRemovedResourcesItem>,
    pub surfaces: Vec<AuthEnvelopesShrinkResponseImpactRemovedSurfacesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseImpact {
    #[serde(rename = "impactedDeviceSessions")]
    pub impacted_device_sessions: Vec<AuthEnvelopesShrinkResponseImpactImpactedDeviceSessionsItem>,
    #[serde(rename = "impactedIdentityEnvelopes")]
    pub impacted_identity_envelopes:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedIdentityEnvelopesItem>,
    #[serde(rename = "impactedPendingRequests")]
    pub impacted_pending_requests:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedPendingRequestsItem>,
    #[serde(rename = "impactedServiceInstances")]
    pub impacted_service_instances:
        Vec<AuthEnvelopesShrinkResponseImpactImpactedServiceInstancesItem>,
    #[serde(rename = "impactedSessions")]
    pub impacted_sessions: Vec<AuthEnvelopesShrinkResponseImpactImpactedSessionsItem>,
    #[serde(rename = "orphanedResources")]
    pub orphaned_resources: Vec<AuthEnvelopesShrinkResponseImpactOrphanedResourcesItem>,
    pub removed: AuthEnvelopesShrinkResponseImpactRemoved,
}
/// Generated schema type `AuthEnvelopesShrinkResponseRetainedResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponseRetainedResourcesItem {
    pub alias: String,
    pub kind: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEnvelopesShrinkResponse {
    pub envelope: AuthEnvelopesShrinkResponseEnvelope,
    pub impact: AuthEnvelopesShrinkResponseImpact,
    #[serde(rename = "retainedResources")]
    pub retained_resources: Vec<AuthEnvelopesShrinkResponseRetainedResourcesItem>,
}
/// Generated schema type `AuthHealthResponse`.
/// Generated schema type `AuthHealthResponseChecksItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthHealthResponseChecksItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<BTreeMap<String, Value>>,
    #[serde(rename = "latencyMs")]
    pub latency_ms: f64,
    pub name: String,
    pub status: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthHealthResponse {
    pub checks: Vec<AuthHealthResponseChecksItem>,
    pub service: String,
    pub status: Value,
    pub timestamp: String,
}
/// Generated schema type `AuthIdentitiesGrantsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesGrantsListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthIdentitiesGrantsListResponse`.
/// Generated schema type `AuthIdentitiesGrantsListResponseEntriesItem`.
/// Generated schema type `AuthIdentitiesGrantsListResponseEntriesItemContractEvidence`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesGrantsListResponseEntriesItemContractEvidence {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesGrantsListResponseEntriesItem {
    pub capabilities: Vec<String>,
    #[serde(rename = "contractEvidence")]
    pub contract_evidence: AuthIdentitiesGrantsListResponseEntriesItemContractEvidence,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "grantedAt")]
    pub granted_at: String,
    #[serde(rename = "identityAnchor")]
    pub identity_anchor: Value,
    #[serde(rename = "identityEnvelopeId")]
    pub identity_envelope_id: String,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesGrantsListResponse {
    pub count: i64,
    pub entries: Vec<AuthIdentitiesGrantsListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthIdentitiesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthIdentitiesListResponse`.
/// Generated schema type `AuthIdentitiesListResponseEntriesItem`.
/// Generated schema type `AuthIdentitiesListResponseEntriesItemCapabilitiesValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListResponseEntriesItemCapabilitiesValue {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consequence: Option<String>,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
}
/// Generated schema type `AuthIdentitiesListResponseEntriesItemContractEvidence`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListResponseEntriesItemContractEvidence {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListResponseEntriesItem {
    pub answer: Value,
    #[serde(rename = "answeredAt")]
    pub answered_at: String,
    pub capabilities: BTreeMap<String, AuthIdentitiesListResponseEntriesItemCapabilitiesValue>,
    #[serde(rename = "contractEvidence")]
    pub contract_evidence: AuthIdentitiesListResponseEntriesItemContractEvidence,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "identityAnchor")]
    pub identity_anchor: Value,
    #[serde(rename = "identityEnvelopeId")]
    pub identity_envelope_id: String,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub user: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListResponse {
    pub count: i64,
    pub entries: Vec<AuthIdentitiesListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthIdentityEnvelopesRevokeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentityEnvelopesRevokeRequest {
    #[serde(rename = "identityEnvelopeId")]
    pub identity_envelope_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthIdentityEnvelopesRevokeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentityEnvelopesRevokeResponse {
    pub success: bool,
}
/// Generated schema type `AuthPortalsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetRequest {
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsGetResponse`.
/// Generated schema type `AuthPortalsGetResponseFederatedProvidersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponseFederatedProvidersItem {
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub id: String,
    pub r#type: String,
}
/// Generated schema type `AuthPortalsGetResponsePortal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponsePortal {
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub disabled: bool,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "entryUrl")]
    pub entry_url: Value,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsGetResponseRoutesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponseRoutesItem {
    #[serde(rename = "contractId")]
    pub contract_id: Value,
    pub disabled: bool,
    pub origin: Value,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "routeKey")]
    pub route_key: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsGetResponseSettings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponseSettings {
    #[serde(rename = "allowedFederatedProviders")]
    pub allowed_federated_providers: Value,
    #[serde(rename = "federatedRegistrationEnabled")]
    pub federated_registration_enabled: bool,
    #[serde(rename = "localRegistrationEnabled")]
    pub local_registration_enabled: bool,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "selfRegisteredAccountActive")]
    pub self_registered_account_active: bool,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponse {
    #[serde(rename = "defaultCapabilities")]
    pub default_capabilities: Vec<String>,
    #[serde(rename = "defaultCapabilityGroups")]
    pub default_capability_groups: Vec<String>,
    #[serde(rename = "federatedProviders")]
    pub federated_providers: Vec<AuthPortalsGetResponseFederatedProvidersItem>,
    pub portal: AuthPortalsGetResponsePortal,
    pub routes: Vec<AuthPortalsGetResponseRoutesItem>,
    pub settings: AuthPortalsGetResponseSettings,
}
/// Generated schema type `AuthPortalsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthPortalsListResponse`.
/// Generated schema type `AuthPortalsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsListResponseEntriesItem {
    #[serde(rename = "activeRouteCount")]
    pub active_route_count: i64,
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub disabled: bool,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "entryUrl")]
    pub entry_url: Value,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "routeCount")]
    pub route_count: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsListResponse {
    pub count: i64,
    pub entries: Vec<AuthPortalsListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthPortalsLoginSettingsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetRequest {
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsLoginSettingsGetResponse`.
/// Generated schema type `AuthPortalsLoginSettingsGetResponseFederatedProvidersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetResponseFederatedProvidersItem {
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub id: String,
    pub r#type: String,
}
/// Generated schema type `AuthPortalsLoginSettingsGetResponsePortal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetResponsePortal {
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub disabled: bool,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "entryUrl")]
    pub entry_url: Value,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsLoginSettingsGetResponseSettings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetResponseSettings {
    #[serde(rename = "allowedFederatedProviders")]
    pub allowed_federated_providers: Value,
    #[serde(rename = "federatedRegistrationEnabled")]
    pub federated_registration_enabled: bool,
    #[serde(rename = "localRegistrationEnabled")]
    pub local_registration_enabled: bool,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "selfRegisteredAccountActive")]
    pub self_registered_account_active: bool,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetResponse {
    #[serde(rename = "defaultCapabilities")]
    pub default_capabilities: Vec<String>,
    #[serde(rename = "defaultCapabilityGroups")]
    pub default_capability_groups: Vec<String>,
    #[serde(rename = "federatedProviders")]
    pub federated_providers: Vec<AuthPortalsLoginSettingsGetResponseFederatedProvidersItem>,
    pub portal: AuthPortalsLoginSettingsGetResponsePortal,
    pub settings: AuthPortalsLoginSettingsGetResponseSettings,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateRequest {
    #[serde(rename = "allowedFederatedProviders")]
    pub allowed_federated_providers: Value,
    #[serde(rename = "defaultCapabilities")]
    pub default_capabilities: Vec<String>,
    #[serde(rename = "defaultCapabilityGroups")]
    pub default_capability_groups: Vec<String>,
    #[serde(rename = "federatedRegistrationEnabled")]
    pub federated_registration_enabled: bool,
    #[serde(rename = "localRegistrationEnabled")]
    pub local_registration_enabled: bool,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "selfRegisteredAccountActive")]
    pub self_registered_account_active: bool,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateResponse`.
/// Generated schema type `AuthPortalsLoginSettingsUpdateResponseFederatedProvidersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateResponseFederatedProvidersItem {
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub id: String,
    pub r#type: String,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateResponsePortal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateResponsePortal {
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub disabled: bool,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "entryUrl")]
    pub entry_url: Value,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateResponseSettings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateResponseSettings {
    #[serde(rename = "allowedFederatedProviders")]
    pub allowed_federated_providers: Value,
    #[serde(rename = "federatedRegistrationEnabled")]
    pub federated_registration_enabled: bool,
    #[serde(rename = "localRegistrationEnabled")]
    pub local_registration_enabled: bool,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "selfRegisteredAccountActive")]
    pub self_registered_account_active: bool,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateResponse {
    #[serde(rename = "defaultCapabilities")]
    pub default_capabilities: Vec<String>,
    #[serde(rename = "defaultCapabilityGroups")]
    pub default_capability_groups: Vec<String>,
    #[serde(rename = "federatedProviders")]
    pub federated_providers: Vec<AuthPortalsLoginSettingsUpdateResponseFederatedProvidersItem>,
    pub portal: AuthPortalsLoginSettingsUpdateResponsePortal,
    pub settings: AuthPortalsLoginSettingsUpdateResponseSettings,
}
/// Generated schema type `AuthPortalsPutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsPutRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "entryUrl")]
    pub entry_url: String,
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsPutResponse`.
/// Generated schema type `AuthPortalsPutResponsePortal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsPutResponsePortal {
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub disabled: bool,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "entryUrl")]
    pub entry_url: Value,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsPutResponse {
    pub portal: AuthPortalsPutResponsePortal,
}
/// Generated schema type `AuthPortalsRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRemoveRequest {
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRemoveResponse {
    pub success: bool,
}
/// Generated schema type `AuthPortalsRoutesPutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesPutRequest {
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Value>,
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsRoutesPutResponse`.
/// Generated schema type `AuthPortalsRoutesPutResponseRoute`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesPutResponseRoute {
    #[serde(rename = "contractId")]
    pub contract_id: Value,
    pub disabled: bool,
    pub origin: Value,
    #[serde(rename = "portalId")]
    pub portal_id: String,
    #[serde(rename = "routeKey")]
    pub route_key: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesPutResponse {
    pub route: AuthPortalsRoutesPutResponseRoute,
}
/// Generated schema type `AuthPortalsRoutesRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesRemoveRequest {
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Value>,
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsRoutesRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesRemoveResponse {
    pub success: bool,
}
/// Generated schema type `AuthRequestsValidateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRequestsValidateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    pub iat: i64,
    #[serde(rename = "payloadHash")]
    pub payload_hash: String,
    pub proof: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub subject: String,
}
/// Generated schema type `AuthRequestsValidateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRequestsValidateResponse {
    pub allowed: bool,
    pub caller: Value,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
}
/// Generated schema type `AuthServiceInstancesDisableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableRequest {
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthServiceInstancesDisableResponse`.
/// Generated schema type `AuthServiceInstancesDisableResponseInstance`.
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindings`.
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobs`.
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValue`.
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValuePayload {
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueResult {
    pub schema: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValue {
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    pub concurrency: i64,
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    pub dlq: bool,
    pub logs: bool,
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    pub payload: AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValuePayload,
    pub progress: bool,
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    #[serde(rename = "queueType")]
    pub queue_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:
        Option<AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueResult>,
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobs {
    pub namespace: String,
    pub queues: BTreeMap<
        String,
        AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValue,
    >,
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsKvValue {
    pub bucket: String,
    pub history: i64,
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsStoreValue {
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    pub name: String,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthServiceInstancesDisableResponseInstanceResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<
        BTreeMap<String, AuthServiceInstancesDisableResponseInstanceResourceBindingsKvValue>,
    >,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<
        BTreeMap<String, AuthServiceInstancesDisableResponseInstanceResourceBindingsStoreValue>,
    >,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstance {
    pub capabilities: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "currentContractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_digest: Option<String>,
    #[serde(rename = "currentContractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_id: Option<String>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthServiceInstancesDisableResponseInstanceResourceBindings>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponse {
    pub instance: AuthServiceInstancesDisableResponseInstance,
}
/// Generated schema type `AuthServiceInstancesEnableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableRequest {
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthServiceInstancesEnableResponse`.
/// Generated schema type `AuthServiceInstancesEnableResponseInstance`.
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindings`.
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobs`.
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValue`.
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValuePayload {
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueResult {
    pub schema: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValue {
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    pub concurrency: i64,
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    pub dlq: bool,
    pub logs: bool,
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    pub payload: AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValuePayload,
    pub progress: bool,
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    #[serde(rename = "queueType")]
    pub queue_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:
        Option<AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueResult>,
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobs {
    pub namespace: String,
    pub queues:
        BTreeMap<String, AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValue>,
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsKvValue {
    pub bucket: String,
    pub history: i64,
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsStoreValue {
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    pub name: String,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthServiceInstancesEnableResponseInstanceResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv:
        Option<BTreeMap<String, AuthServiceInstancesEnableResponseInstanceResourceBindingsKvValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<
        BTreeMap<String, AuthServiceInstancesEnableResponseInstanceResourceBindingsStoreValue>,
    >,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstance {
    pub capabilities: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "currentContractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_digest: Option<String>,
    #[serde(rename = "currentContractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_id: Option<String>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthServiceInstancesEnableResponseInstanceResourceBindings>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponse {
    pub instance: AuthServiceInstancesEnableResponseInstance,
}
/// Generated schema type `AuthServiceInstancesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListRequest {
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthServiceInstancesListResponse`.
/// Generated schema type `AuthServiceInstancesListResponseEntriesItem`.
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindings`.
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobs`.
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValue`.
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValuePayload {
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueResult {
    pub schema: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValue {
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    pub concurrency: i64,
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    pub dlq: bool,
    pub logs: bool,
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    pub payload: AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValuePayload,
    pub progress: bool,
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    #[serde(rename = "queueType")]
    pub queue_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:
        Option<AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueResult>,
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobs {
    pub namespace: String,
    pub queues: BTreeMap<
        String,
        AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValue,
    >,
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsKvValue {
    pub bucket: String,
    pub history: i64,
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsStoreValue {
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    pub name: String,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthServiceInstancesListResponseEntriesItemResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<
        BTreeMap<String, AuthServiceInstancesListResponseEntriesItemResourceBindingsKvValue>,
    >,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<
        BTreeMap<String, AuthServiceInstancesListResponseEntriesItemResourceBindingsStoreValue>,
    >,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItem {
    pub capabilities: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "currentContractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_digest: Option<String>,
    #[serde(rename = "currentContractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_id: Option<String>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthServiceInstancesListResponseEntriesItemResourceBindings>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponse {
    pub count: i64,
    pub entries: Vec<AuthServiceInstancesListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthServiceInstancesProvisionRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionRequest {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
}
/// Generated schema type `AuthServiceInstancesProvisionResponse`.
/// Generated schema type `AuthServiceInstancesProvisionResponseInstance`.
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindings`.
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobs`.
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValue`.
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValuePayload {
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueResult {
    pub schema: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValue {
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    pub concurrency: i64,
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    pub dlq: bool,
    pub logs: bool,
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    pub payload:
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValuePayload,
    pub progress: bool,
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    #[serde(rename = "queueType")]
    pub queue_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:
        Option<AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueResult>,
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobs {
    pub namespace: String,
    pub queues: BTreeMap<
        String,
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValue,
    >,
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsKvValue {
    pub bucket: String,
    pub history: i64,
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsStoreValue {
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    pub name: String,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<
        BTreeMap<String, AuthServiceInstancesProvisionResponseInstanceResourceBindingsKvValue>,
    >,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<
        BTreeMap<String, AuthServiceInstancesProvisionResponseInstanceResourceBindingsStoreValue>,
    >,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstance {
    pub capabilities: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "currentContractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_digest: Option<String>,
    #[serde(rename = "currentContractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract_id: Option<String>,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    pub disabled: bool,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthServiceInstancesProvisionResponseInstanceResourceBindings>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponse {
    pub instance: AuthServiceInstancesProvisionResponseInstance,
}
/// Generated schema type `AuthServiceInstancesRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesRemoveRequest {
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthServiceInstancesRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesRemoveResponse {
    pub success: bool,
}
/// Generated schema type `AuthSessionsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthSessionsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListResponse {
    pub count: i64,
    pub entries: Vec<Value>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthSessionsLogoutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsLogoutResponse {
    pub success: bool,
}
/// Generated schema type `AuthSessionsMeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsMeResponse {
    pub device: Value,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    pub service: Value,
    pub user: Value,
}
/// Generated schema type `AuthSessionsRevokeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsRevokeRequest {
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}
/// Generated schema type `AuthSessionsRevokeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsRevokeResponse {
    pub success: bool,
}
/// Generated schema type `AuthUserIdentitiesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUserIdentitiesListResponse`.
/// Generated schema type `AuthUserIdentitiesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesListResponseEntriesItem {
    #[serde(rename = "displayName")]
    pub display_name: Value,
    pub email: Value,
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    #[serde(rename = "identityId")]
    pub identity_id: String,
    #[serde(rename = "lastLoginAt")]
    pub last_login_at: Value,
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesListResponse {
    pub count: i64,
    pub entries: Vec<AuthUserIdentitiesListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthUserIdentitiesUnlinkRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesUnlinkRequest {
    #[serde(rename = "identityId")]
    pub identity_id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUserIdentitiesUnlinkResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesUnlinkResponse {
    pub success: bool,
}
/// Generated schema type `AuthUsersCreateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersCreateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(rename = "capabilityGroups")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_groups: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}
/// Generated schema type `AuthUsersCreateResponse`.
/// Generated schema type `AuthUsersCreateResponseUser`.
/// Generated schema type `AuthUsersCreateResponseUserIdentitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersCreateResponseUserIdentitiesItem {
    #[serde(rename = "displayName")]
    pub display_name: Value,
    pub email: Value,
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    #[serde(rename = "identityId")]
    pub identity_id: String,
    #[serde(rename = "lastLoginAt")]
    pub last_login_at: Value,
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersCreateResponseUser {
    pub active: bool,
    pub capabilities: Vec<String>,
    #[serde(rename = "capabilityGroups")]
    pub capability_groups: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub identities: Vec<AuthUsersCreateResponseUserIdentitiesItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersCreateResponse {
    pub user: AuthUsersCreateResponseUser,
}
/// Generated schema type `AuthUsersGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersGetRequest {
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersGetResponse`.
/// Generated schema type `AuthUsersGetResponseUser`.
/// Generated schema type `AuthUsersGetResponseUserIdentitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersGetResponseUserIdentitiesItem {
    #[serde(rename = "displayName")]
    pub display_name: Value,
    pub email: Value,
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    #[serde(rename = "identityId")]
    pub identity_id: String,
    #[serde(rename = "lastLoginAt")]
    pub last_login_at: Value,
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersGetResponseUser {
    pub active: bool,
    pub capabilities: Vec<String>,
    #[serde(rename = "capabilityGroups")]
    pub capability_groups: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub identities: Vec<AuthUsersGetResponseUserIdentitiesItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersGetResponse {
    pub user: AuthUsersGetResponseUser,
}
/// Generated schema type `AuthUsersIdentityLinkCreateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersIdentityLinkCreateRequest {
    #[serde(rename = "returnTo")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_to: Option<String>,
}
/// Generated schema type `AuthUsersIdentityLinkCreateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersIdentityLinkCreateResponse {
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    pub url: String,
}
/// Generated schema type `AuthUsersListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthUsersListResponse`.
/// Generated schema type `AuthUsersListResponseEntriesItem`.
/// Generated schema type `AuthUsersListResponseEntriesItemIdentitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersListResponseEntriesItemIdentitiesItem {
    #[serde(rename = "displayName")]
    pub display_name: Value,
    pub email: Value,
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    #[serde(rename = "identityId")]
    pub identity_id: String,
    #[serde(rename = "lastLoginAt")]
    pub last_login_at: Value,
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersListResponseEntriesItem {
    pub active: bool,
    pub capabilities: Vec<String>,
    #[serde(rename = "capabilityGroups")]
    pub capability_groups: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub identities: Vec<AuthUsersListResponseEntriesItemIdentitiesItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersListResponse {
    pub count: i64,
    pub entries: Vec<AuthUsersListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `AuthUsersPasswordChangeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersPasswordChangeRequest {
    #[serde(rename = "currentPassword")]
    pub current_password: String,
    #[serde(rename = "newPassword")]
    pub new_password: String,
}
/// Generated schema type `AuthUsersPasswordChangeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersPasswordChangeResponse {
    pub success: bool,
}
/// Generated schema type `AuthUsersPasswordResetCreateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersPasswordResetCreateRequest {
    #[serde(rename = "expiresInSeconds")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in_seconds: Option<i64>,
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersPasswordResetCreateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersPasswordResetCreateResponse {
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    pub url: String,
}
/// Generated schema type `AuthUsersUpdateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersUpdateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(rename = "capabilityGroups")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_groups: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersUpdateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersUpdateResponse {
    pub success: bool,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolveInput`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolveInput {
    #[serde(rename = "flowId")]
    pub flow_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolveProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolveProgress {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    #[serde(rename = "reviewId")]
    pub review_id: String,
    pub status: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolveOutput`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolveOutput(pub Value);
/// Generated schema type `AuthConnectionsClosedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsClosedEvent(pub Value);
/// Generated schema type `AuthConnectionsKickedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsKickedEvent(pub Value);
/// Generated schema type `AuthConnectionsOpenedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsOpenedEvent(pub Value);
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEvent`.
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventApprovedBy`.
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventApprovedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEventApprovedByIdentity {
    #[serde(rename = "identityId")]
    pub identity_id: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEventApprovedBy {
    pub identity: AuthDeviceUserAuthoritiesApprovedEventApprovedByIdentity,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventRequestedBy`.
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventRequestedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEventRequestedByIdentity {
    #[serde(rename = "identityId")]
    pub identity_id: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEventRequestedBy {
    pub identity: AuthDeviceUserAuthoritiesApprovedEventRequestedByIdentity,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEvent {
    #[serde(rename = "approvedAt")]
    pub approved_at: String,
    #[serde(rename = "approvedBy")]
    pub approved_by: AuthDeviceUserAuthoritiesApprovedEventApprovedBy,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    #[serde(rename = "requestedBy")]
    pub requested_by: AuthDeviceUserAuthoritiesApprovedEventRequestedBy,
    #[serde(rename = "reviewId")]
    pub review_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesRequestedEvent`.
/// Generated schema type `AuthDeviceUserAuthoritiesRequestedEventRequestedBy`.
/// Generated schema type `AuthDeviceUserAuthoritiesRequestedEventRequestedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRequestedEventRequestedByIdentity {
    #[serde(rename = "identityId")]
    pub identity_id: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRequestedEventRequestedBy {
    pub identity: AuthDeviceUserAuthoritiesRequestedEventRequestedByIdentity,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRequestedEvent {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    #[serde(rename = "requestedBy")]
    pub requested_by: AuthDeviceUserAuthoritiesRequestedEventRequestedBy,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolvedEvent`.
/// Generated schema type `AuthDeviceUserAuthoritiesResolvedEventResolvedBy`.
/// Generated schema type `AuthDeviceUserAuthoritiesResolvedEventResolvedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolvedEventResolvedByIdentity {
    #[serde(rename = "identityId")]
    pub identity_id: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolvedEventResolvedBy {
    pub identity: AuthDeviceUserAuthoritiesResolvedEventResolvedByIdentity,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolvedEvent {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "flowId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_id: Option<String>,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "resolvedAt")]
    pub resolved_at: String,
    #[serde(rename = "resolvedBy")]
    pub resolved_by: AuthDeviceUserAuthoritiesResolvedEventResolvedBy,
    #[serde(rename = "reviewId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewRequestedEvent`.
/// Generated schema type `AuthDeviceUserAuthoritiesReviewRequestedEventRequestedBy`.
/// Generated schema type `AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByIdentity {
    #[serde(rename = "identityId")]
    pub identity_id: String,
    pub provider: String,
    pub subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewRequestedEventRequestedBy {
    pub identity: AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByIdentity,
    #[serde(rename = "participantKind")]
    pub participant_kind: Value,
    #[serde(rename = "userId")]
    pub user_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewRequestedEvent {
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    #[serde(rename = "requestedBy")]
    pub requested_by: AuthDeviceUserAuthoritiesReviewRequestedEventRequestedBy,
    #[serde(rename = "reviewId")]
    pub review_id: String,
}
/// Generated schema type `AuthSessionsRevokedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsRevokedEvent(pub Value);
