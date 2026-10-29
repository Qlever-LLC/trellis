//! Shared request and response types for `trellis.auth@v1`.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
fn deserialize_optional_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}
/// Generated schema type `AuthCapabilitiesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilitiesListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthCapabilitiesListResponseEntriesItemDirection`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthCapabilitiesListResponseEntriesItemDirection {
    /// The `creates` wire value.
    #[serde(rename = "creates")]
    Creates,
    /// The `given` wire value.
    #[serde(rename = "given")]
    Given,
}
impl AuthCapabilitiesListResponseEntriesItemDirection {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Creates => "creates",
            Self::Given => "given",
        }
    }
}
impl AsRef<str> for AuthCapabilitiesListResponseEntriesItemDirection {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthCapabilitiesListResponseEntriesItemDirection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthCapabilitiesListResponseEntriesItemDirection {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthCapabilitiesListResponseEntriesItemDirection> for &str {
    fn eq(&self, other: &AuthCapabilitiesListResponseEntriesItemDirection) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthCapabilitiesListResponseEntriesItemSource`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthCapabilitiesListResponseEntriesItemSource {
    /// The `contract` wire value.
    #[serde(rename = "contract")]
    Contract,
    /// The `platform` wire value.
    #[serde(rename = "platform")]
    Platform,
}
impl AuthCapabilitiesListResponseEntriesItemSource {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Contract => "contract",
            Self::Platform => "platform",
        }
    }
}
impl AsRef<str> for AuthCapabilitiesListResponseEntriesItemSource {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthCapabilitiesListResponseEntriesItemSource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthCapabilitiesListResponseEntriesItemSource {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthCapabilitiesListResponseEntriesItemSource> for &str {
    fn eq(&self, other: &AuthCapabilitiesListResponseEntriesItemSource) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthCapabilitiesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilitiesListResponseEntriesItem {
    /// The `consequence` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consequence: Option<String>,
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_digest: Option<String>,
    /// The `contractDisplayName` wire field.
    #[serde(rename = "contractDisplayName")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_display_name: Option<String>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    /// The `description` wire field.
    pub description: String,
    /// The `direction` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<AuthCapabilitiesListResponseEntriesItemDirection>,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `key` wire field.
    pub key: String,
    /// The `source` wire field.
    pub source: AuthCapabilitiesListResponseEntriesItemSource,
}
/// Generated schema type `AuthCapabilitiesListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilitiesListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthCapabilitiesListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthCapabilityGroupsDeleteRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsDeleteRequest {
    /// The `groupKey` wire field.
    #[serde(rename = "groupKey")]
    pub group_key: String,
}
/// Generated schema type `AuthCapabilityGroupsDeleteResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsDeleteResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthCapabilityGroupsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsGetRequest {
    /// The `groupKey` wire field.
    #[serde(rename = "groupKey")]
    pub group_key: String,
}
/// Generated schema type `AuthCapabilityGroupsGetResponseGroup`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsGetResponseGroup {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `description` wire field.
    pub description: String,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `groupKey` wire field.
    #[serde(rename = "groupKey")]
    pub group_key: String,
    /// The `includedGroups` wire field.
    #[serde(rename = "includedGroups")]
    pub included_groups: Vec<String>,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthCapabilityGroupsGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsGetResponse {
    /// The `group` wire field.
    pub group: AuthCapabilityGroupsGetResponseGroup,
}
/// Generated schema type `AuthCapabilityGroupsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthCapabilityGroupsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsListResponseEntriesItem {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `description` wire field.
    pub description: String,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `groupKey` wire field.
    #[serde(rename = "groupKey")]
    pub group_key: String,
    /// The `includedGroups` wire field.
    #[serde(rename = "includedGroups")]
    pub included_groups: Vec<String>,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthCapabilityGroupsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthCapabilityGroupsListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthCapabilityGroupsPutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsPutRequest {
    /// The `capabilities` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    /// The `description` wire field.
    pub description: String,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `groupKey` wire field.
    #[serde(rename = "groupKey")]
    pub group_key: String,
    /// The `includedGroups` wire field.
    #[serde(rename = "includedGroups")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub included_groups: Option<Vec<String>>,
}
/// Generated schema type `AuthCapabilityGroupsPutResponseGroup`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsPutResponseGroup {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `description` wire field.
    pub description: String,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `groupKey` wire field.
    #[serde(rename = "groupKey")]
    pub group_key: String,
    /// The `includedGroups` wire field.
    #[serde(rename = "includedGroups")]
    pub included_groups: Vec<String>,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthCapabilityGroupsPutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCapabilityGroupsPutResponse {
    /// The `group` wire field.
    pub group: AuthCapabilityGroupsPutResponseGroup,
}
/// Generated schema type `AuthCatalogIssuesResolveRequestAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthCatalogIssuesResolveRequestAction {
    /// The `keep-current` wire value.
    #[serde(rename = "keep-current")]
    KeepCurrent,
    /// The `force-replace` wire value.
    #[serde(rename = "force-replace")]
    ForceReplace,
}
impl AuthCatalogIssuesResolveRequestAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::KeepCurrent => "keep-current",
            Self::ForceReplace => "force-replace",
        }
    }
}
impl AsRef<str> for AuthCatalogIssuesResolveRequestAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthCatalogIssuesResolveRequestAction {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthCatalogIssuesResolveRequestAction {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthCatalogIssuesResolveRequestAction> for &str {
    fn eq(&self, other: &AuthCatalogIssuesResolveRequestAction) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthCatalogIssuesResolveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCatalogIssuesResolveRequest {
    /// The `action` wire field.
    pub action: AuthCatalogIssuesResolveRequestAction,
    /// The `issueId` wire field.
    #[serde(rename = "issueId")]
    pub issue_id: String,
}
/// Generated schema type `AuthCatalogIssuesResolveResponseAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthCatalogIssuesResolveResponseAction {
    /// The `keep-current` wire value.
    #[serde(rename = "keep-current")]
    KeepCurrent,
    /// The `force-replace` wire value.
    #[serde(rename = "force-replace")]
    ForceReplace,
}
impl AuthCatalogIssuesResolveResponseAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::KeepCurrent => "keep-current",
            Self::ForceReplace => "force-replace",
        }
    }
}
impl AsRef<str> for AuthCatalogIssuesResolveResponseAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthCatalogIssuesResolveResponseAction {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthCatalogIssuesResolveResponseAction {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthCatalogIssuesResolveResponseAction> for &str {
    fn eq(&self, other: &AuthCatalogIssuesResolveResponseAction) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthCatalogIssuesResolveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthCatalogIssuesResolveResponse {
    /// The `action` wire field.
    pub action: AuthCatalogIssuesResolveResponseAction,
    /// The `issueId` wire field.
    #[serde(rename = "issueId")]
    pub issue_id: String,
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthConnectionsKickRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsKickRequest {
    /// The `userNkey` wire field.
    #[serde(rename = "userNkey")]
    pub user_nkey: String,
}
/// Generated schema type `AuthConnectionsKickResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsKickResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthConnectionsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `sessionKey` wire field.
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    /// The `user` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemAppPrincipalIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListResponseEntriesItemAppPrincipalIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemAppPrincipalType`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthConnectionsListResponseEntriesItemAppPrincipalType {
    /// The `user` wire value.
    #[serde(rename = "user")]
    User,
}
impl AuthConnectionsListResponseEntriesItemAppPrincipalType {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
        }
    }
}
impl AsRef<str> for AuthConnectionsListResponseEntriesItemAppPrincipalType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthConnectionsListResponseEntriesItemAppPrincipalType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthConnectionsListResponseEntriesItemAppPrincipalType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthConnectionsListResponseEntriesItemAppPrincipalType> for &str {
    fn eq(&self, other: &AuthConnectionsListResponseEntriesItemAppPrincipalType) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemAppPrincipal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListResponseEntriesItemAppPrincipal {
    /// The `identity` wire field.
    pub identity: AuthConnectionsListResponseEntriesItemAppPrincipalIdentity,
    /// The `name` wire field.
    pub name: String,
    /// The `type` wire field.
    pub r#type: AuthConnectionsListResponseEntriesItemAppPrincipalType,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemAgentPrincipalIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListResponseEntriesItemAgentPrincipalIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemAgentPrincipalType`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthConnectionsListResponseEntriesItemAgentPrincipalType {
    /// The `user` wire value.
    #[serde(rename = "user")]
    User,
}
impl AuthConnectionsListResponseEntriesItemAgentPrincipalType {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
        }
    }
}
impl AsRef<str> for AuthConnectionsListResponseEntriesItemAgentPrincipalType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthConnectionsListResponseEntriesItemAgentPrincipalType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthConnectionsListResponseEntriesItemAgentPrincipalType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthConnectionsListResponseEntriesItemAgentPrincipalType> for &str {
    fn eq(&self, other: &AuthConnectionsListResponseEntriesItemAgentPrincipalType) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemAgentPrincipal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListResponseEntriesItemAgentPrincipal {
    /// The `identity` wire field.
    pub identity: AuthConnectionsListResponseEntriesItemAgentPrincipalIdentity,
    /// The `name` wire field.
    pub name: String,
    /// The `type` wire field.
    pub r#type: AuthConnectionsListResponseEntriesItemAgentPrincipalType,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemDevicePrincipalType`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthConnectionsListResponseEntriesItemDevicePrincipalType {
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
}
impl AuthConnectionsListResponseEntriesItemDevicePrincipalType {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Device => "device",
        }
    }
}
impl AsRef<str> for AuthConnectionsListResponseEntriesItemDevicePrincipalType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthConnectionsListResponseEntriesItemDevicePrincipalType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthConnectionsListResponseEntriesItemDevicePrincipalType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthConnectionsListResponseEntriesItemDevicePrincipalType> for &str {
    fn eq(&self, other: &AuthConnectionsListResponseEntriesItemDevicePrincipalType) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemDevicePrincipal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListResponseEntriesItemDevicePrincipal {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `deviceId` wire field.
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// The `deviceType` wire field.
    #[serde(rename = "deviceType")]
    pub device_type: String,
    /// The `runtimePublicKey` wire field.
    #[serde(rename = "runtimePublicKey")]
    pub runtime_public_key: String,
    /// The `type` wire field.
    pub r#type: AuthConnectionsListResponseEntriesItemDevicePrincipalType,
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemServicePrincipalType`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthConnectionsListResponseEntriesItemServicePrincipalType {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
}
impl AuthConnectionsListResponseEntriesItemServicePrincipalType {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
        }
    }
}
impl AsRef<str> for AuthConnectionsListResponseEntriesItemServicePrincipalType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthConnectionsListResponseEntriesItemServicePrincipalType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthConnectionsListResponseEntriesItemServicePrincipalType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthConnectionsListResponseEntriesItemServicePrincipalType> for &str {
    fn eq(&self, other: &AuthConnectionsListResponseEntriesItemServicePrincipalType) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthConnectionsListResponseEntriesItemServicePrincipal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListResponseEntriesItemServicePrincipal {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `id` wire field.
    pub id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `name` wire field.
    pub name: String,
    /// The `type` wire field.
    pub r#type: AuthConnectionsListResponseEntriesItemServicePrincipalType,
}
/// Generated schema type `AuthConnectionsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "participantKind")]
pub enum AuthConnectionsListResponseEntriesItem {
    /// The `app` variant.
    #[serde(rename = "app")]
    App {
        /// The `clientId` wire field.
        #[serde(rename = "clientId")]
        client_id: f64,
        /// The `connectedAt` wire field.
        #[serde(rename = "connectedAt")]
        connected_at: String,
        /// The `contractDisplayName` wire field.
        #[serde(rename = "contractDisplayName")]
        contract_display_name: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `key` wire field.
        key: String,
        /// The `principal` wire field.
        principal: AuthConnectionsListResponseEntriesItemAppPrincipal,
        /// The `serverId` wire field.
        #[serde(rename = "serverId")]
        server_id: String,
        /// The `sessionKey` wire field.
        #[serde(rename = "sessionKey")]
        session_key: String,
        /// The `userNkey` wire field.
        #[serde(rename = "userNkey")]
        user_nkey: String,
    },
    /// The `agent` variant.
    #[serde(rename = "agent")]
    Agent {
        /// The `clientId` wire field.
        #[serde(rename = "clientId")]
        client_id: f64,
        /// The `connectedAt` wire field.
        #[serde(rename = "connectedAt")]
        connected_at: String,
        /// The `contractDisplayName` wire field.
        #[serde(rename = "contractDisplayName")]
        contract_display_name: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `key` wire field.
        key: String,
        /// The `principal` wire field.
        principal: AuthConnectionsListResponseEntriesItemAgentPrincipal,
        /// The `serverId` wire field.
        #[serde(rename = "serverId")]
        server_id: String,
        /// The `sessionKey` wire field.
        #[serde(rename = "sessionKey")]
        session_key: String,
        /// The `userNkey` wire field.
        #[serde(rename = "userNkey")]
        user_nkey: String,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `clientId` wire field.
        #[serde(rename = "clientId")]
        client_id: f64,
        /// The `connectedAt` wire field.
        #[serde(rename = "connectedAt")]
        connected_at: String,
        /// The `contractDisplayName` wire field.
        #[serde(rename = "contractDisplayName")]
        #[serde(skip_serializing_if = "Option::is_none")]
        contract_display_name: Option<String>,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `key` wire field.
        key: String,
        /// The `principal` wire field.
        principal: AuthConnectionsListResponseEntriesItemDevicePrincipal,
        /// The `serverId` wire field.
        #[serde(rename = "serverId")]
        server_id: String,
        /// The `sessionKey` wire field.
        #[serde(rename = "sessionKey")]
        session_key: String,
        /// The `userNkey` wire field.
        #[serde(rename = "userNkey")]
        user_nkey: String,
    },
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `clientId` wire field.
        #[serde(rename = "clientId")]
        client_id: f64,
        /// The `connectedAt` wire field.
        #[serde(rename = "connectedAt")]
        connected_at: String,
        /// The `key` wire field.
        key: String,
        /// The `principal` wire field.
        principal: AuthConnectionsListResponseEntriesItemServicePrincipal,
        /// The `serverId` wire field.
        #[serde(rename = "serverId")]
        server_id: String,
        /// The `sessionKey` wire field.
        #[serde(rename = "sessionKey")]
        session_key: String,
        /// The `userNkey` wire field.
        #[serde(rename = "userNkey")]
        user_nkey: String,
    },
}
/// Generated schema type `AuthConnectionsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthConnectionsListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationRequest {
    /// The `acknowledgement` wire field.
    pub acknowledgement: String,
    /// The `expectedDesiredVersion` wire field.
    #[serde(rename = "expectedDesiredVersion")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_desired_version: Option<String>,
    /// The `planId` wire field.
    #[serde(rename = "planId")]
    pub plan_id: String,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsCapabilitiesItem
{
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeeds {
    /// The `capabilities` wire field.
    pub capabilities: Vec<
        AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsCapabilitiesItem,
    >,
    /// The `contracts` wire field.
    pub contracts:
        Vec<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsContractsItem>,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredState {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `needs` wire field.
    pub needs: AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateNeeds,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredStateSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `cli` wire value.
    #[serde(rename = "cli")]
    Cli,
    /// The `native` wire value.
    #[serde(rename = "native")]
    Native,
    /// The `device-user` wire value.
    #[serde(rename = "device-user")]
    DeviceUser,
}
impl AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
            Self::App => "app",
            Self::Cli => "cli",
            Self::Native => "native",
            Self::DeviceUser => "device-user",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponseAuthority`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponseAuthority {
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `desiredState` wire field.
    #[serde(rename = "desiredState")]
    pub desired_state: AuthDeploymentAuthorityAcceptMigrationResponseAuthorityDesiredState,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityAcceptMigrationResponseAuthorityKind,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// The `version` wire field.
    pub version: String,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptMigrationResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptMigrationResponse {
    /// The `authority` wire field.
    pub authority: AuthDeploymentAuthorityAcceptMigrationResponseAuthority,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateRequest {
    /// The `expectedDesiredVersion` wire field.
    #[serde(rename = "expectedDesiredVersion")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_desired_version: Option<String>,
    /// The `planId` wire field.
    #[serde(rename = "planId")]
    pub plan_id: String,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsCapabilitiesItem {
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeeds {
    /// The `capabilities` wire field.
    pub capabilities:
        Vec<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsCapabilitiesItem>,
    /// The `contracts` wire field.
    pub contracts:
        Vec<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsContractsItem>,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action:
        Option<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredState {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `needs` wire field.
    pub needs: AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateNeeds,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces: Vec<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredStateSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `cli` wire value.
    #[serde(rename = "cli")]
    Cli,
    /// The `native` wire value.
    #[serde(rename = "native")]
    Native,
    /// The `device-user` wire value.
    #[serde(rename = "device-user")]
    DeviceUser,
}
impl AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
            Self::App => "app",
            Self::Cli => "cli",
            Self::Native => "native",
            Self::DeviceUser => "device-user",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponseAuthority`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponseAuthority {
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `desiredState` wire field.
    #[serde(rename = "desiredState")]
    pub desired_state: AuthDeploymentAuthorityAcceptUpdateResponseAuthorityDesiredState,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityAcceptUpdateResponseAuthorityKind,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// The `version` wire field.
    pub version: String,
}
/// Generated schema type `AuthDeploymentAuthorityAcceptUpdateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityAcceptUpdateResponse {
    /// The `authority` wire field.
    pub authority: AuthDeploymentAuthorityAcceptUpdateResponseAuthority,
}
/// Generated schema type `AuthDeploymentAuthorityGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsCapabilitiesItem {
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action:
        Option<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeeds {
    /// The `capabilities` wire field.
    pub capabilities:
        Vec<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsCapabilitiesItem>,
    /// The `contracts` wire field.
    pub contracts: Vec<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsContractsItem>,
    /// The `resources` wire field.
    pub resources: Vec<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces: Vec<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityDesiredState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthorityDesiredState {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `needs` wire field.
    pub needs: AuthDeploymentAuthorityGetResponseAuthorityDesiredStateNeeds,
    /// The `resources` wire field.
    pub resources: Vec<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces: Vec<AuthDeploymentAuthorityGetResponseAuthorityDesiredStateSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthorityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseAuthorityKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `cli` wire value.
    #[serde(rename = "cli")]
    Cli,
    /// The `native` wire value.
    #[serde(rename = "native")]
    Native,
    /// The `device-user` wire value.
    #[serde(rename = "device-user")]
    DeviceUser,
}
impl AuthDeploymentAuthorityGetResponseAuthorityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
            Self::App => "app",
            Self::Cli => "cli",
            Self::Native => "native",
            Self::DeviceUser => "device-user",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseAuthorityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityGetResponseAuthorityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityGetResponseAuthorityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseAuthorityKind> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityGetResponseAuthorityKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseAuthority`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponseAuthority {
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `desiredState` wire field.
    #[serde(rename = "desiredState")]
    pub desired_state: AuthDeploymentAuthorityGetResponseAuthorityDesiredState,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityGetResponseAuthorityKind,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// The `version` wire field.
    pub version: String,
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind {
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind {
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGetResponseGrantOverridesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AuthDeploymentAuthorityGetResponseGrantOverridesItem {
    /// The `CapabilityWeb` variant.
    CapabilityWeb {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind:
            AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilityGroupWeb` variant.
    CapabilityGroupWeb {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind:
            AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilitySession` variant.
    CapabilitySession {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind:
            AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilitySessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `CapabilityGroupSession` variant.
    CapabilityGroupSession {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind:
            AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind:
            AuthDeploymentAuthorityGetResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGetResponse {
    /// The `authority` wire field.
    pub authority: AuthDeploymentAuthorityGetResponseAuthority,
    /// The `grantOverrides` wire field.
    #[serde(rename = "grantOverrides")]
    pub grant_overrides: Vec<AuthDeploymentAuthorityGetResponseGrantOverridesItem>,
    /// The `materializedAuthority` wire field.
    #[serde(rename = "materializedAuthority")]
    pub materialized_authority: Option<BTreeMap<String, Value>>,
    /// The `portalRoute` wire field.
    #[serde(rename = "portalRoute")]
    pub portal_route: Option<BTreeMap<String, Value>>,
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGrantOverridesListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind {
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind {
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind
{
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind {
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind
{
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind
{
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl
    AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AuthDeploymentAuthorityGrantOverridesListResponseEntriesItem {
    /// The `CapabilityWeb` variant.
    CapabilityWeb {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilityGroupWeb` variant.
    CapabilityGroupWeb {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilitySession` variant.
    CapabilitySession {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilitySessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `CapabilityGroupSession` variant.
    CapabilityGroupSession {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesListResponseEntriesItemCapabilityGroupSessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGrantOverridesListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthDeploymentAuthorityGrantOverridesListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind {
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind {
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind
{
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind {
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind
{
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind
{
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl
    AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItem {
    /// The `CapabilityWeb` variant.
    CapabilityWeb {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilityGroupWeb` variant.
    CapabilityGroupWeb {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilitySession` variant.
    CapabilitySession {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilitySessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `CapabilityGroupSession` variant.
    CapabilityGroupSession {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItemCapabilityGroupSessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGrantOverridesPutRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `overrides` wire field.
    pub overrides: Vec<AuthDeploymentAuthorityGrantOverridesPutRequestOverridesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind
{
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind
{
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind
{
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl
    AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind
{
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind
{
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl
    AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind
{
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind
{
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItem {
    /// The `CapabilityWeb` variant.
    CapabilityWeb {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilityGroupWeb` variant.
    CapabilityGroupWeb {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilitySession` variant.
    CapabilitySession {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilitySessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `CapabilityGroupSession` variant.
    CapabilityGroupSession {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesPutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGrantOverridesPutResponse {
    /// The `grantOverrides` wire field.
    #[serde(rename = "grantOverrides")]
    pub grant_overrides: Vec<AuthDeploymentAuthorityGrantOverridesPutResponseGrantOverridesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind {
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind
{
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind
{
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind {
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind
{
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind
{
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl
    AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind
{
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItem {
    /// The `CapabilityWeb` variant.
    CapabilityWeb {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilityGroupWeb` variant.
    CapabilityGroupWeb {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilitySession` variant.
    CapabilitySession {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `CapabilityGroupSession` variant.
    CapabilityGroupSession {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilityGroupSessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGrantOverridesRemoveRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `overrides` wire field.
    pub overrides: Vec<AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind
{
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind
{
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind
{
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind
{
    /// The `web` wire value.
    #[serde(rename = "web")]
    Web,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Web => "web",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind
{
    /// The `capability` wire value.
    #[serde(rename = "capability")]
    Capability,
}
impl
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Capability => "capability",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind
{
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind
{
    /// The `capability-group` wire value.
    #[serde(rename = "capability-group")]
    CapabilityGroup,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::CapabilityGroup => "capability-group",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind
{
    /// The `session` wire value.
    #[serde(rename = "session")]
    Session,
}
impl AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItem {
    /// The `CapabilityWeb` variant.
    CapabilityWeb {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilityGroupWeb` variant.
    CapabilityGroupWeb {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupWebIdentityKind,
        /// The `origin` wire field.
        origin: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: Value,
    },
    /// The `CapabilitySession` variant.
    CapabilitySession {
        /// The `capability` wire field.
        capability: String,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: Value,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilitySessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `CapabilityGroupSession` variant.
    CapabilityGroupSession {
        /// The `capability` wire field.
        capability: Value,
        /// The `capabilityGroupKey` wire field.
        #[serde(rename = "capabilityGroupKey")]
        capability_group_key: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `grantKind` wire field.
        #[serde(rename = "grantKind")]
        grant_kind: AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionGrantKind,
        /// The `identityKind` wire field.
        #[serde(rename = "identityKind")]
        identity_kind: AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItemCapabilityGroupSessionIdentityKind,
        /// The `origin` wire field.
        origin: Value,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityGrantOverridesRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityGrantOverridesRemoveResponse {
    /// The `grantOverrides` wire field.
    #[serde(rename = "grantOverrides")]
    pub grant_overrides: Vec<AuthDeploymentAuthorityGrantOverridesRemoveResponseGrantOverridesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityListRequestKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityListRequestKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `cli` wire value.
    #[serde(rename = "cli")]
    Cli,
    /// The `native` wire value.
    #[serde(rename = "native")]
    Native,
    /// The `device-user` wire value.
    #[serde(rename = "device-user")]
    DeviceUser,
}
impl AuthDeploymentAuthorityListRequestKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
            Self::App => "app",
            Self::Cli => "cli",
            Self::Native => "native",
            Self::DeviceUser => "device-user",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityListRequestKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityListRequestKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityListRequestKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityListRequestKind> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityListRequestKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListRequest {
    /// The `disabled` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// The `kind` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<AuthDeploymentAuthorityListRequestKind>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsCapabilitiesItem {
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action:
        Option<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeeds {
    /// The `capabilities` wire field.
    pub capabilities:
        Vec<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsCapabilitiesItem>,
    /// The `contracts` wire field.
    pub contracts:
        Vec<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsContractsItem>,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces: Vec<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action:
        Option<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemDesiredState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItemDesiredState {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `needs` wire field.
    pub needs: AuthDeploymentAuthorityListResponseEntriesItemDesiredStateNeeds,
    /// The `resources` wire field.
    pub resources: Vec<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces: Vec<AuthDeploymentAuthorityListResponseEntriesItemDesiredStateSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityListResponseEntriesItemKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `cli` wire value.
    #[serde(rename = "cli")]
    Cli,
    /// The `native` wire value.
    #[serde(rename = "native")]
    Native,
    /// The `device-user` wire value.
    #[serde(rename = "device-user")]
    DeviceUser,
}
impl AuthDeploymentAuthorityListResponseEntriesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
            Self::App => "app",
            Self::Cli => "cli",
            Self::Native => "native",
            Self::DeviceUser => "device-user",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityListResponseEntriesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityListResponseEntriesItemKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityListResponseEntriesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityListResponseEntriesItemKind> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityListResponseEntriesItemKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponseEntriesItem {
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `desiredState` wire field.
    #[serde(rename = "desiredState")]
    pub desired_state: AuthDeploymentAuthorityListResponseEntriesItemDesiredState,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityListResponseEntriesItemKind,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// The `version` wire field.
    pub version: String,
}
/// Generated schema type `AuthDeploymentAuthorityListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthDeploymentAuthorityListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthDeploymentAuthorityPlanRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanRequest {
    /// The `contract` wire field.
    pub contract: BTreeMap<String, Value>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `expectedDigest` wire field.
    #[serde(rename = "expectedDigest")]
    pub expected_digest: String,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind {
    /// The `schema-required-removed` wire value.
    #[serde(rename = "schema-required-removed")]
    SchemaRequiredRemoved,
    /// The `schema-property-removed` wire value.
    #[serde(rename = "schema-property-removed")]
    SchemaPropertyRemoved,
    /// The `schema-property-type-changed` wire value.
    #[serde(rename = "schema-property-type-changed")]
    SchemaPropertyTypeChanged,
    /// The `schema-enum-value-removed` wire value.
    #[serde(rename = "schema-enum-value-removed")]
    SchemaEnumValueRemoved,
    /// The `schema-closed-shape-violation` wire value.
    #[serde(rename = "schema-closed-shape-violation")]
    SchemaClosedShapeViolation,
    /// The `surface-removed` wire value.
    #[serde(rename = "surface-removed")]
    SurfaceRemoved,
    /// The `surface-subject-changed` wire value.
    #[serde(rename = "surface-subject-changed")]
    SurfaceSubjectChanged,
    /// The `surface-required-capability-added` wire value.
    #[serde(rename = "surface-required-capability-added")]
    SurfaceRequiredCapabilityAdded,
    /// The `resource-shape-changed` wire value.
    #[serde(rename = "resource-shape-changed")]
    ResourceShapeChanged,
    /// The `resource-removed` wire value.
    #[serde(rename = "resource-removed")]
    ResourceRemoved,
    /// The `capability-removed` wire value.
    #[serde(rename = "capability-removed")]
    CapabilityRemoved,
    /// The `capability-required-changed` wire value.
    #[serde(rename = "capability-required-changed")]
    CapabilityRequiredChanged,
    /// The `digest-incompatible` wire value.
    #[serde(rename = "digest-incompatible")]
    DigestIncompatible,
    /// The `unresolved-ref` wire value.
    #[serde(rename = "unresolved-ref")]
    UnresolvedRef,
}
impl AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::SchemaRequiredRemoved => "schema-required-removed",
            Self::SchemaPropertyRemoved => "schema-property-removed",
            Self::SchemaPropertyTypeChanged => "schema-property-type-changed",
            Self::SchemaEnumValueRemoved => "schema-enum-value-removed",
            Self::SchemaClosedShapeViolation => "schema-closed-shape-violation",
            Self::SurfaceRemoved => "surface-removed",
            Self::SurfaceSubjectChanged => "surface-subject-changed",
            Self::SurfaceRequiredCapabilityAdded => "surface-required-capability-added",
            Self::ResourceShapeChanged => "resource-shape-changed",
            Self::ResourceRemoved => "resource-removed",
            Self::CapabilityRemoved => "capability-removed",
            Self::CapabilityRequiredChanged => "capability-required-changed",
            Self::DigestIncompatible => "digest-incompatible",
            Self::UnresolvedRef => "unresolved-ref",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
    /// The `job` wire value.
    #[serde(rename = "job")]
    Job,
}
impl AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
            Self::Job => "job",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTarget`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTarget {
    /// The `schema` variant.
    #[serde(rename = "schema")]
    Schema {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `schemaName` wire field.
        #[serde(rename = "schemaName")]
        schema_name: String,
    },
    /// The `surface` variant.
    #[serde(rename = "surface")]
    Surface {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `surfaceKind` wire field.
        #[serde(rename = "surfaceKind")]
        surface_kind: AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
        /// The `surfaceName` wire field.
        #[serde(rename = "surfaceName")]
        surface_name: String,
    },
    /// The `resource` variant.
    #[serde(rename = "resource")]
    Resource {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `resourceAlias` wire field.
        #[serde(rename = "resourceAlias")]
        resource_alias: String,
    },
    /// The `capability` variant.
    #[serde(rename = "capability")]
    Capability {
        /// The `capability` wire field.
        capability: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `contract` variant.
    #[serde(rename = "contract")]
    Contract {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `digest` variant.
    #[serde(rename = "digest")]
    Digest {
        /// The `contractDigest` wire field.
        #[serde(rename = "contractDigest")]
        contract_digest: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItem {
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemKind,
    /// The `path` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The `reason` wire field.
    pub reason: String,
    /// The `target` wire field.
    pub target: AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItemTarget,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action:
        Option<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsCapabilitiesItem {
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeeds {
    /// The `capabilities` wire field.
    pub capabilities:
        Vec<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsCapabilitiesItem>,
    /// The `contracts` wire field.
    pub contracts:
        Vec<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsContractsItem>,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateProposal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanUpdateProposal {
    /// The `contract` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<BTreeMap<String, Value>>,
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `proposalId` wire field.
    #[serde(rename = "proposalId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    /// The `providedSurfaces` wire field.
    #[serde(rename = "providedSurfaces")]
    pub provided_surfaces:
        Vec<AuthDeploymentAuthorityPlanResponsePlanUpdateProposalProvidedSurfacesItem>,
    /// The `requestedNeeds` wire field.
    #[serde(rename = "requestedNeeds")]
    pub requested_needs: AuthDeploymentAuthorityPlanResponsePlanUpdateProposalRequestedNeeds,
    /// The `summary` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<BTreeMap<String, Value>>,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanUpdateState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanUpdateState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `accepted` wire value.
    #[serde(rename = "accepted")]
    Accepted,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
    /// The `expired` wire value.
    #[serde(rename = "expired")]
    Expired,
    /// The `superseded` wire value.
    #[serde(rename = "superseded")]
    Superseded,
}
impl AuthDeploymentAuthorityPlanResponsePlanUpdateState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
            Self::Superseded => "superseded",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlanResponsePlanUpdateState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlanResponsePlanUpdateState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlanResponsePlanUpdateState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanUpdateState> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityPlanResponsePlanUpdateState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind {
    /// The `schema-required-removed` wire value.
    #[serde(rename = "schema-required-removed")]
    SchemaRequiredRemoved,
    /// The `schema-property-removed` wire value.
    #[serde(rename = "schema-property-removed")]
    SchemaPropertyRemoved,
    /// The `schema-property-type-changed` wire value.
    #[serde(rename = "schema-property-type-changed")]
    SchemaPropertyTypeChanged,
    /// The `schema-enum-value-removed` wire value.
    #[serde(rename = "schema-enum-value-removed")]
    SchemaEnumValueRemoved,
    /// The `schema-closed-shape-violation` wire value.
    #[serde(rename = "schema-closed-shape-violation")]
    SchemaClosedShapeViolation,
    /// The `surface-removed` wire value.
    #[serde(rename = "surface-removed")]
    SurfaceRemoved,
    /// The `surface-subject-changed` wire value.
    #[serde(rename = "surface-subject-changed")]
    SurfaceSubjectChanged,
    /// The `surface-required-capability-added` wire value.
    #[serde(rename = "surface-required-capability-added")]
    SurfaceRequiredCapabilityAdded,
    /// The `resource-shape-changed` wire value.
    #[serde(rename = "resource-shape-changed")]
    ResourceShapeChanged,
    /// The `resource-removed` wire value.
    #[serde(rename = "resource-removed")]
    ResourceRemoved,
    /// The `capability-removed` wire value.
    #[serde(rename = "capability-removed")]
    CapabilityRemoved,
    /// The `capability-required-changed` wire value.
    #[serde(rename = "capability-required-changed")]
    CapabilityRequiredChanged,
    /// The `digest-incompatible` wire value.
    #[serde(rename = "digest-incompatible")]
    DigestIncompatible,
    /// The `unresolved-ref` wire value.
    #[serde(rename = "unresolved-ref")]
    UnresolvedRef,
}
impl AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::SchemaRequiredRemoved => "schema-required-removed",
            Self::SchemaPropertyRemoved => "schema-property-removed",
            Self::SchemaPropertyTypeChanged => "schema-property-type-changed",
            Self::SchemaEnumValueRemoved => "schema-enum-value-removed",
            Self::SchemaClosedShapeViolation => "schema-closed-shape-violation",
            Self::SurfaceRemoved => "surface-removed",
            Self::SurfaceSubjectChanged => "surface-subject-changed",
            Self::SurfaceRequiredCapabilityAdded => "surface-required-capability-added",
            Self::ResourceShapeChanged => "resource-shape-changed",
            Self::ResourceRemoved => "resource-removed",
            Self::CapabilityRemoved => "capability-removed",
            Self::CapabilityRequiredChanged => "capability-required-changed",
            Self::DigestIncompatible => "digest-incompatible",
            Self::UnresolvedRef => "unresolved-ref",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
    /// The `job` wire value.
    #[serde(rename = "job")]
    Job,
}
impl AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
            Self::Job => "job",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTarget`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTarget {
    /// The `schema` variant.
    #[serde(rename = "schema")]
    Schema {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `schemaName` wire field.
        #[serde(rename = "schemaName")]
        schema_name: String,
    },
    /// The `surface` variant.
    #[serde(rename = "surface")]
    Surface {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `surfaceKind` wire field.
        #[serde(rename = "surfaceKind")]
        surface_kind: AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
        /// The `surfaceName` wire field.
        #[serde(rename = "surfaceName")]
        surface_name: String,
    },
    /// The `resource` variant.
    #[serde(rename = "resource")]
    Resource {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `resourceAlias` wire field.
        #[serde(rename = "resourceAlias")]
        resource_alias: String,
    },
    /// The `capability` variant.
    #[serde(rename = "capability")]
    Capability {
        /// The `capability` wire field.
        capability: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `contract` variant.
    #[serde(rename = "contract")]
    Contract {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `digest` variant.
    #[serde(rename = "digest")]
    Digest {
        /// The `contractDigest` wire field.
        #[serde(rename = "contractDigest")]
        contract_digest: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItem {
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemKind,
    /// The `path` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The `reason` wire field.
    pub reason: String,
    /// The `target` wire field.
    pub target: AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItemTarget,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action:
        Option<AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsCapabilitiesItem {
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeeds {
    /// The `capabilities` wire field.
    pub capabilities:
        Vec<AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsCapabilitiesItem>,
    /// The `contracts` wire field.
    pub contracts:
        Vec<AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsContractsItem>,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationProposal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponsePlanMigrationProposal {
    /// The `contract` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<BTreeMap<String, Value>>,
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `proposalId` wire field.
    #[serde(rename = "proposalId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    /// The `providedSurfaces` wire field.
    #[serde(rename = "providedSurfaces")]
    pub provided_surfaces:
        Vec<AuthDeploymentAuthorityPlanResponsePlanMigrationProposalProvidedSurfacesItem>,
    /// The `requestedNeeds` wire field.
    #[serde(rename = "requestedNeeds")]
    pub requested_needs: AuthDeploymentAuthorityPlanResponsePlanMigrationProposalRequestedNeeds,
    /// The `summary` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<BTreeMap<String, Value>>,
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlanMigrationState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlanResponsePlanMigrationState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `accepted` wire value.
    #[serde(rename = "accepted")]
    Accepted,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
    /// The `expired` wire value.
    #[serde(rename = "expired")]
    Expired,
    /// The `superseded` wire value.
    #[serde(rename = "superseded")]
    Superseded,
}
impl AuthDeploymentAuthorityPlanResponsePlanMigrationState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
            Self::Superseded => "superseded",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlanResponsePlanMigrationState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlanResponsePlanMigrationState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlanResponsePlanMigrationState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlanResponsePlanMigrationState> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityPlanResponsePlanMigrationState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponsePlan`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "classification")]
pub enum AuthDeploymentAuthorityPlanResponsePlan {
    /// The `update` variant.
    #[serde(rename = "update")]
    Update {
        /// The `breakingChanges` wire field.
        #[serde(rename = "breakingChanges")]
        breaking_changes: Vec<AuthDeploymentAuthorityPlanResponsePlanUpdateBreakingChangesItem>,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `decisionAt` wire field.
        #[serde(rename = "decisionAt")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_at: Option<Option<String>>,
        /// The `decisionBy` wire field.
        #[serde(rename = "decisionBy")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_by: Option<Option<BTreeMap<String, Value>>>,
        /// The `decisionReason` wire field.
        #[serde(rename = "decisionReason")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_reason: Option<Option<String>>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `desiredChange` wire field.
        #[serde(rename = "desiredChange")]
        desired_change: BTreeMap<String, Value>,
        /// The `expiresAt` wire field.
        #[serde(rename = "expiresAt")]
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: Option<String>,
        /// The `materializationPreview` wire field.
        #[serde(rename = "materializationPreview")]
        materialization_preview: BTreeMap<String, Value>,
        /// The `planId` wire field.
        #[serde(rename = "planId")]
        plan_id: String,
        /// The `proposal` wire field.
        proposal: AuthDeploymentAuthorityPlanResponsePlanUpdateProposal,
        /// The `state` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<AuthDeploymentAuthorityPlanResponsePlanUpdateState>,
    },
    /// The `migration` variant.
    #[serde(rename = "migration")]
    Migration {
        /// The `acknowledgementRequired` wire field.
        #[serde(rename = "acknowledgementRequired")]
        acknowledgement_required: bool,
        /// The `breakingChanges` wire field.
        #[serde(rename = "breakingChanges")]
        breaking_changes: Vec<AuthDeploymentAuthorityPlanResponsePlanMigrationBreakingChangesItem>,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `decisionAt` wire field.
        #[serde(rename = "decisionAt")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_at: Option<Option<String>>,
        /// The `decisionBy` wire field.
        #[serde(rename = "decisionBy")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_by: Option<Option<BTreeMap<String, Value>>>,
        /// The `decisionReason` wire field.
        #[serde(rename = "decisionReason")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_reason: Option<Option<String>>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `desiredChange` wire field.
        #[serde(rename = "desiredChange")]
        desired_change: BTreeMap<String, Value>,
        /// The `expiresAt` wire field.
        #[serde(rename = "expiresAt")]
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: Option<String>,
        /// The `materializationPreview` wire field.
        #[serde(rename = "materializationPreview")]
        materialization_preview: BTreeMap<String, Value>,
        /// The `planId` wire field.
        #[serde(rename = "planId")]
        plan_id: String,
        /// The `proposal` wire field.
        proposal: AuthDeploymentAuthorityPlanResponsePlanMigrationProposal,
        /// The `state` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<AuthDeploymentAuthorityPlanResponsePlanMigrationState>,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlanResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlanResponse {
    /// The `plan` wire field.
    pub plan: AuthDeploymentAuthorityPlanResponsePlan,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetRequest {
    /// The `planId` wire field.
    #[serde(rename = "planId")]
    pub plan_id: String,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind {
    /// The `schema-required-removed` wire value.
    #[serde(rename = "schema-required-removed")]
    SchemaRequiredRemoved,
    /// The `schema-property-removed` wire value.
    #[serde(rename = "schema-property-removed")]
    SchemaPropertyRemoved,
    /// The `schema-property-type-changed` wire value.
    #[serde(rename = "schema-property-type-changed")]
    SchemaPropertyTypeChanged,
    /// The `schema-enum-value-removed` wire value.
    #[serde(rename = "schema-enum-value-removed")]
    SchemaEnumValueRemoved,
    /// The `schema-closed-shape-violation` wire value.
    #[serde(rename = "schema-closed-shape-violation")]
    SchemaClosedShapeViolation,
    /// The `surface-removed` wire value.
    #[serde(rename = "surface-removed")]
    SurfaceRemoved,
    /// The `surface-subject-changed` wire value.
    #[serde(rename = "surface-subject-changed")]
    SurfaceSubjectChanged,
    /// The `surface-required-capability-added` wire value.
    #[serde(rename = "surface-required-capability-added")]
    SurfaceRequiredCapabilityAdded,
    /// The `resource-shape-changed` wire value.
    #[serde(rename = "resource-shape-changed")]
    ResourceShapeChanged,
    /// The `resource-removed` wire value.
    #[serde(rename = "resource-removed")]
    ResourceRemoved,
    /// The `capability-removed` wire value.
    #[serde(rename = "capability-removed")]
    CapabilityRemoved,
    /// The `capability-required-changed` wire value.
    #[serde(rename = "capability-required-changed")]
    CapabilityRequiredChanged,
    /// The `digest-incompatible` wire value.
    #[serde(rename = "digest-incompatible")]
    DigestIncompatible,
    /// The `unresolved-ref` wire value.
    #[serde(rename = "unresolved-ref")]
    UnresolvedRef,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::SchemaRequiredRemoved => "schema-required-removed",
            Self::SchemaPropertyRemoved => "schema-property-removed",
            Self::SchemaPropertyTypeChanged => "schema-property-type-changed",
            Self::SchemaEnumValueRemoved => "schema-enum-value-removed",
            Self::SchemaClosedShapeViolation => "schema-closed-shape-violation",
            Self::SurfaceRemoved => "surface-removed",
            Self::SurfaceSubjectChanged => "surface-subject-changed",
            Self::SurfaceRequiredCapabilityAdded => "surface-required-capability-added",
            Self::ResourceShapeChanged => "resource-shape-changed",
            Self::ResourceRemoved => "resource-removed",
            Self::CapabilityRemoved => "capability-removed",
            Self::CapabilityRequiredChanged => "capability-required-changed",
            Self::DigestIncompatible => "digest-incompatible",
            Self::UnresolvedRef => "unresolved-ref",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
    /// The `job` wire value.
    #[serde(rename = "job")]
    Job,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
            Self::Job => "job",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTarget`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTarget {
    /// The `schema` variant.
    #[serde(rename = "schema")]
    Schema {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `schemaName` wire field.
        #[serde(rename = "schemaName")]
        schema_name: String,
    },
    /// The `surface` variant.
    #[serde(rename = "surface")]
    Surface {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `surfaceKind` wire field.
        #[serde(rename = "surfaceKind")]
        surface_kind: AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
        /// The `surfaceName` wire field.
        #[serde(rename = "surfaceName")]
        surface_name: String,
    },
    /// The `resource` variant.
    #[serde(rename = "resource")]
    Resource {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `resourceAlias` wire field.
        #[serde(rename = "resourceAlias")]
        resource_alias: String,
    },
    /// The `capability` variant.
    #[serde(rename = "capability")]
    Capability {
        /// The `capability` wire field.
        capability: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `contract` variant.
    #[serde(rename = "contract")]
    Contract {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `digest` variant.
    #[serde(rename = "digest")]
    Digest {
        /// The `contractDigest` wire field.
        #[serde(rename = "contractDigest")]
        contract_digest: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItem {
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemKind,
    /// The `path` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The `reason` wire field.
    pub reason: String,
    /// The `target` wire field.
    pub target: AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItemTarget,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action:
        Option<AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsCapabilitiesItem {
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeeds {
    /// The `capabilities` wire field.
    pub capabilities: Vec<
        AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsCapabilitiesItem,
    >,
    /// The `contracts` wire field.
    pub contracts:
        Vec<AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsContractsItem>,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposal {
    /// The `contract` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<BTreeMap<String, Value>>,
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `proposalId` wire field.
    #[serde(rename = "proposalId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    /// The `providedSurfaces` wire field.
    #[serde(rename = "providedSurfaces")]
    pub provided_surfaces:
        Vec<AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalProvidedSurfacesItem>,
    /// The `requestedNeeds` wire field.
    #[serde(rename = "requestedNeeds")]
    pub requested_needs: AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposalRequestedNeeds,
    /// The `summary` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<BTreeMap<String, Value>>,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanUpdateState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanUpdateState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `accepted` wire value.
    #[serde(rename = "accepted")]
    Accepted,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
    /// The `expired` wire value.
    #[serde(rename = "expired")]
    Expired,
    /// The `superseded` wire value.
    #[serde(rename = "superseded")]
    Superseded,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanUpdateState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
            Self::Superseded => "superseded",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansGetResponsePlanUpdateState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlansGetResponsePlanUpdateState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlansGetResponsePlanUpdateState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansGetResponsePlanUpdateState> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityPlansGetResponsePlanUpdateState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind {
    /// The `schema-required-removed` wire value.
    #[serde(rename = "schema-required-removed")]
    SchemaRequiredRemoved,
    /// The `schema-property-removed` wire value.
    #[serde(rename = "schema-property-removed")]
    SchemaPropertyRemoved,
    /// The `schema-property-type-changed` wire value.
    #[serde(rename = "schema-property-type-changed")]
    SchemaPropertyTypeChanged,
    /// The `schema-enum-value-removed` wire value.
    #[serde(rename = "schema-enum-value-removed")]
    SchemaEnumValueRemoved,
    /// The `schema-closed-shape-violation` wire value.
    #[serde(rename = "schema-closed-shape-violation")]
    SchemaClosedShapeViolation,
    /// The `surface-removed` wire value.
    #[serde(rename = "surface-removed")]
    SurfaceRemoved,
    /// The `surface-subject-changed` wire value.
    #[serde(rename = "surface-subject-changed")]
    SurfaceSubjectChanged,
    /// The `surface-required-capability-added` wire value.
    #[serde(rename = "surface-required-capability-added")]
    SurfaceRequiredCapabilityAdded,
    /// The `resource-shape-changed` wire value.
    #[serde(rename = "resource-shape-changed")]
    ResourceShapeChanged,
    /// The `resource-removed` wire value.
    #[serde(rename = "resource-removed")]
    ResourceRemoved,
    /// The `capability-removed` wire value.
    #[serde(rename = "capability-removed")]
    CapabilityRemoved,
    /// The `capability-required-changed` wire value.
    #[serde(rename = "capability-required-changed")]
    CapabilityRequiredChanged,
    /// The `digest-incompatible` wire value.
    #[serde(rename = "digest-incompatible")]
    DigestIncompatible,
    /// The `unresolved-ref` wire value.
    #[serde(rename = "unresolved-ref")]
    UnresolvedRef,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::SchemaRequiredRemoved => "schema-required-removed",
            Self::SchemaPropertyRemoved => "schema-property-removed",
            Self::SchemaPropertyTypeChanged => "schema-property-type-changed",
            Self::SchemaEnumValueRemoved => "schema-enum-value-removed",
            Self::SchemaClosedShapeViolation => "schema-closed-shape-violation",
            Self::SurfaceRemoved => "surface-removed",
            Self::SurfaceSubjectChanged => "surface-subject-changed",
            Self::SurfaceRequiredCapabilityAdded => "surface-required-capability-added",
            Self::ResourceShapeChanged => "resource-shape-changed",
            Self::ResourceRemoved => "resource-removed",
            Self::CapabilityRemoved => "capability-removed",
            Self::CapabilityRequiredChanged => "capability-required-changed",
            Self::DigestIncompatible => "digest-incompatible",
            Self::UnresolvedRef => "unresolved-ref",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
    /// The `job` wire value.
    #[serde(rename = "job")]
    Job,
}
impl
    AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
            Self::Job => "job",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTarget`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTarget {
    /// The `schema` variant.
    #[serde(rename = "schema")]
    Schema {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `schemaName` wire field.
        #[serde(rename = "schemaName")]
        schema_name: String,
    },
    /// The `surface` variant.
    #[serde(rename = "surface")]
    Surface {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `surfaceKind` wire field.
        #[serde(rename = "surfaceKind")]
        surface_kind: AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
        /// The `surfaceName` wire field.
        #[serde(rename = "surfaceName")]
        surface_name: String,
    },
    /// The `resource` variant.
    #[serde(rename = "resource")]
    Resource {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `resourceAlias` wire field.
        #[serde(rename = "resourceAlias")]
        resource_alias: String,
    },
    /// The `capability` variant.
    #[serde(rename = "capability")]
    Capability {
        /// The `capability` wire field.
        capability: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `contract` variant.
    #[serde(rename = "contract")]
    Contract {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `digest` variant.
    #[serde(rename = "digest")]
    Digest {
        /// The `contractDigest` wire field.
        #[serde(rename = "contractDigest")]
        contract_digest: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItem {
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemKind,
    /// The `path` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The `reason` wire field.
    pub reason: String,
    /// The `target` wire field.
    pub target: AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItemTarget,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsCapabilitiesItem
{
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind
{
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction
{
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeeds {
    /// The `capabilities` wire field.
    pub capabilities: Vec<
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsCapabilitiesItem,
    >,
    /// The `contracts` wire field.
    pub contracts: Vec<
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsContractsItem,
    >,
    /// The `resources` wire field.
    pub resources: Vec<
        AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsResourcesItem,
    >,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposal {
    /// The `contract` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<BTreeMap<String, Value>>,
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `proposalId` wire field.
    #[serde(rename = "proposalId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    /// The `providedSurfaces` wire field.
    #[serde(rename = "providedSurfaces")]
    pub provided_surfaces:
        Vec<AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalProvidedSurfacesItem>,
    /// The `requestedNeeds` wire field.
    #[serde(rename = "requestedNeeds")]
    pub requested_needs: AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposalRequestedNeeds,
    /// The `summary` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<BTreeMap<String, Value>>,
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlanMigrationState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansGetResponsePlanMigrationState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `accepted` wire value.
    #[serde(rename = "accepted")]
    Accepted,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
    /// The `expired` wire value.
    #[serde(rename = "expired")]
    Expired,
    /// The `superseded` wire value.
    #[serde(rename = "superseded")]
    Superseded,
}
impl AuthDeploymentAuthorityPlansGetResponsePlanMigrationState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
            Self::Superseded => "superseded",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansGetResponsePlanMigrationState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlansGetResponsePlanMigrationState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlansGetResponsePlanMigrationState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansGetResponsePlanMigrationState> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityPlansGetResponsePlanMigrationState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponsePlan`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "classification")]
pub enum AuthDeploymentAuthorityPlansGetResponsePlan {
    /// The `update` variant.
    #[serde(rename = "update")]
    Update {
        /// The `breakingChanges` wire field.
        #[serde(rename = "breakingChanges")]
        breaking_changes: Vec<AuthDeploymentAuthorityPlansGetResponsePlanUpdateBreakingChangesItem>,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `decisionAt` wire field.
        #[serde(rename = "decisionAt")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_at: Option<Option<String>>,
        /// The `decisionBy` wire field.
        #[serde(rename = "decisionBy")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_by: Option<Option<BTreeMap<String, Value>>>,
        /// The `decisionReason` wire field.
        #[serde(rename = "decisionReason")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_reason: Option<Option<String>>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `desiredChange` wire field.
        #[serde(rename = "desiredChange")]
        desired_change: BTreeMap<String, Value>,
        /// The `expiresAt` wire field.
        #[serde(rename = "expiresAt")]
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: Option<String>,
        /// The `materializationPreview` wire field.
        #[serde(rename = "materializationPreview")]
        materialization_preview: BTreeMap<String, Value>,
        /// The `planId` wire field.
        #[serde(rename = "planId")]
        plan_id: String,
        /// The `proposal` wire field.
        proposal: AuthDeploymentAuthorityPlansGetResponsePlanUpdateProposal,
        /// The `state` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<AuthDeploymentAuthorityPlansGetResponsePlanUpdateState>,
    },
    /// The `migration` variant.
    #[serde(rename = "migration")]
    Migration {
        /// The `acknowledgementRequired` wire field.
        #[serde(rename = "acknowledgementRequired")]
        acknowledgement_required: bool,
        /// The `breakingChanges` wire field.
        #[serde(rename = "breakingChanges")]
        breaking_changes:
            Vec<AuthDeploymentAuthorityPlansGetResponsePlanMigrationBreakingChangesItem>,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `decisionAt` wire field.
        #[serde(rename = "decisionAt")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_at: Option<Option<String>>,
        /// The `decisionBy` wire field.
        #[serde(rename = "decisionBy")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_by: Option<Option<BTreeMap<String, Value>>>,
        /// The `decisionReason` wire field.
        #[serde(rename = "decisionReason")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_reason: Option<Option<String>>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `desiredChange` wire field.
        #[serde(rename = "desiredChange")]
        desired_change: BTreeMap<String, Value>,
        /// The `expiresAt` wire field.
        #[serde(rename = "expiresAt")]
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: Option<String>,
        /// The `materializationPreview` wire field.
        #[serde(rename = "materializationPreview")]
        materialization_preview: BTreeMap<String, Value>,
        /// The `planId` wire field.
        #[serde(rename = "planId")]
        plan_id: String,
        /// The `proposal` wire field.
        proposal: AuthDeploymentAuthorityPlansGetResponsePlanMigrationProposal,
        /// The `state` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<AuthDeploymentAuthorityPlansGetResponsePlanMigrationState>,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlansGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansGetResponse {
    /// The `plan` wire field.
    pub plan: AuthDeploymentAuthorityPlansGetResponsePlan,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListRequestClassification`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListRequestClassification {
    /// The `update` wire value.
    #[serde(rename = "update")]
    Update,
    /// The `migration` wire value.
    #[serde(rename = "migration")]
    Migration,
}
impl AuthDeploymentAuthorityPlansListRequestClassification {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Update => "update",
            Self::Migration => "migration",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansListRequestClassification {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlansListRequestClassification {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlansListRequestClassification {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansListRequestClassification> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityPlansListRequestClassification) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListRequestKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListRequestKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `cli` wire value.
    #[serde(rename = "cli")]
    Cli,
    /// The `native` wire value.
    #[serde(rename = "native")]
    Native,
    /// The `device-user` wire value.
    #[serde(rename = "device-user")]
    DeviceUser,
}
impl AuthDeploymentAuthorityPlansListRequestKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
            Self::App => "app",
            Self::Cli => "cli",
            Self::Native => "native",
            Self::DeviceUser => "device-user",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansListRequestKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlansListRequestKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlansListRequestKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansListRequestKind> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityPlansListRequestKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListRequestState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListRequestState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `accepted` wire value.
    #[serde(rename = "accepted")]
    Accepted,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
    /// The `expired` wire value.
    #[serde(rename = "expired")]
    Expired,
    /// The `superseded` wire value.
    #[serde(rename = "superseded")]
    Superseded,
}
impl AuthDeploymentAuthorityPlansListRequestState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
            Self::Superseded => "superseded",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansListRequestState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlansListRequestState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlansListRequestState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansListRequestState> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityPlansListRequestState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListRequest {
    /// The `classification` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classification: Option<AuthDeploymentAuthorityPlansListRequestClassification>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    /// The `kind` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<AuthDeploymentAuthorityPlansListRequestKind>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `state` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<AuthDeploymentAuthorityPlansListRequestState>,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind {
    /// The `schema-required-removed` wire value.
    #[serde(rename = "schema-required-removed")]
    SchemaRequiredRemoved,
    /// The `schema-property-removed` wire value.
    #[serde(rename = "schema-property-removed")]
    SchemaPropertyRemoved,
    /// The `schema-property-type-changed` wire value.
    #[serde(rename = "schema-property-type-changed")]
    SchemaPropertyTypeChanged,
    /// The `schema-enum-value-removed` wire value.
    #[serde(rename = "schema-enum-value-removed")]
    SchemaEnumValueRemoved,
    /// The `schema-closed-shape-violation` wire value.
    #[serde(rename = "schema-closed-shape-violation")]
    SchemaClosedShapeViolation,
    /// The `surface-removed` wire value.
    #[serde(rename = "surface-removed")]
    SurfaceRemoved,
    /// The `surface-subject-changed` wire value.
    #[serde(rename = "surface-subject-changed")]
    SurfaceSubjectChanged,
    /// The `surface-required-capability-added` wire value.
    #[serde(rename = "surface-required-capability-added")]
    SurfaceRequiredCapabilityAdded,
    /// The `resource-shape-changed` wire value.
    #[serde(rename = "resource-shape-changed")]
    ResourceShapeChanged,
    /// The `resource-removed` wire value.
    #[serde(rename = "resource-removed")]
    ResourceRemoved,
    /// The `capability-removed` wire value.
    #[serde(rename = "capability-removed")]
    CapabilityRemoved,
    /// The `capability-required-changed` wire value.
    #[serde(rename = "capability-required-changed")]
    CapabilityRequiredChanged,
    /// The `digest-incompatible` wire value.
    #[serde(rename = "digest-incompatible")]
    DigestIncompatible,
    /// The `unresolved-ref` wire value.
    #[serde(rename = "unresolved-ref")]
    UnresolvedRef,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::SchemaRequiredRemoved => "schema-required-removed",
            Self::SchemaPropertyRemoved => "schema-property-removed",
            Self::SchemaPropertyTypeChanged => "schema-property-type-changed",
            Self::SchemaEnumValueRemoved => "schema-enum-value-removed",
            Self::SchemaClosedShapeViolation => "schema-closed-shape-violation",
            Self::SurfaceRemoved => "surface-removed",
            Self::SurfaceSubjectChanged => "surface-subject-changed",
            Self::SurfaceRequiredCapabilityAdded => "surface-required-capability-added",
            Self::ResourceShapeChanged => "resource-shape-changed",
            Self::ResourceRemoved => "resource-removed",
            Self::CapabilityRemoved => "capability-removed",
            Self::CapabilityRequiredChanged => "capability-required-changed",
            Self::DigestIncompatible => "digest-incompatible",
            Self::UnresolvedRef => "unresolved-ref",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
    /// The `job` wire value.
    #[serde(rename = "job")]
    Job,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
            Self::Job => "job",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTarget`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTarget {
    /// The `schema` variant.
    #[serde(rename = "schema")]
    Schema {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `schemaName` wire field.
        #[serde(rename = "schemaName")]
        schema_name: String,
    },
    /// The `surface` variant.
    #[serde(rename = "surface")]
    Surface {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `surfaceKind` wire field.
        #[serde(rename = "surfaceKind")]
        surface_kind: AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTargetSurfaceSurfaceKind,
        /// The `surfaceName` wire field.
        #[serde(rename = "surfaceName")]
        surface_name: String,
    },
    /// The `resource` variant.
    #[serde(rename = "resource")]
    Resource {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `resourceAlias` wire field.
        #[serde(rename = "resourceAlias")]
        resource_alias: String,
    },
    /// The `capability` variant.
    #[serde(rename = "capability")]
    Capability {
        /// The `capability` wire field.
        capability: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `contract` variant.
    #[serde(rename = "contract")]
    Contract {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `digest` variant.
    #[serde(rename = "digest")]
    Digest {
        /// The `contractDigest` wire field.
        #[serde(rename = "contractDigest")]
        contract_digest: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItem {
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemKind,
    /// The `path` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The `reason` wire field.
    pub reason: String,
    /// The `target` wire field.
    pub target: AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItemTarget,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction
{
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind:
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsCapabilitiesItem
{
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsContractsItem
{
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind
{
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl
    AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction
{
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl
    AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeeds {
    /// The `capabilities` wire field.
    pub capabilities: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsCapabilitiesItem,
    >,
    /// The `contracts` wire field.
    pub contracts: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsContractsItem,
    >,
    /// The `resources` wire field.
    pub resources: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsResourcesItem,
    >,
    /// The `surfaces` wire field.
    pub surfaces: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeedsSurfacesItem,
    >,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposal {
    /// The `contract` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<BTreeMap<String, Value>>,
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `proposalId` wire field.
    #[serde(rename = "proposalId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    /// The `providedSurfaces` wire field.
    #[serde(rename = "providedSurfaces")]
    pub provided_surfaces:
        Vec<AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalProvidedSurfacesItem>,
    /// The `requestedNeeds` wire field.
    #[serde(rename = "requestedNeeds")]
    pub requested_needs:
        AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposalRequestedNeeds,
    /// The `summary` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<BTreeMap<String, Value>>,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `accepted` wire value.
    #[serde(rename = "accepted")]
    Accepted,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
    /// The `expired` wire value.
    #[serde(rename = "expired")]
    Expired,
    /// The `superseded` wire value.
    #[serde(rename = "superseded")]
    Superseded,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
            Self::Superseded => "superseded",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind {
    /// The `schema-required-removed` wire value.
    #[serde(rename = "schema-required-removed")]
    SchemaRequiredRemoved,
    /// The `schema-property-removed` wire value.
    #[serde(rename = "schema-property-removed")]
    SchemaPropertyRemoved,
    /// The `schema-property-type-changed` wire value.
    #[serde(rename = "schema-property-type-changed")]
    SchemaPropertyTypeChanged,
    /// The `schema-enum-value-removed` wire value.
    #[serde(rename = "schema-enum-value-removed")]
    SchemaEnumValueRemoved,
    /// The `schema-closed-shape-violation` wire value.
    #[serde(rename = "schema-closed-shape-violation")]
    SchemaClosedShapeViolation,
    /// The `surface-removed` wire value.
    #[serde(rename = "surface-removed")]
    SurfaceRemoved,
    /// The `surface-subject-changed` wire value.
    #[serde(rename = "surface-subject-changed")]
    SurfaceSubjectChanged,
    /// The `surface-required-capability-added` wire value.
    #[serde(rename = "surface-required-capability-added")]
    SurfaceRequiredCapabilityAdded,
    /// The `resource-shape-changed` wire value.
    #[serde(rename = "resource-shape-changed")]
    ResourceShapeChanged,
    /// The `resource-removed` wire value.
    #[serde(rename = "resource-removed")]
    ResourceRemoved,
    /// The `capability-removed` wire value.
    #[serde(rename = "capability-removed")]
    CapabilityRemoved,
    /// The `capability-required-changed` wire value.
    #[serde(rename = "capability-required-changed")]
    CapabilityRequiredChanged,
    /// The `digest-incompatible` wire value.
    #[serde(rename = "digest-incompatible")]
    DigestIncompatible,
    /// The `unresolved-ref` wire value.
    #[serde(rename = "unresolved-ref")]
    UnresolvedRef,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::SchemaRequiredRemoved => "schema-required-removed",
            Self::SchemaPropertyRemoved => "schema-property-removed",
            Self::SchemaPropertyTypeChanged => "schema-property-type-changed",
            Self::SchemaEnumValueRemoved => "schema-enum-value-removed",
            Self::SchemaClosedShapeViolation => "schema-closed-shape-violation",
            Self::SurfaceRemoved => "surface-removed",
            Self::SurfaceSubjectChanged => "surface-subject-changed",
            Self::SurfaceRequiredCapabilityAdded => "surface-required-capability-added",
            Self::ResourceShapeChanged => "resource-shape-changed",
            Self::ResourceRemoved => "resource-removed",
            Self::CapabilityRemoved => "capability-removed",
            Self::CapabilityRequiredChanged => "capability-required-changed",
            Self::DigestIncompatible => "digest-incompatible",
            Self::UnresolvedRef => "unresolved-ref",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
    /// The `job` wire value.
    #[serde(rename = "job")]
    Job,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
            Self::Job => "job",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTarget`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTarget {
    /// The `schema` variant.
    #[serde(rename = "schema")]
    Schema {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `schemaName` wire field.
        #[serde(rename = "schemaName")]
        schema_name: String,
    },
    /// The `surface` variant.
    #[serde(rename = "surface")]
    Surface {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `surfaceKind` wire field.
        #[serde(rename = "surfaceKind")]
        surface_kind: AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTargetSurfaceSurfaceKind,
        /// The `surfaceName` wire field.
        #[serde(rename = "surfaceName")]
        surface_name: String,
    },
    /// The `resource` variant.
    #[serde(rename = "resource")]
    Resource {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `resourceAlias` wire field.
        #[serde(rename = "resourceAlias")]
        resource_alias: String,
    },
    /// The `capability` variant.
    #[serde(rename = "capability")]
    Capability {
        /// The `capability` wire field.
        capability: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `contract` variant.
    #[serde(rename = "contract")]
    Contract {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
    /// The `digest` variant.
    #[serde(rename = "digest")]
    Digest {
        /// The `contractDigest` wire field.
        #[serde(rename = "contractDigest")]
        contract_digest: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItem {
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemKind,
    /// The `path` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The `reason` wire field.
    pub reason: String,
    /// The `target` wire field.
    pub target:
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItemTarget,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction
{
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl
    AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction
{
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsCapabilitiesItem
{
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsContractsItem
{
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind
{
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction
{
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeeds {
    /// The `capabilities` wire field.
    pub capabilities: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsCapabilitiesItem,
    >,
    /// The `contracts` wire field.
    pub contracts: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsContractsItem,
    >,
    /// The `resources` wire field.
    pub resources: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsResourcesItem,
    >,
    /// The `surfaces` wire field.
    pub surfaces: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeedsSurfacesItem,
    >,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposal {
    /// The `contract` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<BTreeMap<String, Value>>,
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `proposalId` wire field.
    #[serde(rename = "proposalId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    /// The `providedSurfaces` wire field.
    #[serde(rename = "providedSurfaces")]
    pub provided_surfaces: Vec<
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalProvidedSurfacesItem,
    >,
    /// The `requestedNeeds` wire field.
    #[serde(rename = "requestedNeeds")]
    pub requested_needs:
        AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposalRequestedNeeds,
    /// The `summary` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<BTreeMap<String, Value>>,
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `accepted` wire value.
    #[serde(rename = "accepted")]
    Accepted,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
    /// The `expired` wire value.
    #[serde(rename = "expired")]
    Expired,
    /// The `superseded` wire value.
    #[serde(rename = "superseded")]
    Superseded,
}
impl AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
            Self::Superseded => "superseded",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "classification")]
pub enum AuthDeploymentAuthorityPlansListResponseEntriesItem {
    /// The `update` variant.
    #[serde(rename = "update")]
    Update {
        /// The `breakingChanges` wire field.
        #[serde(rename = "breakingChanges")]
        breaking_changes:
            Vec<AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateBreakingChangesItem>,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `decisionAt` wire field.
        #[serde(rename = "decisionAt")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_at: Option<Option<String>>,
        /// The `decisionBy` wire field.
        #[serde(rename = "decisionBy")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_by: Option<Option<BTreeMap<String, Value>>>,
        /// The `decisionReason` wire field.
        #[serde(rename = "decisionReason")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_reason: Option<Option<String>>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `desiredChange` wire field.
        #[serde(rename = "desiredChange")]
        desired_change: BTreeMap<String, Value>,
        /// The `expiresAt` wire field.
        #[serde(rename = "expiresAt")]
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: Option<String>,
        /// The `materializationPreview` wire field.
        #[serde(rename = "materializationPreview")]
        materialization_preview: BTreeMap<String, Value>,
        /// The `planId` wire field.
        #[serde(rename = "planId")]
        plan_id: String,
        /// The `proposal` wire field.
        proposal: AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateProposal,
        /// The `state` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<AuthDeploymentAuthorityPlansListResponseEntriesItemUpdateState>,
    },
    /// The `migration` variant.
    #[serde(rename = "migration")]
    Migration {
        /// The `acknowledgementRequired` wire field.
        #[serde(rename = "acknowledgementRequired")]
        acknowledgement_required: bool,
        /// The `breakingChanges` wire field.
        #[serde(rename = "breakingChanges")]
        breaking_changes:
            Vec<AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationBreakingChangesItem>,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `decisionAt` wire field.
        #[serde(rename = "decisionAt")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_at: Option<Option<String>>,
        /// The `decisionBy` wire field.
        #[serde(rename = "decisionBy")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_by: Option<Option<BTreeMap<String, Value>>>,
        /// The `decisionReason` wire field.
        #[serde(rename = "decisionReason")]
        #[serde(
            default,
            deserialize_with = "deserialize_optional_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        decision_reason: Option<Option<String>>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `desiredChange` wire field.
        #[serde(rename = "desiredChange")]
        desired_change: BTreeMap<String, Value>,
        /// The `expiresAt` wire field.
        #[serde(rename = "expiresAt")]
        #[serde(skip_serializing_if = "Option::is_none")]
        expires_at: Option<String>,
        /// The `materializationPreview` wire field.
        #[serde(rename = "materializationPreview")]
        materialization_preview: BTreeMap<String, Value>,
        /// The `planId` wire field.
        #[serde(rename = "planId")]
        plan_id: String,
        /// The `proposal` wire field.
        proposal: AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationProposal,
        /// The `state` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<AuthDeploymentAuthorityPlansListResponseEntriesItemMigrationState>,
    },
}
/// Generated schema type `AuthDeploymentAuthorityPlansListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityPlansListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthDeploymentAuthorityPlansListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `desiredVersion` wire field.
    #[serde(rename = "desiredVersion")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desired_version: Option<String>,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsCapabilitiesItem {
    /// The `capability` wire field.
    pub capability: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsContractsItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeeds`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeeds {
    /// The `capabilities` wire field.
    pub capabilities:
        Vec<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsCapabilitiesItem>,
    /// The `contracts` wire field.
    pub contracts:
        Vec<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsContractsItem>,
    /// The `resources` wire field.
    pub resources:
        Vec<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeedsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `definition` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<BTreeMap<String, Value>>,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItemKind,
    /// The `required` wire field.
    pub required: bool,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind {
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action:
        Option<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemAction>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItemKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityDesiredState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthorityDesiredState {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `needs` wire field.
    pub needs: AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateNeeds,
    /// The `resources` wire field.
    pub resources: Vec<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateResourcesItem>,
    /// The `surfaces` wire field.
    pub surfaces: Vec<AuthDeploymentAuthorityReconcileResponseAuthorityDesiredStateSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthorityKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseAuthorityKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `cli` wire value.
    #[serde(rename = "cli")]
    Cli,
    /// The `native` wire value.
    #[serde(rename = "native")]
    Native,
    /// The `device-user` wire value.
    #[serde(rename = "device-user")]
    DeviceUser,
}
impl AuthDeploymentAuthorityReconcileResponseAuthorityKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
            Self::App => "app",
            Self::Cli => "cli",
            Self::Native => "native",
            Self::DeviceUser => "device-user",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityReconcileResponseAuthorityKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityReconcileResponseAuthorityKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityReconcileResponseAuthorityKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseAuthorityKind> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityReconcileResponseAuthorityKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseAuthority`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseAuthority {
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `desiredState` wire field.
    #[serde(rename = "desiredState")]
    pub desired_state: AuthDeploymentAuthorityReconcileResponseAuthorityDesiredState,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityReconcileResponseAuthorityKind,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// The `version` wire field.
    pub version: String,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsCapabilitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsCapabilitiesItem {
    /// The `capability` wire field.
    pub capability: String,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection {
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
}
impl AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource
{
    /// The `owned-surface` wire value.
    #[serde(rename = "owned-surface")]
    OwnedSurface,
    /// The `used-surface` wire value.
    #[serde(rename = "used-surface")]
    UsedSurface,
    /// The `resource-binding` wire value.
    #[serde(rename = "resource-binding")]
    ResourceBinding,
    /// The `platform-service` wire value.
    #[serde(rename = "platform-service")]
    PlatformService,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::OwnedSurface => "owned-surface",
            Self::UsedSurface => "used-surface",
            Self::ResourceBinding => "resource-binding",
            Self::PlatformService => "platform-service",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction
{
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction,
> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurface`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurface {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurfaceKind,
    /// The `name` wire field.
    pub name: String,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItem {
    /// The `direction` wire field.
    pub direction:
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemDirection,
    /// The `grantSource` wire field.
    #[serde(rename = "grantSource")]
    pub grant_source:
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemGrantSource,
    /// The `requiredCapabilities` wire field.
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    /// The `subject` wire field.
    pub subject: String,
    /// The `surface` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface: Option<
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItemSurface,
    >,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction {
    /// The `call` wire value.
    #[serde(rename = "call")]
    Call,
    /// The `publish` wire value.
    #[serde(rename = "publish")]
    Publish,
    /// The `subscribe` wire value.
    #[serde(rename = "subscribe")]
    Subscribe,
    /// The `observe` wire value.
    #[serde(rename = "observe")]
    Observe,
    /// The `cancel` wire value.
    #[serde(rename = "cancel")]
    Cancel,
}
impl AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Call => "call",
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
            Self::Observe => "observe",
            Self::Cancel => "cancel",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind
{
    /// The `rpc` wire value.
    #[serde(rename = "rpc")]
    Rpc,
    /// The `operation` wire value.
    #[serde(rename = "operation")]
    Operation,
    /// The `event` wire value.
    #[serde(rename = "event")]
    Event,
    /// The `feed` wire value.
    #[serde(rename = "feed")]
    Feed,
}
impl AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Operation => "operation",
            Self::Event => "event",
            Self::Feed => "feed",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind,
    > for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItem {
    /// The `action` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemAction,
    >,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `name` wire field.
    pub name: String,
    /// The `surfaceKind` wire field.
    #[serde(rename = "surfaceKind")]
    pub surface_kind:
        AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItemSurfaceKind,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrants`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrants {
    /// The `capabilities` wire field.
    pub capabilities:
        Vec<AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsCapabilitiesItem>,
    /// The `nats` wire field.
    #[serde(rename = "nats")]
    pub transport_rules:
        Vec<AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsTransportItem>,
    /// The `surfaces` wire field.
    pub surfaces:
        Vec<AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrantsSurfacesItem>,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind {
    /// The `kv` wire value.
    #[serde(rename = "kv")]
    Kv,
    /// The `store` wire value.
    #[serde(rename = "store")]
    Store,
    /// The `jobs` wire value.
    #[serde(rename = "jobs")]
    Jobs,
    /// The `event-consumer` wire value.
    #[serde(rename = "event-consumer")]
    EventConsumer,
    /// The `transfer` wire value.
    #[serde(rename = "transfer")]
    Transfer,
}
impl AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Kv => "kv",
            Self::Store => "store",
            Self::Jobs => "jobs",
            Self::EventConsumer => "event-consumer",
            Self::Transfer => "transfer",
        }
    }
}
impl AsRef<str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItem {
    /// The `alias` wire field.
    pub alias: String,
    /// The `binding` wire field.
    pub binding: BTreeMap<String, Value>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItemKind,
    /// The `limits` wire field.
    pub limits: Option<BTreeMap<String, Value>>,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus {
    /// The `current` wire value.
    #[serde(rename = "current")]
    Current,
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `failed` wire value.
    #[serde(rename = "failed")]
    Failed,
}
impl AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::Pending => "pending",
            Self::Failed => "failed",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseMaterializedAuthority`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseMaterializedAuthority {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `desiredVersion` wire field.
    #[serde(rename = "desiredVersion")]
    pub desired_version: String,
    /// The `error` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The `grants` wire field.
    pub grants: AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityGrants,
    /// The `reconciledAt` wire field.
    #[serde(rename = "reconciledAt")]
    pub reconciled_at: Option<String>,
    /// The `resourceBindings` wire field.
    #[serde(rename = "resourceBindings")]
    pub resource_bindings:
        Vec<AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityResourceBindingsItem>,
    /// The `status` wire field.
    pub status: AuthDeploymentAuthorityReconcileResponseMaterializedAuthorityStatus,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseReconciliationState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentAuthorityReconcileResponseReconciliationState {
    /// The `idle` wire value.
    #[serde(rename = "idle")]
    Idle,
    /// The `running` wire value.
    #[serde(rename = "running")]
    Running,
    /// The `succeeded` wire value.
    #[serde(rename = "succeeded")]
    Succeeded,
    /// The `failed` wire value.
    #[serde(rename = "failed")]
    Failed,
}
impl AuthDeploymentAuthorityReconcileResponseReconciliationState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}
impl AsRef<str> for AuthDeploymentAuthorityReconcileResponseReconciliationState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentAuthorityReconcileResponseReconciliationState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentAuthorityReconcileResponseReconciliationState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentAuthorityReconcileResponseReconciliationState> for &str {
    fn eq(&self, other: &AuthDeploymentAuthorityReconcileResponseReconciliationState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponseReconciliation`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponseReconciliation {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `desiredVersion` wire field.
    #[serde(rename = "desiredVersion")]
    pub desired_version: String,
    /// The `finishedAt` wire field.
    #[serde(rename = "finishedAt")]
    pub finished_at: Option<String>,
    /// The `message` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// The `startedAt` wire field.
    #[serde(rename = "startedAt")]
    pub started_at: Option<String>,
    /// The `state` wire field.
    pub state: AuthDeploymentAuthorityReconcileResponseReconciliationState,
}
/// Generated schema type `AuthDeploymentAuthorityReconcileResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityReconcileResponse {
    /// The `authority` wire field.
    pub authority: AuthDeploymentAuthorityReconcileResponseAuthority,
    /// The `materializedAuthority` wire field.
    #[serde(rename = "materializedAuthority")]
    pub materialized_authority: AuthDeploymentAuthorityReconcileResponseMaterializedAuthority,
    /// The `reconciliation` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconciliation: Option<AuthDeploymentAuthorityReconcileResponseReconciliation>,
}
/// Generated schema type `AuthDeploymentAuthorityRejectRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityRejectRequest {
    /// The `planId` wire field.
    #[serde(rename = "planId")]
    pub plan_id: String,
    /// The `reason` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
/// Generated schema type `AuthDeploymentAuthorityRejectResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentAuthorityRejectResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthDeploymentsCreateRequestServiceContractCompatibilityMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsCreateRequestServiceContractCompatibilityMode {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `mutable-dev` wire value.
    #[serde(rename = "mutable-dev")]
    MutableDev,
}
impl AuthDeploymentsCreateRequestServiceContractCompatibilityMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::MutableDev => "mutable-dev",
        }
    }
}
impl AsRef<str> for AuthDeploymentsCreateRequestServiceContractCompatibilityMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsCreateRequestServiceContractCompatibilityMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsCreateRequestServiceContractCompatibilityMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsCreateRequestServiceContractCompatibilityMode> for &str {
    fn eq(&self, other: &AuthDeploymentsCreateRequestServiceContractCompatibilityMode) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsCreateRequestDeviceReviewMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsCreateRequestDeviceReviewMode {
    /// The `none` wire value.
    #[serde(rename = "none")]
    None,
    /// The `required` wire value.
    #[serde(rename = "required")]
    Required,
}
impl AuthDeploymentsCreateRequestDeviceReviewMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Required => "required",
        }
    }
}
impl AsRef<str> for AuthDeploymentsCreateRequestDeviceReviewMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsCreateRequestDeviceReviewMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsCreateRequestDeviceReviewMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsCreateRequestDeviceReviewMode> for &str {
    fn eq(&self, other: &AuthDeploymentsCreateRequestDeviceReviewMode) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsCreateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentsCreateRequest {
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `contractCompatibilityMode` wire field.
        #[serde(rename = "contractCompatibilityMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        contract_compatibility_mode:
            Option<AuthDeploymentsCreateRequestServiceContractCompatibilityMode>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `namespaces` wire field.
        namespaces: Vec<String>,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `reviewMode` wire field.
        #[serde(rename = "reviewMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        review_mode: Option<AuthDeploymentsCreateRequestDeviceReviewMode>,
    },
}
/// Generated schema type `AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `mutable-dev` wire value.
    #[serde(rename = "mutable-dev")]
    MutableDev,
}
impl AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::MutableDev => "mutable-dev",
        }
    }
}
impl AsRef<str> for AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsCreateResponseDeploymentDeviceReviewMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsCreateResponseDeploymentDeviceReviewMode {
    /// The `none` wire value.
    #[serde(rename = "none")]
    None,
    /// The `required` wire value.
    #[serde(rename = "required")]
    Required,
}
impl AuthDeploymentsCreateResponseDeploymentDeviceReviewMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Required => "required",
        }
    }
}
impl AsRef<str> for AuthDeploymentsCreateResponseDeploymentDeviceReviewMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsCreateResponseDeploymentDeviceReviewMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsCreateResponseDeploymentDeviceReviewMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsCreateResponseDeploymentDeviceReviewMode> for &str {
    fn eq(&self, other: &AuthDeploymentsCreateResponseDeploymentDeviceReviewMode) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsCreateResponseDeployment`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentsCreateResponseDeployment {
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `contractCompatibilityMode` wire field.
        #[serde(rename = "contractCompatibilityMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        contract_compatibility_mode:
            Option<AuthDeploymentsCreateResponseDeploymentServiceContractCompatibilityMode>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `disabled` wire field.
        disabled: bool,
        /// The `namespaces` wire field.
        namespaces: Vec<String>,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `disabled` wire field.
        disabled: bool,
        /// The `reviewMode` wire field.
        #[serde(rename = "reviewMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        review_mode: Option<AuthDeploymentsCreateResponseDeploymentDeviceReviewMode>,
    },
}
/// Generated schema type `AuthDeploymentsCreateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsCreateResponse {
    /// The `deployment` wire field.
    pub deployment: AuthDeploymentsCreateResponseDeployment,
}
/// Generated schema type `AuthDeploymentsDisableRequestKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsDisableRequestKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
}
impl AuthDeploymentsDisableRequestKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
        }
    }
}
impl AsRef<str> for AuthDeploymentsDisableRequestKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsDisableRequestKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsDisableRequestKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsDisableRequestKind> for &str {
    fn eq(&self, other: &AuthDeploymentsDisableRequestKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsDisableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsDisableRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentsDisableRequestKind,
}
/// Generated schema type `AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `mutable-dev` wire value.
    #[serde(rename = "mutable-dev")]
    MutableDev,
}
impl AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::MutableDev => "mutable-dev",
        }
    }
}
impl AsRef<str> for AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsDisableResponseDeploymentDeviceReviewMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsDisableResponseDeploymentDeviceReviewMode {
    /// The `none` wire value.
    #[serde(rename = "none")]
    None,
    /// The `required` wire value.
    #[serde(rename = "required")]
    Required,
}
impl AuthDeploymentsDisableResponseDeploymentDeviceReviewMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Required => "required",
        }
    }
}
impl AsRef<str> for AuthDeploymentsDisableResponseDeploymentDeviceReviewMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsDisableResponseDeploymentDeviceReviewMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsDisableResponseDeploymentDeviceReviewMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsDisableResponseDeploymentDeviceReviewMode> for &str {
    fn eq(&self, other: &AuthDeploymentsDisableResponseDeploymentDeviceReviewMode) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsDisableResponseDeployment`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentsDisableResponseDeployment {
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `contractCompatibilityMode` wire field.
        #[serde(rename = "contractCompatibilityMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        contract_compatibility_mode:
            Option<AuthDeploymentsDisableResponseDeploymentServiceContractCompatibilityMode>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `disabled` wire field.
        disabled: bool,
        /// The `namespaces` wire field.
        namespaces: Vec<String>,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `disabled` wire field.
        disabled: bool,
        /// The `reviewMode` wire field.
        #[serde(rename = "reviewMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        review_mode: Option<AuthDeploymentsDisableResponseDeploymentDeviceReviewMode>,
    },
}
/// Generated schema type `AuthDeploymentsDisableResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsDisableResponse {
    /// The `deployment` wire field.
    pub deployment: AuthDeploymentsDisableResponseDeployment,
}
/// Generated schema type `AuthDeploymentsEnableRequestKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsEnableRequestKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
}
impl AuthDeploymentsEnableRequestKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
        }
    }
}
impl AsRef<str> for AuthDeploymentsEnableRequestKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsEnableRequestKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsEnableRequestKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsEnableRequestKind> for &str {
    fn eq(&self, other: &AuthDeploymentsEnableRequestKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsEnableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsEnableRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentsEnableRequestKind,
}
/// Generated schema type `AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `mutable-dev` wire value.
    #[serde(rename = "mutable-dev")]
    MutableDev,
}
impl AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::MutableDev => "mutable-dev",
        }
    }
}
impl AsRef<str> for AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsEnableResponseDeploymentDeviceReviewMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsEnableResponseDeploymentDeviceReviewMode {
    /// The `none` wire value.
    #[serde(rename = "none")]
    None,
    /// The `required` wire value.
    #[serde(rename = "required")]
    Required,
}
impl AuthDeploymentsEnableResponseDeploymentDeviceReviewMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Required => "required",
        }
    }
}
impl AsRef<str> for AuthDeploymentsEnableResponseDeploymentDeviceReviewMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsEnableResponseDeploymentDeviceReviewMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsEnableResponseDeploymentDeviceReviewMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsEnableResponseDeploymentDeviceReviewMode> for &str {
    fn eq(&self, other: &AuthDeploymentsEnableResponseDeploymentDeviceReviewMode) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsEnableResponseDeployment`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentsEnableResponseDeployment {
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `contractCompatibilityMode` wire field.
        #[serde(rename = "contractCompatibilityMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        contract_compatibility_mode:
            Option<AuthDeploymentsEnableResponseDeploymentServiceContractCompatibilityMode>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `disabled` wire field.
        disabled: bool,
        /// The `namespaces` wire field.
        namespaces: Vec<String>,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `disabled` wire field.
        disabled: bool,
        /// The `reviewMode` wire field.
        #[serde(rename = "reviewMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        review_mode: Option<AuthDeploymentsEnableResponseDeploymentDeviceReviewMode>,
    },
}
/// Generated schema type `AuthDeploymentsEnableResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsEnableResponse {
    /// The `deployment` wire field.
    pub deployment: AuthDeploymentsEnableResponseDeployment,
}
/// Generated schema type `AuthDeploymentsListRequestKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsListRequestKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
}
impl AuthDeploymentsListRequestKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
        }
    }
}
impl AsRef<str> for AuthDeploymentsListRequestKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsListRequestKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsListRequestKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsListRequestKind> for &str {
    fn eq(&self, other: &AuthDeploymentsListRequestKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsListRequest {
    /// The `disabled` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// The `kind` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<AuthDeploymentsListRequestKind>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `mutable-dev` wire value.
    #[serde(rename = "mutable-dev")]
    MutableDev,
}
impl AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::MutableDev => "mutable-dev",
        }
    }
}
impl AsRef<str> for AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode> for &str {
    fn eq(
        &self,
        other: &AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsListResponseEntriesItemDeviceReviewMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsListResponseEntriesItemDeviceReviewMode {
    /// The `none` wire value.
    #[serde(rename = "none")]
    None,
    /// The `required` wire value.
    #[serde(rename = "required")]
    Required,
}
impl AuthDeploymentsListResponseEntriesItemDeviceReviewMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Required => "required",
        }
    }
}
impl AsRef<str> for AuthDeploymentsListResponseEntriesItemDeviceReviewMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsListResponseEntriesItemDeviceReviewMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsListResponseEntriesItemDeviceReviewMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsListResponseEntriesItemDeviceReviewMode> for &str {
    fn eq(&self, other: &AuthDeploymentsListResponseEntriesItemDeviceReviewMode) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthDeploymentsListResponseEntriesItem {
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `contractCompatibilityMode` wire field.
        #[serde(rename = "contractCompatibilityMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        contract_compatibility_mode:
            Option<AuthDeploymentsListResponseEntriesItemServiceContractCompatibilityMode>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `disabled` wire field.
        disabled: bool,
        /// The `namespaces` wire field.
        namespaces: Vec<String>,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `disabled` wire field.
        disabled: bool,
        /// The `reviewMode` wire field.
        #[serde(rename = "reviewMode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        review_mode: Option<AuthDeploymentsListResponseEntriesItemDeviceReviewMode>,
    },
}
/// Generated schema type `AuthDeploymentsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthDeploymentsListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthDeploymentsRemoveRequestKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeploymentsRemoveRequestKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
}
impl AuthDeploymentsRemoveRequestKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
        }
    }
}
impl AsRef<str> for AuthDeploymentsRemoveRequestKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeploymentsRemoveRequestKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeploymentsRemoveRequestKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeploymentsRemoveRequestKind> for &str {
    fn eq(&self, other: &AuthDeploymentsRemoveRequestKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeploymentsRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsRemoveRequest {
    /// The `cascade` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cascade: Option<bool>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `kind` wire field.
    pub kind: AuthDeploymentsRemoveRequestKind,
    /// The `purgeUnusedContracts` wire field.
    #[serde(rename = "purgeUnusedContracts")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purge_unused_contracts: Option<bool>,
}
/// Generated schema type `AuthDeploymentsRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeploymentsRemoveResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthDeviceUserAuthoritiesListRequestState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesListRequestState {
    /// The `activated` wire value.
    #[serde(rename = "activated")]
    Activated,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
}
impl AuthDeviceUserAuthoritiesListRequestState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Activated => "activated",
            Self::Revoked => "revoked",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesListRequestState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesListRequestState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesListRequestState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesListRequestState> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesListRequestState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `state` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<AuthDeviceUserAuthoritiesListRequestState>,
}
/// Generated schema type `AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedBy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedBy {
    /// The `identity` wire field.
    pub identity: AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByIdentity,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind:
        AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedByParticipantKind,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesListResponseEntriesItemState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesListResponseEntriesItemState {
    /// The `activated` wire value.
    #[serde(rename = "activated")]
    Activated,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
}
impl AuthDeviceUserAuthoritiesListResponseEntriesItemState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Activated => "activated",
            Self::Revoked => "revoked",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesListResponseEntriesItemState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesListResponseEntriesItemState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesListResponseEntriesItemState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesListResponseEntriesItemState> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesListResponseEntriesItemState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListResponseEntriesItem {
    /// The `activatedAt` wire field.
    #[serde(rename = "activatedAt")]
    pub activated_at: String,
    /// The `activatedBy` wire field.
    #[serde(rename = "activatedBy")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activated_by: Option<AuthDeviceUserAuthoritiesListResponseEntriesItemActivatedBy>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `revokedAt` wire field.
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    /// The `state` wire field.
    pub state: AuthDeviceUserAuthoritiesListResponseEntriesItemState,
}
/// Generated schema type `AuthDeviceUserAuthoritiesListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthDeviceUserAuthoritiesListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideRequestDecision`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesReviewsDecideRequestDecision {
    /// The `approve` wire value.
    #[serde(rename = "approve")]
    Approve,
    /// The `reject` wire value.
    #[serde(rename = "reject")]
    Reject,
}
impl AuthDeviceUserAuthoritiesReviewsDecideRequestDecision {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::Reject => "reject",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesReviewsDecideRequestDecision {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesReviewsDecideRequestDecision {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesReviewsDecideRequestDecision {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesReviewsDecideRequestDecision> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesReviewsDecideRequestDecision) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideRequest {
    /// The `decision` wire field.
    pub decision: AuthDeviceUserAuthoritiesReviewsDecideRequestDecision,
    /// The `reason` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The `reviewId` wire field.
    #[serde(rename = "reviewId")]
    pub review_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str>
    for AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind>
    for &str
{
    fn eq(
        &self,
        other: &AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedBy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedBy {
    /// The `identity` wire field.
    pub identity: AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByIdentity,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind:
        AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedByParticipantKind,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState {
    /// The `activated` wire value.
    #[serde(rename = "activated")]
    Activated,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
}
impl AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Activated => "activated",
            Self::Revoked => "revoked",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseActivation`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponseActivation {
    /// The `activatedAt` wire field.
    #[serde(rename = "activatedAt")]
    pub activated_at: String,
    /// The `activatedBy` wire field.
    #[serde(rename = "activatedBy")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activated_by: Option<AuthDeviceUserAuthoritiesReviewsDecideResponseActivationActivatedBy>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `revokedAt` wire field.
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    /// The `state` wire field.
    pub state: AuthDeviceUserAuthoritiesReviewsDecideResponseActivationState,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `approved` wire value.
    #[serde(rename = "approved")]
    Approved,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
}
impl AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponseReview`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponseReview {
    /// The `decidedAt` wire field.
    #[serde(rename = "decidedAt")]
    pub decided_at: Option<String>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `reason` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The `requestedAt` wire field.
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    /// The `reviewId` wire field.
    #[serde(rename = "reviewId")]
    pub review_id: String,
    /// The `state` wire field.
    pub state: AuthDeviceUserAuthoritiesReviewsDecideResponseReviewState,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsDecideResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsDecideResponse {
    /// The `activation` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activation: Option<AuthDeviceUserAuthoritiesReviewsDecideResponseActivation>,
    /// The `confirmationCode` wire field.
    #[serde(rename = "confirmationCode")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation_code: Option<String>,
    /// The `review` wire field.
    pub review: AuthDeviceUserAuthoritiesReviewsDecideResponseReview,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsListRequestState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesReviewsListRequestState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `approved` wire value.
    #[serde(rename = "approved")]
    Approved,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
}
impl AuthDeviceUserAuthoritiesReviewsListRequestState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesReviewsListRequestState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesReviewsListRequestState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesReviewsListRequestState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesReviewsListRequestState> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesReviewsListRequestState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsListRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `state` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<AuthDeviceUserAuthoritiesReviewsListRequestState>,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState {
    /// The `pending` wire value.
    #[serde(rename = "pending")]
    Pending,
    /// The `approved` wire value.
    #[serde(rename = "approved")]
    Approved,
    /// The `rejected` wire value.
    #[serde(rename = "rejected")]
    Rejected,
}
impl AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsListResponseEntriesItem {
    /// The `decidedAt` wire field.
    #[serde(rename = "decidedAt")]
    pub decided_at: Option<String>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `reason` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The `requestedAt` wire field.
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    /// The `reviewId` wire field.
    #[serde(rename = "reviewId")]
    pub review_id: String,
    /// The `state` wire field.
    pub state: AuthDeviceUserAuthoritiesReviewsListResponseEntriesItemState,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewsListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthDeviceUserAuthoritiesReviewsListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthDeviceUserAuthoritiesRevokeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRevokeRequest {
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesRevokeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRevokeResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthDevicesConnectInfoGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetRequest {
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `iat` wire field.
    pub iat: f64,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `sig` wire field.
    pub sig: String,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority {
    /// The `admin_reviewed` wire value.
    #[serde(rename = "admin_reviewed")]
    AdminReviewed,
    /// The `user_delegated` wire value.
    #[serde(rename = "user_delegated")]
    UserDelegated,
}
impl AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::AdminReviewed => "admin_reviewed",
            Self::UserDelegated => "user_delegated",
        }
    }
}
impl AsRef<str> for AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority> for &str {
    fn eq(&self, other: &AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoAuthMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDevicesConnectInfoGetResponseConnectInfoAuthMode {
    /// The `device_identity` wire value.
    #[serde(rename = "device_identity")]
    DeviceIdentity,
}
impl AuthDevicesConnectInfoGetResponseConnectInfoAuthMode {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::DeviceIdentity => "device_identity",
        }
    }
}
impl AsRef<str> for AuthDevicesConnectInfoGetResponseConnectInfoAuthMode {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDevicesConnectInfoGetResponseConnectInfoAuthMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDevicesConnectInfoGetResponseConnectInfoAuthMode {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDevicesConnectInfoGetResponseConnectInfoAuthMode> for &str {
    fn eq(&self, other: &AuthDevicesConnectInfoGetResponseConnectInfoAuthMode) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoAuth`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoAuth {
    /// The `authority` wire field.
    pub authority: AuthDevicesConnectInfoGetResponseConnectInfoAuthAuthority,
    /// The `iatSkewSeconds` wire field.
    #[serde(rename = "iatSkewSeconds")]
    pub iat_skew_seconds: f64,
    /// The `mode` wire field.
    pub mode: AuthDevicesConnectInfoGetResponseConnectInfoAuthMode,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransportSentinel`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransportSentinel {
    /// The `jwt` wire field.
    pub jwt: String,
    /// The `seed` wire field.
    pub seed: String,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransport`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransport {
    /// The `sentinel` wire field.
    pub sentinel: AuthDevicesConnectInfoGetResponseConnectInfoTransportSentinel,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransportsNative`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransportsNative {
    /// The `natsServers` wire field.
    #[serde(rename = "natsServers")]
    pub servers: Vec<String>,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransportsWebsocket`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransportsWebsocket {
    /// The `natsServers` wire field.
    #[serde(rename = "natsServers")]
    pub servers: Vec<String>,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfoTransports`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfoTransports {
    /// The `native` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native: Option<AuthDevicesConnectInfoGetResponseConnectInfoTransportsNative>,
    /// The `websocket` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket: Option<AuthDevicesConnectInfoGetResponseConnectInfoTransportsWebsocket>,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseConnectInfo`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponseConnectInfo {
    /// The `auth` wire field.
    pub auth: AuthDevicesConnectInfoGetResponseConnectInfoAuth,
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `transport` wire field.
    pub transport: AuthDevicesConnectInfoGetResponseConnectInfoTransport,
    /// The `transports` wire field.
    pub transports: AuthDevicesConnectInfoGetResponseConnectInfoTransports,
}
/// Generated schema type `AuthDevicesConnectInfoGetResponseStatus`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDevicesConnectInfoGetResponseStatus {
    /// The `ready` wire value.
    #[serde(rename = "ready")]
    Ready,
}
impl AuthDevicesConnectInfoGetResponseStatus {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Ready => "ready",
        }
    }
}
impl AsRef<str> for AuthDevicesConnectInfoGetResponseStatus {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDevicesConnectInfoGetResponseStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDevicesConnectInfoGetResponseStatus {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDevicesConnectInfoGetResponseStatus> for &str {
    fn eq(&self, other: &AuthDevicesConnectInfoGetResponseStatus) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDevicesConnectInfoGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesConnectInfoGetResponse {
    /// The `connectInfo` wire field.
    #[serde(rename = "connectInfo")]
    pub connect_info: AuthDevicesConnectInfoGetResponseConnectInfo,
    /// The `status` wire field.
    pub status: AuthDevicesConnectInfoGetResponseStatus,
}
/// Generated schema type `AuthDevicesDisableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesDisableRequest {
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthDevicesDisableResponseInstanceState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDevicesDisableResponseInstanceState {
    /// The `registered` wire value.
    #[serde(rename = "registered")]
    Registered,
    /// The `activated` wire value.
    #[serde(rename = "activated")]
    Activated,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
    /// The `disabled` wire value.
    #[serde(rename = "disabled")]
    Disabled,
}
impl AuthDevicesDisableResponseInstanceState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Activated => "activated",
            Self::Revoked => "revoked",
            Self::Disabled => "disabled",
        }
    }
}
impl AsRef<str> for AuthDevicesDisableResponseInstanceState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDevicesDisableResponseInstanceState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDevicesDisableResponseInstanceState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDevicesDisableResponseInstanceState> for &str {
    fn eq(&self, other: &AuthDevicesDisableResponseInstanceState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDevicesDisableResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesDisableResponseInstance {
    /// The `activatedAt` wire field.
    #[serde(rename = "activatedAt")]
    pub activated_at: Option<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `metadata` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `revokedAt` wire field.
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    /// The `state` wire field.
    pub state: AuthDevicesDisableResponseInstanceState,
}
/// Generated schema type `AuthDevicesDisableResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesDisableResponse {
    /// The `instance` wire field.
    pub instance: AuthDevicesDisableResponseInstance,
}
/// Generated schema type `AuthDevicesEnableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesEnableRequest {
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthDevicesEnableResponseInstanceState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDevicesEnableResponseInstanceState {
    /// The `registered` wire value.
    #[serde(rename = "registered")]
    Registered,
    /// The `activated` wire value.
    #[serde(rename = "activated")]
    Activated,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
    /// The `disabled` wire value.
    #[serde(rename = "disabled")]
    Disabled,
}
impl AuthDevicesEnableResponseInstanceState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Activated => "activated",
            Self::Revoked => "revoked",
            Self::Disabled => "disabled",
        }
    }
}
impl AsRef<str> for AuthDevicesEnableResponseInstanceState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDevicesEnableResponseInstanceState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDevicesEnableResponseInstanceState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDevicesEnableResponseInstanceState> for &str {
    fn eq(&self, other: &AuthDevicesEnableResponseInstanceState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDevicesEnableResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesEnableResponseInstance {
    /// The `activatedAt` wire field.
    #[serde(rename = "activatedAt")]
    pub activated_at: Option<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `metadata` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `revokedAt` wire field.
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    /// The `state` wire field.
    pub state: AuthDevicesEnableResponseInstanceState,
}
/// Generated schema type `AuthDevicesEnableResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesEnableResponse {
    /// The `instance` wire field.
    pub instance: AuthDevicesEnableResponseInstance,
}
/// Generated schema type `AuthDevicesListRequestState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDevicesListRequestState {
    /// The `registered` wire value.
    #[serde(rename = "registered")]
    Registered,
    /// The `activated` wire value.
    #[serde(rename = "activated")]
    Activated,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
    /// The `disabled` wire value.
    #[serde(rename = "disabled")]
    Disabled,
}
impl AuthDevicesListRequestState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Activated => "activated",
            Self::Revoked => "revoked",
            Self::Disabled => "disabled",
        }
    }
}
impl AsRef<str> for AuthDevicesListRequestState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDevicesListRequestState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDevicesListRequestState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDevicesListRequestState> for &str {
    fn eq(&self, other: &AuthDevicesListRequestState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDevicesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesListRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `state` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<AuthDevicesListRequestState>,
}
/// Generated schema type `AuthDevicesListResponseEntriesItemState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDevicesListResponseEntriesItemState {
    /// The `registered` wire value.
    #[serde(rename = "registered")]
    Registered,
    /// The `activated` wire value.
    #[serde(rename = "activated")]
    Activated,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
    /// The `disabled` wire value.
    #[serde(rename = "disabled")]
    Disabled,
}
impl AuthDevicesListResponseEntriesItemState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Activated => "activated",
            Self::Revoked => "revoked",
            Self::Disabled => "disabled",
        }
    }
}
impl AsRef<str> for AuthDevicesListResponseEntriesItemState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDevicesListResponseEntriesItemState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDevicesListResponseEntriesItemState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDevicesListResponseEntriesItemState> for &str {
    fn eq(&self, other: &AuthDevicesListResponseEntriesItemState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDevicesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesListResponseEntriesItem {
    /// The `activatedAt` wire field.
    #[serde(rename = "activatedAt")]
    pub activated_at: Option<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `metadata` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `revokedAt` wire field.
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    /// The `state` wire field.
    pub state: AuthDevicesListResponseEntriesItemState,
}
/// Generated schema type `AuthDevicesListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthDevicesListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthDevicesProvisionRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesProvisionRequest {
    /// The `activationKey` wire field.
    #[serde(rename = "activationKey")]
    pub activation_key: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `metadata` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
}
/// Generated schema type `AuthDevicesProvisionResponseInstanceState`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDevicesProvisionResponseInstanceState {
    /// The `registered` wire value.
    #[serde(rename = "registered")]
    Registered,
    /// The `activated` wire value.
    #[serde(rename = "activated")]
    Activated,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
    /// The `disabled` wire value.
    #[serde(rename = "disabled")]
    Disabled,
}
impl AuthDevicesProvisionResponseInstanceState {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Activated => "activated",
            Self::Revoked => "revoked",
            Self::Disabled => "disabled",
        }
    }
}
impl AsRef<str> for AuthDevicesProvisionResponseInstanceState {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDevicesProvisionResponseInstanceState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDevicesProvisionResponseInstanceState {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDevicesProvisionResponseInstanceState> for &str {
    fn eq(&self, other: &AuthDevicesProvisionResponseInstanceState) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDevicesProvisionResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesProvisionResponseInstance {
    /// The `activatedAt` wire field.
    #[serde(rename = "activatedAt")]
    pub activated_at: Option<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `metadata` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `revokedAt` wire field.
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    /// The `state` wire field.
    pub state: AuthDevicesProvisionResponseInstanceState,
}
/// Generated schema type `AuthDevicesProvisionResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesProvisionResponse {
    /// The `instance` wire field.
    pub instance: AuthDevicesProvisionResponseInstance,
}
/// Generated schema type `AuthDevicesRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesRemoveRequest {
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthDevicesRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDevicesRemoveResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthEventConsumersListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEventConsumersListRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthEventConsumersListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEventConsumersListResponseEntriesItem {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `filterSubjects` wire field.
    #[serde(rename = "filterSubjects")]
    pub filter_subjects: Vec<String>,
    /// The `group` wire field.
    pub group: String,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `ordering` wire field.
    pub ordering: String,
    /// The `replay` wire field.
    pub replay: String,
    /// The `stream` wire field.
    pub stream: String,
}
/// Generated schema type `AuthEventConsumersListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEventConsumersListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthEventConsumersListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthEventsValidateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEventsValidateRequest {
    /// The `eventId` wire field.
    #[serde(rename = "eventId")]
    pub event_id: String,
    /// The `eventTime` wire field.
    #[serde(rename = "eventTime")]
    pub event_time: String,
    /// The `payloadHash` wire field.
    #[serde(rename = "payloadHash")]
    pub payload_hash: String,
    /// The `proof` wire field.
    pub proof: String,
    /// The `sessionKey` wire field.
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthEventsValidateResponseCallerUserIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEventsValidateResponseCallerUserIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthEventsValidateResponseCallerUserParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthEventsValidateResponseCallerUserParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthEventsValidateResponseCallerUserParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthEventsValidateResponseCallerUserParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthEventsValidateResponseCallerUserParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthEventsValidateResponseCallerUserParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthEventsValidateResponseCallerUserParticipantKind> for &str {
    fn eq(&self, other: &AuthEventsValidateResponseCallerUserParticipantKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthEventsValidateResponseCaller`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum AuthEventsValidateResponseCaller {
    /// The `user` variant.
    #[serde(rename = "user")]
    User {
        /// The `active` wire field.
        active: bool,
        /// The `capabilities` wire field.
        capabilities: Vec<String>,
        /// The `email` wire field.
        email: String,
        /// The `emailVerified` wire field.
        #[serde(rename = "emailVerified")]
        email_verified: bool,
        /// The `identity` wire field.
        identity: AuthEventsValidateResponseCallerUserIdentity,
        /// The `image` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        image: Option<String>,
        /// The `lastAuth` wire field.
        #[serde(rename = "lastAuth")]
        last_auth: String,
        /// The `name` wire field.
        name: String,
        /// The `participantKind` wire field.
        #[serde(rename = "participantKind")]
        participant_kind: AuthEventsValidateResponseCallerUserParticipantKind,
        /// The `userId` wire field.
        #[serde(rename = "userId")]
        user_id: String,
    },
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `active` wire field.
        active: bool,
        /// The `capabilities` wire field.
        capabilities: Vec<String>,
        /// The `id` wire field.
        id: String,
        /// The `name` wire field.
        name: String,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `active` wire field.
        active: bool,
        /// The `capabilities` wire field.
        capabilities: Vec<String>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `deviceId` wire field.
        #[serde(rename = "deviceId")]
        device_id: String,
        /// The `deviceType` wire field.
        #[serde(rename = "deviceType")]
        device_type: String,
        /// The `runtimePublicKey` wire field.
        #[serde(rename = "runtimePublicKey")]
        runtime_public_key: String,
    },
}
/// Generated schema type `AuthEventsValidateResponsePublisherKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthEventsValidateResponsePublisherKind {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `user` wire value.
    #[serde(rename = "user")]
    User,
}
impl AuthEventsValidateResponsePublisherKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Device => "device",
            Self::User => "user",
        }
    }
}
impl AsRef<str> for AuthEventsValidateResponsePublisherKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthEventsValidateResponsePublisherKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthEventsValidateResponsePublisherKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthEventsValidateResponsePublisherKind> for &str {
    fn eq(&self, other: &AuthEventsValidateResponsePublisherKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthEventsValidateResponsePublisherSessionStatus`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthEventsValidateResponsePublisherSessionStatus {
    /// The `active` wire value.
    #[serde(rename = "active")]
    Active,
    /// The `ended` wire value.
    #[serde(rename = "ended")]
    Ended,
    /// The `revoked` wire value.
    #[serde(rename = "revoked")]
    Revoked,
    /// The `expired` wire value.
    #[serde(rename = "expired")]
    Expired,
}
impl AuthEventsValidateResponsePublisherSessionStatus {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Ended => "ended",
            Self::Revoked => "revoked",
            Self::Expired => "expired",
        }
    }
}
impl AsRef<str> for AuthEventsValidateResponsePublisherSessionStatus {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthEventsValidateResponsePublisherSessionStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthEventsValidateResponsePublisherSessionStatus {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthEventsValidateResponsePublisherSessionStatus> for &str {
    fn eq(&self, other: &AuthEventsValidateResponsePublisherSessionStatus) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthEventsValidateResponsePublisher`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEventsValidateResponsePublisher {
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_digest: Option<String>,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    /// The `kind` wire field.
    pub kind: AuthEventsValidateResponsePublisherKind,
    /// The `sessionStatus` wire field.
    #[serde(rename = "sessionStatus")]
    pub session_status: AuthEventsValidateResponsePublisherSessionStatus,
}
/// Generated schema type `AuthEventsValidateResponseStatus`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthEventsValidateResponseStatus {
    /// The `verified` wire value.
    #[serde(rename = "verified")]
    Verified,
    /// The `missing-session` wire value.
    #[serde(rename = "missing-session")]
    MissingSession,
    /// The `invalid-signature` wire value.
    #[serde(rename = "invalid-signature")]
    InvalidSignature,
    /// The `subject-denied` wire value.
    #[serde(rename = "subject-denied")]
    SubjectDenied,
    /// The `outside-session-window` wire value.
    #[serde(rename = "outside-session-window")]
    OutsideSessionWindow,
}
impl AuthEventsValidateResponseStatus {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Verified => "verified",
            Self::MissingSession => "missing-session",
            Self::InvalidSignature => "invalid-signature",
            Self::SubjectDenied => "subject-denied",
            Self::OutsideSessionWindow => "outside-session-window",
        }
    }
}
impl AsRef<str> for AuthEventsValidateResponseStatus {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthEventsValidateResponseStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthEventsValidateResponseStatus {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthEventsValidateResponseStatus> for &str {
    fn eq(&self, other: &AuthEventsValidateResponseStatus) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthEventsValidateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthEventsValidateResponse {
    /// The `allowed` wire field.
    pub allowed: bool,
    /// The `caller` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caller: Option<AuthEventsValidateResponseCaller>,
    /// The `publisher` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<AuthEventsValidateResponsePublisher>,
    /// The `status` wire field.
    pub status: AuthEventsValidateResponseStatus,
}
/// Generated schema type `AuthIdentitiesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `user` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthIdentitiesListResponseEntriesItemAnswer`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthIdentitiesListResponseEntriesItemAnswer {
    /// The `approved` wire value.
    #[serde(rename = "approved")]
    Approved,
    /// The `denied` wire value.
    #[serde(rename = "denied")]
    Denied,
}
impl AuthIdentitiesListResponseEntriesItemAnswer {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Approved => "approved",
            Self::Denied => "denied",
        }
    }
}
impl AsRef<str> for AuthIdentitiesListResponseEntriesItemAnswer {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthIdentitiesListResponseEntriesItemAnswer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthIdentitiesListResponseEntriesItemAnswer {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthIdentitiesListResponseEntriesItemAnswer> for &str {
    fn eq(&self, other: &AuthIdentitiesListResponseEntriesItemAnswer) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthIdentitiesListResponseEntriesItemCapabilitiesValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListResponseEntriesItemCapabilitiesValue {
    /// The `consequence` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consequence: Option<String>,
    /// The `description` wire field.
    pub description: String,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
}
/// Generated schema type `AuthIdentitiesListResponseEntriesItemContractEvidence`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListResponseEntriesItemContractEvidence {
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
}
/// Generated schema type `AuthIdentitiesListResponseEntriesItemIdentityAnchor`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthIdentitiesListResponseEntriesItemIdentityAnchor {
    /// The `web` variant.
    #[serde(rename = "web")]
    Web {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `origin` wire field.
        origin: String,
    },
    /// The `cli` variant.
    #[serde(rename = "cli")]
    Cli {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `native` variant.
    #[serde(rename = "native")]
    Native {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `device-user` variant.
    #[serde(rename = "device-user")]
    DeviceUser {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `devicePublicKey` wire field.
        #[serde(rename = "devicePublicKey")]
        device_public_key: String,
    },
}
/// Generated schema type `AuthIdentitiesListResponseEntriesItemParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthIdentitiesListResponseEntriesItemParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthIdentitiesListResponseEntriesItemParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthIdentitiesListResponseEntriesItemParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthIdentitiesListResponseEntriesItemParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthIdentitiesListResponseEntriesItemParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthIdentitiesListResponseEntriesItemParticipantKind> for &str {
    fn eq(&self, other: &AuthIdentitiesListResponseEntriesItemParticipantKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthIdentitiesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListResponseEntriesItem {
    /// The `answer` wire field.
    pub answer: AuthIdentitiesListResponseEntriesItemAnswer,
    /// The `answeredAt` wire field.
    #[serde(rename = "answeredAt")]
    pub answered_at: String,
    /// The `capabilities` wire field.
    pub capabilities: BTreeMap<String, AuthIdentitiesListResponseEntriesItemCapabilitiesValue>,
    /// The `contractEvidence` wire field.
    #[serde(rename = "contractEvidence")]
    pub contract_evidence: AuthIdentitiesListResponseEntriesItemContractEvidence,
    /// The `description` wire field.
    pub description: String,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `identityAnchor` wire field.
    #[serde(rename = "identityAnchor")]
    pub identity_anchor: AuthIdentitiesListResponseEntriesItemIdentityAnchor,
    /// The `identityGrantId` wire field.
    #[serde(rename = "identityGrantId")]
    pub identity_grant_id: String,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind: AuthIdentitiesListResponseEntriesItemParticipantKind,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// The `user` wire field.
    pub user: String,
}
/// Generated schema type `AuthIdentitiesListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentitiesListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthIdentitiesListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthIdentityGrantsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentityGrantsListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `user` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthIdentityGrantsListResponseEntriesItemContractEvidence`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentityGrantsListResponseEntriesItemContractEvidence {
    /// The `contractDigest` wire field.
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: String,
}
/// Generated schema type `AuthIdentityGrantsListResponseEntriesItemIdentityAnchor`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum AuthIdentityGrantsListResponseEntriesItemIdentityAnchor {
    /// The `web` variant.
    #[serde(rename = "web")]
    Web {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `origin` wire field.
        origin: String,
    },
    /// The `cli` variant.
    #[serde(rename = "cli")]
    Cli {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `native` variant.
    #[serde(rename = "native")]
    Native {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `sessionPublicKey` wire field.
        #[serde(rename = "sessionPublicKey")]
        session_public_key: String,
    },
    /// The `device-user` variant.
    #[serde(rename = "device-user")]
    DeviceUser {
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `devicePublicKey` wire field.
        #[serde(rename = "devicePublicKey")]
        device_public_key: String,
    },
}
/// Generated schema type `AuthIdentityGrantsListResponseEntriesItemParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthIdentityGrantsListResponseEntriesItemParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthIdentityGrantsListResponseEntriesItemParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthIdentityGrantsListResponseEntriesItemParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthIdentityGrantsListResponseEntriesItemParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthIdentityGrantsListResponseEntriesItemParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthIdentityGrantsListResponseEntriesItemParticipantKind> for &str {
    fn eq(&self, other: &AuthIdentityGrantsListResponseEntriesItemParticipantKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthIdentityGrantsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentityGrantsListResponseEntriesItem {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `contractEvidence` wire field.
    #[serde(rename = "contractEvidence")]
    pub contract_evidence: AuthIdentityGrantsListResponseEntriesItemContractEvidence,
    /// The `description` wire field.
    pub description: String,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `grantedAt` wire field.
    #[serde(rename = "grantedAt")]
    pub granted_at: String,
    /// The `identityAnchor` wire field.
    #[serde(rename = "identityAnchor")]
    pub identity_anchor: AuthIdentityGrantsListResponseEntriesItemIdentityAnchor,
    /// The `identityGrantId` wire field.
    #[serde(rename = "identityGrantId")]
    pub identity_grant_id: String,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind: AuthIdentityGrantsListResponseEntriesItemParticipantKind,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthIdentityGrantsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentityGrantsListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthIdentityGrantsListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthIdentityGrantsRevokeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentityGrantsRevokeRequest {
    /// The `identityGrantId` wire field.
    #[serde(rename = "identityGrantId")]
    pub identity_grant_id: String,
    /// The `user` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthIdentityGrantsRevokeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthIdentityGrantsRevokeResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthPortalsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetRequest {
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsGetResponseFederatedProvidersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponseFederatedProvidersItem {
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `id` wire field.
    pub id: String,
    /// The `type` wire field.
    pub r#type: String,
}
/// Generated schema type `AuthPortalsGetResponsePortal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponsePortal {
    /// The `builtIn` wire field.
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `entryUrl` wire field.
    #[serde(rename = "entryUrl")]
    pub entry_url: Option<String>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsGetResponseRoutesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponseRoutesItem {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: Option<String>,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `origin` wire field.
    pub origin: Option<String>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `routeKey` wire field.
    #[serde(rename = "routeKey")]
    pub route_key: String,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsGetResponseSettings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponseSettings {
    /// The `allowedFederatedProviders` wire field.
    #[serde(rename = "allowedFederatedProviders")]
    pub allowed_federated_providers: Option<Vec<String>>,
    /// The `federatedRegistrationEnabled` wire field.
    #[serde(rename = "federatedRegistrationEnabled")]
    pub federated_registration_enabled: bool,
    /// The `localRegistrationEnabled` wire field.
    #[serde(rename = "localRegistrationEnabled")]
    pub local_registration_enabled: bool,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `selfRegisteredAccountActive` wire field.
    #[serde(rename = "selfRegisteredAccountActive")]
    pub self_registered_account_active: bool,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsGetResponse {
    /// The `defaultCapabilities` wire field.
    #[serde(rename = "defaultCapabilities")]
    pub default_capabilities: Vec<String>,
    /// The `defaultCapabilityGroups` wire field.
    #[serde(rename = "defaultCapabilityGroups")]
    pub default_capability_groups: Vec<String>,
    /// The `federatedProviders` wire field.
    #[serde(rename = "federatedProviders")]
    pub federated_providers: Vec<AuthPortalsGetResponseFederatedProvidersItem>,
    /// The `portal` wire field.
    pub portal: AuthPortalsGetResponsePortal,
    /// The `routes` wire field.
    pub routes: Vec<AuthPortalsGetResponseRoutesItem>,
    /// The `settings` wire field.
    pub settings: AuthPortalsGetResponseSettings,
}
/// Generated schema type `AuthPortalsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthPortalsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsListResponseEntriesItem {
    /// The `activeRouteCount` wire field.
    #[serde(rename = "activeRouteCount")]
    pub active_route_count: i64,
    /// The `builtIn` wire field.
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `entryUrl` wire field.
    #[serde(rename = "entryUrl")]
    pub entry_url: Option<String>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `routeCount` wire field.
    #[serde(rename = "routeCount")]
    pub route_count: i64,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthPortalsListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthPortalsLoginSettingsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetRequest {
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsLoginSettingsGetResponseFederatedProvidersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetResponseFederatedProvidersItem {
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `id` wire field.
    pub id: String,
    /// The `type` wire field.
    pub r#type: String,
}
/// Generated schema type `AuthPortalsLoginSettingsGetResponsePortal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetResponsePortal {
    /// The `builtIn` wire field.
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `entryUrl` wire field.
    #[serde(rename = "entryUrl")]
    pub entry_url: Option<String>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsLoginSettingsGetResponseSettings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetResponseSettings {
    /// The `allowedFederatedProviders` wire field.
    #[serde(rename = "allowedFederatedProviders")]
    pub allowed_federated_providers: Option<Vec<String>>,
    /// The `federatedRegistrationEnabled` wire field.
    #[serde(rename = "federatedRegistrationEnabled")]
    pub federated_registration_enabled: bool,
    /// The `localRegistrationEnabled` wire field.
    #[serde(rename = "localRegistrationEnabled")]
    pub local_registration_enabled: bool,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `selfRegisteredAccountActive` wire field.
    #[serde(rename = "selfRegisteredAccountActive")]
    pub self_registered_account_active: bool,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsLoginSettingsGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsGetResponse {
    /// The `defaultCapabilities` wire field.
    #[serde(rename = "defaultCapabilities")]
    pub default_capabilities: Vec<String>,
    /// The `defaultCapabilityGroups` wire field.
    #[serde(rename = "defaultCapabilityGroups")]
    pub default_capability_groups: Vec<String>,
    /// The `federatedProviders` wire field.
    #[serde(rename = "federatedProviders")]
    pub federated_providers: Vec<AuthPortalsLoginSettingsGetResponseFederatedProvidersItem>,
    /// The `portal` wire field.
    pub portal: AuthPortalsLoginSettingsGetResponsePortal,
    /// The `settings` wire field.
    pub settings: AuthPortalsLoginSettingsGetResponseSettings,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateRequest {
    /// The `allowedFederatedProviders` wire field.
    #[serde(rename = "allowedFederatedProviders")]
    pub allowed_federated_providers: Option<Vec<String>>,
    /// The `defaultCapabilities` wire field.
    #[serde(rename = "defaultCapabilities")]
    pub default_capabilities: Vec<String>,
    /// The `defaultCapabilityGroups` wire field.
    #[serde(rename = "defaultCapabilityGroups")]
    pub default_capability_groups: Vec<String>,
    /// The `federatedRegistrationEnabled` wire field.
    #[serde(rename = "federatedRegistrationEnabled")]
    pub federated_registration_enabled: bool,
    /// The `localRegistrationEnabled` wire field.
    #[serde(rename = "localRegistrationEnabled")]
    pub local_registration_enabled: bool,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `selfRegisteredAccountActive` wire field.
    #[serde(rename = "selfRegisteredAccountActive")]
    pub self_registered_account_active: bool,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateResponseFederatedProvidersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateResponseFederatedProvidersItem {
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `id` wire field.
    pub id: String,
    /// The `type` wire field.
    pub r#type: String,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateResponsePortal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateResponsePortal {
    /// The `builtIn` wire field.
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `entryUrl` wire field.
    #[serde(rename = "entryUrl")]
    pub entry_url: Option<String>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateResponseSettings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateResponseSettings {
    /// The `allowedFederatedProviders` wire field.
    #[serde(rename = "allowedFederatedProviders")]
    pub allowed_federated_providers: Option<Vec<String>>,
    /// The `federatedRegistrationEnabled` wire field.
    #[serde(rename = "federatedRegistrationEnabled")]
    pub federated_registration_enabled: bool,
    /// The `localRegistrationEnabled` wire field.
    #[serde(rename = "localRegistrationEnabled")]
    pub local_registration_enabled: bool,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `selfRegisteredAccountActive` wire field.
    #[serde(rename = "selfRegisteredAccountActive")]
    pub self_registered_account_active: bool,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsLoginSettingsUpdateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsLoginSettingsUpdateResponse {
    /// The `defaultCapabilities` wire field.
    #[serde(rename = "defaultCapabilities")]
    pub default_capabilities: Vec<String>,
    /// The `defaultCapabilityGroups` wire field.
    #[serde(rename = "defaultCapabilityGroups")]
    pub default_capability_groups: Vec<String>,
    /// The `federatedProviders` wire field.
    #[serde(rename = "federatedProviders")]
    pub federated_providers: Vec<AuthPortalsLoginSettingsUpdateResponseFederatedProvidersItem>,
    /// The `portal` wire field.
    pub portal: AuthPortalsLoginSettingsUpdateResponsePortal,
    /// The `settings` wire field.
    pub settings: AuthPortalsLoginSettingsUpdateResponseSettings,
}
/// Generated schema type `AuthPortalsPutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsPutRequest {
    /// The `disabled` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `entryUrl` wire field.
    #[serde(rename = "entryUrl")]
    pub entry_url: String,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsPutResponsePortal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsPutResponsePortal {
    /// The `builtIn` wire field.
    #[serde(rename = "builtIn")]
    pub built_in: bool,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The `entryUrl` wire field.
    #[serde(rename = "entryUrl")]
    pub entry_url: Option<String>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsPutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsPutResponse {
    /// The `portal` wire field.
    pub portal: AuthPortalsPutResponsePortal,
}
/// Generated schema type `AuthPortalsRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRemoveRequest {
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRemoveResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthPortalsRoutesPutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesPutRequest {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    #[serde(
        default,
        deserialize_with = "deserialize_optional_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub contract_id: Option<Option<String>>,
    /// The `disabled` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// The `origin` wire field.
    #[serde(
        default,
        deserialize_with = "deserialize_optional_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub origin: Option<Option<String>>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsRoutesPutResponseRoute`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesPutResponseRoute {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    pub contract_id: Option<String>,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `origin` wire field.
    pub origin: Option<String>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
    /// The `routeKey` wire field.
    #[serde(rename = "routeKey")]
    pub route_key: String,
    /// The `updatedAt` wire field.
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
/// Generated schema type `AuthPortalsRoutesPutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesPutResponse {
    /// The `route` wire field.
    pub route: AuthPortalsRoutesPutResponseRoute,
}
/// Generated schema type `AuthPortalsRoutesRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesRemoveRequest {
    /// The `contractId` wire field.
    #[serde(rename = "contractId")]
    #[serde(
        default,
        deserialize_with = "deserialize_optional_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub contract_id: Option<Option<String>>,
    /// The `origin` wire field.
    #[serde(
        default,
        deserialize_with = "deserialize_optional_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub origin: Option<Option<String>>,
    /// The `portalId` wire field.
    #[serde(rename = "portalId")]
    pub portal_id: String,
}
/// Generated schema type `AuthPortalsRoutesRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthPortalsRoutesRemoveResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthRequestsValidateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRequestsValidateRequest {
    /// The `capabilities` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    /// The `iat` wire field.
    pub iat: i64,
    /// The `payloadHash` wire field.
    #[serde(rename = "payloadHash")]
    pub payload_hash: String,
    /// The `proof` wire field.
    pub proof: String,
    /// The `requestId` wire field.
    #[serde(rename = "requestId")]
    pub request_id: String,
    /// The `sessionKey` wire field.
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthRequestsValidateResponseCallerUserIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRequestsValidateResponseCallerUserIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthRequestsValidateResponseCallerUserParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthRequestsValidateResponseCallerUserParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthRequestsValidateResponseCallerUserParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthRequestsValidateResponseCallerUserParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthRequestsValidateResponseCallerUserParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthRequestsValidateResponseCallerUserParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthRequestsValidateResponseCallerUserParticipantKind> for &str {
    fn eq(&self, other: &AuthRequestsValidateResponseCallerUserParticipantKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthRequestsValidateResponseCaller`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum AuthRequestsValidateResponseCaller {
    /// The `user` variant.
    #[serde(rename = "user")]
    User {
        /// The `active` wire field.
        active: bool,
        /// The `capabilities` wire field.
        capabilities: Vec<String>,
        /// The `email` wire field.
        email: String,
        /// The `emailVerified` wire field.
        #[serde(rename = "emailVerified")]
        email_verified: bool,
        /// The `identity` wire field.
        identity: AuthRequestsValidateResponseCallerUserIdentity,
        /// The `image` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        image: Option<String>,
        /// The `lastAuth` wire field.
        #[serde(rename = "lastAuth")]
        last_auth: String,
        /// The `name` wire field.
        name: String,
        /// The `participantKind` wire field.
        #[serde(rename = "participantKind")]
        participant_kind: AuthRequestsValidateResponseCallerUserParticipantKind,
        /// The `userId` wire field.
        #[serde(rename = "userId")]
        user_id: String,
    },
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `active` wire field.
        active: bool,
        /// The `capabilities` wire field.
        capabilities: Vec<String>,
        /// The `id` wire field.
        id: String,
        /// The `name` wire field.
        name: String,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `active` wire field.
        active: bool,
        /// The `capabilities` wire field.
        capabilities: Vec<String>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `deviceId` wire field.
        #[serde(rename = "deviceId")]
        device_id: String,
        /// The `deviceType` wire field.
        #[serde(rename = "deviceType")]
        device_type: String,
        /// The `runtimePublicKey` wire field.
        #[serde(rename = "runtimePublicKey")]
        runtime_public_key: String,
    },
}
/// Generated schema type `AuthRequestsValidateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRequestsValidateResponse {
    /// The `allowed` wire field.
    pub allowed: bool,
    /// The `caller` wire field.
    pub caller: AuthRequestsValidateResponseCaller,
    /// The `inboxPrefix` wire field.
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
}
/// Generated schema type `AuthServiceInstancesDisableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableRequest {
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `parallel` wire value.
    #[serde(rename = "parallel")]
    Parallel,
}
impl AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::Parallel => "parallel",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering,
    > for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay {
    /// The `new` wire value.
    #[serde(rename = "new")]
    New,
    /// The `all` wire value.
    #[serde(rename = "all")]
    All,
}
impl AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::All => "all",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay>
    for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValue {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `filterSubjects` wire field.
    #[serde(rename = "filterSubjects")]
    pub filter_subjects: Vec<String>,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `ordering` wire field.
    pub ordering:
        AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueOrdering,
    /// The `replay` wire field.
    pub replay:
        AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValueReplay,
    /// The `stream` wire field.
    pub stream: String,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy
{
    /// The `fail-stale` wire value.
    #[serde(rename = "fail-stale")]
    FailStale,
    /// The `block` wire value.
    #[serde(rename = "block")]
    Block,
}
impl AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::FailStale => "fail-stale",
            Self::Block => "block",
        }
    }
}
impl AsRef<str>
for AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
> for &str {
    fn eq(
        &self,
        other: &AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency {
    /// The `heartbeatIntervalMs` wire field.
    #[serde(rename = "heartbeatIntervalMs")]
    pub heartbeat_interval_ms: i64,
    /// The `heartbeatTtlMs` wire field.
    #[serde(rename = "heartbeatTtlMs")]
    pub heartbeat_ttl_ms: i64,
    /// The `key` wire field.
    pub key: Vec<String>,
    /// The `maxActive` wire field.
    #[serde(rename = "maxActive")]
    pub max_active: i64,
    /// The `stalePolicy` wire field.
    #[serde(rename = "stalePolicy")]
    pub stale_policy: AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValuePayload {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull {
    /// The `reject` wire value.
    #[serde(rename = "reject")]
    Reject,
    /// The `coalesce` wire value.
    #[serde(rename = "coalesce")]
    Coalesce,
    /// The `replace-oldest` wire value.
    #[serde(rename = "replace-oldest")]
    ReplaceOldest,
}
impl AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Reject => "reject",
            Self::Coalesce => "coalesce",
            Self::ReplaceOldest => "replace-oldest",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
    > for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueue {
    /// The `maxQueuedPerKey` wire field.
    #[serde(rename = "maxQueuedPerKey")]
    pub max_queued_per_key: i64,
    /// The `whenFull` wire field.
    #[serde(rename = "whenFull")]
    pub when_full:
        AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueResult {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueUpdate`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueUpdate {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValue {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `defaultDeadlineMs` wire field.
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    /// The `dlq` wire field.
    pub dlq: bool,
    /// The `keyConcurrency` wire field.
    #[serde(rename = "keyConcurrency")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_concurrency: Option<
        AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency,
    >,
    /// The `logs` wire field.
    pub logs: bool,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `payload` wire field.
    pub payload: AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValuePayload,
    /// The `progress` wire field.
    pub progress: bool,
    /// The `publishPrefix` wire field.
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    /// The `queue` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue:
        Option<AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueQueue>,
    /// The `queueType` wire field.
    #[serde(rename = "queueType")]
    pub queue_type: String,
    /// The `result` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:
        Option<AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueResult>,
    /// The `update` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update:
        Option<AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValueUpdate>,
    /// The `updatesPrefix` wire field.
    #[serde(rename = "updatesPrefix")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updates_prefix: Option<String>,
    /// The `workSubject` wire field.
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsJobs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsJobs {
    /// The `namespace` wire field.
    pub namespace: String,
    /// The `queues` wire field.
    pub queues: BTreeMap<
        String,
        AuthServiceInstancesDisableResponseInstanceResourceBindingsJobsQueuesValue,
    >,
    /// The `serviceName` wire field.
    #[serde(rename = "serviceName")]
    pub service_name: String,
    /// The `workStream` wire field.
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsKvValue {
    /// The `bucket` wire field.
    pub bucket: String,
    /// The `history` wire field.
    pub history: i64,
    /// The `maxValueBytes` wire field.
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    /// The `ttlMs` wire field.
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindingsStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindingsStoreValue {
    /// The `maxObjectBytes` wire field.
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    /// The `maxTotalBytes` wire field.
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    /// The `name` wire field.
    pub name: String,
    /// The `ttlMs` wire field.
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstanceResourceBindings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstanceResourceBindings {
    /// The `eventConsumers` wire field.
    #[serde(rename = "eventConsumers")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_consumers: Option<
        BTreeMap<
            String,
            AuthServiceInstancesDisableResponseInstanceResourceBindingsEventConsumersValue,
        >,
    >,
    /// The `jobs` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthServiceInstancesDisableResponseInstanceResourceBindingsJobs>,
    /// The `kv` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<
        BTreeMap<String, AuthServiceInstancesDisableResponseInstanceResourceBindingsKvValue>,
    >,
    /// The `store` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<
        BTreeMap<String, AuthServiceInstancesDisableResponseInstanceResourceBindingsStoreValue>,
    >,
}
/// Generated schema type `AuthServiceInstancesDisableResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponseInstance {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `instanceKey` wire field.
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
    /// The `resourceBindings` wire field.
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthServiceInstancesDisableResponseInstanceResourceBindings>,
}
/// Generated schema type `AuthServiceInstancesDisableResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesDisableResponse {
    /// The `instance` wire field.
    pub instance: AuthServiceInstancesDisableResponseInstance,
}
/// Generated schema type `AuthServiceInstancesEnableRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableRequest {
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `parallel` wire value.
    #[serde(rename = "parallel")]
    Parallel,
}
impl AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::Parallel => "parallel",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering>
    for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay {
    /// The `new` wire value.
    #[serde(rename = "new")]
    New,
    /// The `all` wire value.
    #[serde(rename = "all")]
    All,
}
impl AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::All => "all",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay>
    for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValue {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `filterSubjects` wire field.
    #[serde(rename = "filterSubjects")]
    pub filter_subjects: Vec<String>,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `ordering` wire field.
    pub ordering:
        AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueOrdering,
    /// The `replay` wire field.
    pub replay: AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValueReplay,
    /// The `stream` wire field.
    pub stream: String,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy
{
    /// The `fail-stale` wire value.
    #[serde(rename = "fail-stale")]
    FailStale,
    /// The `block` wire value.
    #[serde(rename = "block")]
    Block,
}
impl AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::FailStale => "fail-stale",
            Self::Block => "block",
        }
    }
}
impl AsRef<str>
for AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
> for &str {
    fn eq(
        &self,
        other: &AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency {
    /// The `heartbeatIntervalMs` wire field.
    #[serde(rename = "heartbeatIntervalMs")]
    pub heartbeat_interval_ms: i64,
    /// The `heartbeatTtlMs` wire field.
    #[serde(rename = "heartbeatTtlMs")]
    pub heartbeat_ttl_ms: i64,
    /// The `key` wire field.
    pub key: Vec<String>,
    /// The `maxActive` wire field.
    #[serde(rename = "maxActive")]
    pub max_active: i64,
    /// The `stalePolicy` wire field.
    #[serde(rename = "stalePolicy")]
    pub stale_policy: AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValuePayload {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull {
    /// The `reject` wire value.
    #[serde(rename = "reject")]
    Reject,
    /// The `coalesce` wire value.
    #[serde(rename = "coalesce")]
    Coalesce,
    /// The `replace-oldest` wire value.
    #[serde(rename = "replace-oldest")]
    ReplaceOldest,
}
impl AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Reject => "reject",
            Self::Coalesce => "coalesce",
            Self::ReplaceOldest => "replace-oldest",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
    > for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueue {
    /// The `maxQueuedPerKey` wire field.
    #[serde(rename = "maxQueuedPerKey")]
    pub max_queued_per_key: i64,
    /// The `whenFull` wire field.
    #[serde(rename = "whenFull")]
    pub when_full:
        AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueResult {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueUpdate`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueUpdate {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValue {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `defaultDeadlineMs` wire field.
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    /// The `dlq` wire field.
    pub dlq: bool,
    /// The `keyConcurrency` wire field.
    #[serde(rename = "keyConcurrency")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_concurrency: Option<
        AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency,
    >,
    /// The `logs` wire field.
    pub logs: bool,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `payload` wire field.
    pub payload: AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValuePayload,
    /// The `progress` wire field.
    pub progress: bool,
    /// The `publishPrefix` wire field.
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    /// The `queue` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue:
        Option<AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueQueue>,
    /// The `queueType` wire field.
    #[serde(rename = "queueType")]
    pub queue_type: String,
    /// The `result` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:
        Option<AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueResult>,
    /// The `update` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update:
        Option<AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValueUpdate>,
    /// The `updatesPrefix` wire field.
    #[serde(rename = "updatesPrefix")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updates_prefix: Option<String>,
    /// The `workSubject` wire field.
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsJobs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsJobs {
    /// The `namespace` wire field.
    pub namespace: String,
    /// The `queues` wire field.
    pub queues:
        BTreeMap<String, AuthServiceInstancesEnableResponseInstanceResourceBindingsJobsQueuesValue>,
    /// The `serviceName` wire field.
    #[serde(rename = "serviceName")]
    pub service_name: String,
    /// The `workStream` wire field.
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsKvValue {
    /// The `bucket` wire field.
    pub bucket: String,
    /// The `history` wire field.
    pub history: i64,
    /// The `maxValueBytes` wire field.
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    /// The `ttlMs` wire field.
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindingsStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindingsStoreValue {
    /// The `maxObjectBytes` wire field.
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    /// The `maxTotalBytes` wire field.
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    /// The `name` wire field.
    pub name: String,
    /// The `ttlMs` wire field.
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstanceResourceBindings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstanceResourceBindings {
    /// The `eventConsumers` wire field.
    #[serde(rename = "eventConsumers")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_consumers: Option<
        BTreeMap<
            String,
            AuthServiceInstancesEnableResponseInstanceResourceBindingsEventConsumersValue,
        >,
    >,
    /// The `jobs` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthServiceInstancesEnableResponseInstanceResourceBindingsJobs>,
    /// The `kv` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv:
        Option<BTreeMap<String, AuthServiceInstancesEnableResponseInstanceResourceBindingsKvValue>>,
    /// The `store` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<
        BTreeMap<String, AuthServiceInstancesEnableResponseInstanceResourceBindingsStoreValue>,
    >,
}
/// Generated schema type `AuthServiceInstancesEnableResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponseInstance {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `instanceKey` wire field.
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
    /// The `resourceBindings` wire field.
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthServiceInstancesEnableResponseInstanceResourceBindings>,
}
/// Generated schema type `AuthServiceInstancesEnableResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesEnableResponse {
    /// The `instance` wire field.
    pub instance: AuthServiceInstancesEnableResponseInstance,
}
/// Generated schema type `AuthServiceInstancesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    /// The `disabled` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `parallel` wire value.
    #[serde(rename = "parallel")]
    Parallel,
}
impl AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::Parallel => "parallel",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering,
    > for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay {
    /// The `new` wire value.
    #[serde(rename = "new")]
    New,
    /// The `all` wire value.
    #[serde(rename = "all")]
    All,
}
impl AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::All => "all",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay>
    for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValue {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `filterSubjects` wire field.
    #[serde(rename = "filterSubjects")]
    pub filter_subjects: Vec<String>,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `ordering` wire field.
    pub ordering:
        AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueOrdering,
    /// The `replay` wire field.
    pub replay:
        AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValueReplay,
    /// The `stream` wire field.
    pub stream: String,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy
{
    /// The `fail-stale` wire value.
    #[serde(rename = "fail-stale")]
    FailStale,
    /// The `block` wire value.
    #[serde(rename = "block")]
    Block,
}
impl AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::FailStale => "fail-stale",
            Self::Block => "block",
        }
    }
}
impl AsRef<str>
for AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
> for &str {
    fn eq(
        &self,
        other: &AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrency`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrency {
    /// The `heartbeatIntervalMs` wire field.
    #[serde(rename = "heartbeatIntervalMs")]
    pub heartbeat_interval_ms: i64,
    /// The `heartbeatTtlMs` wire field.
    #[serde(rename = "heartbeatTtlMs")]
    pub heartbeat_ttl_ms: i64,
    /// The `key` wire field.
    pub key: Vec<String>,
    /// The `maxActive` wire field.
    #[serde(rename = "maxActive")]
    pub max_active: i64,
    /// The `stalePolicy` wire field.
    #[serde(rename = "stalePolicy")]
    pub stale_policy: AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValuePayload {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull {
    /// The `reject` wire value.
    #[serde(rename = "reject")]
    Reject,
    /// The `coalesce` wire value.
    #[serde(rename = "coalesce")]
    Coalesce,
    /// The `replace-oldest` wire value.
    #[serde(rename = "replace-oldest")]
    ReplaceOldest,
}
impl AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Reject => "reject",
            Self::Coalesce => "coalesce",
            Self::ReplaceOldest => "replace-oldest",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull,
    > for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueue {
    /// The `maxQueuedPerKey` wire field.
    #[serde(rename = "maxQueuedPerKey")]
    pub max_queued_per_key: i64,
    /// The `whenFull` wire field.
    #[serde(rename = "whenFull")]
    pub when_full:
        AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueueWhenFull,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueResult {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueUpdate`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueUpdate {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValue {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `defaultDeadlineMs` wire field.
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    /// The `dlq` wire field.
    pub dlq: bool,
    /// The `keyConcurrency` wire field.
    #[serde(rename = "keyConcurrency")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_concurrency: Option<
        AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueKeyConcurrency,
    >,
    /// The `logs` wire field.
    pub logs: bool,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `payload` wire field.
    pub payload: AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValuePayload,
    /// The `progress` wire field.
    pub progress: bool,
    /// The `publishPrefix` wire field.
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    /// The `queue` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue:
        Option<AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueQueue>,
    /// The `queueType` wire field.
    #[serde(rename = "queueType")]
    pub queue_type: String,
    /// The `result` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:
        Option<AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueResult>,
    /// The `update` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update:
        Option<AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValueUpdate>,
    /// The `updatesPrefix` wire field.
    #[serde(rename = "updatesPrefix")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updates_prefix: Option<String>,
    /// The `workSubject` wire field.
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsJobs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsJobs {
    /// The `namespace` wire field.
    pub namespace: String,
    /// The `queues` wire field.
    pub queues: BTreeMap<
        String,
        AuthServiceInstancesListResponseEntriesItemResourceBindingsJobsQueuesValue,
    >,
    /// The `serviceName` wire field.
    #[serde(rename = "serviceName")]
    pub service_name: String,
    /// The `workStream` wire field.
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsKvValue {
    /// The `bucket` wire field.
    pub bucket: String,
    /// The `history` wire field.
    pub history: i64,
    /// The `maxValueBytes` wire field.
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    /// The `ttlMs` wire field.
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindingsStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindingsStoreValue {
    /// The `maxObjectBytes` wire field.
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    /// The `maxTotalBytes` wire field.
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    /// The `name` wire field.
    pub name: String,
    /// The `ttlMs` wire field.
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItemResourceBindings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItemResourceBindings {
    /// The `eventConsumers` wire field.
    #[serde(rename = "eventConsumers")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_consumers: Option<
        BTreeMap<
            String,
            AuthServiceInstancesListResponseEntriesItemResourceBindingsEventConsumersValue,
        >,
    >,
    /// The `jobs` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthServiceInstancesListResponseEntriesItemResourceBindingsJobs>,
    /// The `kv` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<
        BTreeMap<String, AuthServiceInstancesListResponseEntriesItemResourceBindingsKvValue>,
    >,
    /// The `store` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<
        BTreeMap<String, AuthServiceInstancesListResponseEntriesItemResourceBindingsStoreValue>,
    >,
}
/// Generated schema type `AuthServiceInstancesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponseEntriesItem {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `instanceKey` wire field.
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
    /// The `resourceBindings` wire field.
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthServiceInstancesListResponseEntriesItemResourceBindings>,
}
/// Generated schema type `AuthServiceInstancesListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthServiceInstancesListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthServiceInstancesProvisionRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionRequest {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceKey` wire field.
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering {
    /// The `strict` wire value.
    #[serde(rename = "strict")]
    Strict,
    /// The `parallel` wire value.
    #[serde(rename = "parallel")]
    Parallel,
}
impl AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::Parallel => "parallel",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering,
    > for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay {
    /// The `new` wire value.
    #[serde(rename = "new")]
    New,
    /// The `all` wire value.
    #[serde(rename = "all")]
    All,
}
impl AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::All => "all",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay,
    > for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValue {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `filterSubjects` wire field.
    #[serde(rename = "filterSubjects")]
    pub filter_subjects: Vec<String>,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `ordering` wire field.
    pub ordering:
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueOrdering,
    /// The `replay` wire field.
    pub replay:
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValueReplay,
    /// The `stream` wire field.
    pub stream: String,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy
{
    /// The `fail-stale` wire value.
    #[serde(rename = "fail-stale")]
    FailStale,
    /// The `block` wire value.
    #[serde(rename = "block")]
    Block,
}
impl AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::FailStale => "fail-stale",
            Self::Block => "block",
        }
    }
}
impl AsRef<str>
for AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
for AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
for AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<
    AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
> for &str {
    fn eq(
        &self,
        other: &AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency {
    /// The `heartbeatIntervalMs` wire field.
    #[serde(rename = "heartbeatIntervalMs")]
    pub heartbeat_interval_ms: i64,
    /// The `heartbeatTtlMs` wire field.
    #[serde(rename = "heartbeatTtlMs")]
    pub heartbeat_ttl_ms: i64,
    /// The `key` wire field.
    pub key: Vec<String>,
    /// The `maxActive` wire field.
    #[serde(rename = "maxActive")]
    pub max_active: i64,
    /// The `stalePolicy` wire field.
    #[serde(rename = "stalePolicy")]
    pub stale_policy: AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrencyStalePolicy,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValuePayload {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull {
    /// The `reject` wire value.
    #[serde(rename = "reject")]
    Reject,
    /// The `coalesce` wire value.
    #[serde(rename = "coalesce")]
    Coalesce,
    /// The `replace-oldest` wire value.
    #[serde(rename = "replace-oldest")]
    ReplaceOldest,
}
impl AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Reject => "reject",
            Self::Coalesce => "coalesce",
            Self::ReplaceOldest => "replace-oldest",
        }
    }
}
impl AsRef<str>
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str>
    for AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull
{
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl
    PartialEq<
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
    > for &str
{
    fn eq(
        &self,
        other: &AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueue {
    /// The `maxQueuedPerKey` wire field.
    #[serde(rename = "maxQueuedPerKey")]
    pub max_queued_per_key: i64,
    /// The `whenFull` wire field.
    #[serde(rename = "whenFull")]
    pub when_full:
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueueWhenFull,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueResult {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueUpdate`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueUpdate {
    /// The `schema` wire field.
    pub schema: String,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValue {
    /// The `ackWaitMs` wire field.
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    /// The `backoffMs` wire field.
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    /// The `consumerName` wire field.
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    /// The `defaultDeadlineMs` wire field.
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    /// The `dlq` wire field.
    pub dlq: bool,
    /// The `keyConcurrency` wire field.
    #[serde(rename = "keyConcurrency")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_concurrency: Option<
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueKeyConcurrency,
    >,
    /// The `logs` wire field.
    pub logs: bool,
    /// The `maxDeliver` wire field.
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    /// The `payload` wire field.
    pub payload:
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValuePayload,
    /// The `progress` wire field.
    pub progress: bool,
    /// The `publishPrefix` wire field.
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    /// The `queue` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue:
        Option<AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueQueue>,
    /// The `queueType` wire field.
    #[serde(rename = "queueType")]
    pub queue_type: String,
    /// The `result` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:
        Option<AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueResult>,
    /// The `update` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update:
        Option<AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValueUpdate>,
    /// The `updatesPrefix` wire field.
    #[serde(rename = "updatesPrefix")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updates_prefix: Option<String>,
    /// The `workSubject` wire field.
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobs {
    /// The `namespace` wire field.
    pub namespace: String,
    /// The `queues` wire field.
    pub queues: BTreeMap<
        String,
        AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobsQueuesValue,
    >,
    /// The `serviceName` wire field.
    #[serde(rename = "serviceName")]
    pub service_name: String,
    /// The `workStream` wire field.
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsKvValue {
    /// The `bucket` wire field.
    pub bucket: String,
    /// The `history` wire field.
    pub history: i64,
    /// The `maxValueBytes` wire field.
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    /// The `ttlMs` wire field.
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindingsStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindingsStoreValue {
    /// The `maxObjectBytes` wire field.
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    /// The `maxTotalBytes` wire field.
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    /// The `name` wire field.
    pub name: String,
    /// The `ttlMs` wire field.
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstanceResourceBindings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstanceResourceBindings {
    /// The `eventConsumers` wire field.
    #[serde(rename = "eventConsumers")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_consumers: Option<
        BTreeMap<
            String,
            AuthServiceInstancesProvisionResponseInstanceResourceBindingsEventConsumersValue,
        >,
    >,
    /// The `jobs` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthServiceInstancesProvisionResponseInstanceResourceBindingsJobs>,
    /// The `kv` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<
        BTreeMap<String, AuthServiceInstancesProvisionResponseInstanceResourceBindingsKvValue>,
    >,
    /// The `store` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<
        BTreeMap<String, AuthServiceInstancesProvisionResponseInstanceResourceBindingsStoreValue>,
    >,
}
/// Generated schema type `AuthServiceInstancesProvisionResponseInstance`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponseInstance {
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `createdAt` wire field.
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `disabled` wire field.
    pub disabled: bool,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `instanceKey` wire field.
    #[serde(rename = "instanceKey")]
    pub instance_key: String,
    /// The `resourceBindings` wire field.
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthServiceInstancesProvisionResponseInstanceResourceBindings>,
}
/// Generated schema type `AuthServiceInstancesProvisionResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesProvisionResponse {
    /// The `instance` wire field.
    pub instance: AuthServiceInstancesProvisionResponseInstance,
}
/// Generated schema type `AuthServiceInstancesRemoveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesRemoveRequest {
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
}
/// Generated schema type `AuthServiceInstancesRemoveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthServiceInstancesRemoveResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthSessionsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `user` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}
/// Generated schema type `AuthSessionsListResponseEntriesItemAppPrincipalIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListResponseEntriesItemAppPrincipalIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthSessionsListResponseEntriesItemAppPrincipalType`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthSessionsListResponseEntriesItemAppPrincipalType {
    /// The `user` wire value.
    #[serde(rename = "user")]
    User,
}
impl AuthSessionsListResponseEntriesItemAppPrincipalType {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
        }
    }
}
impl AsRef<str> for AuthSessionsListResponseEntriesItemAppPrincipalType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthSessionsListResponseEntriesItemAppPrincipalType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthSessionsListResponseEntriesItemAppPrincipalType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthSessionsListResponseEntriesItemAppPrincipalType> for &str {
    fn eq(&self, other: &AuthSessionsListResponseEntriesItemAppPrincipalType) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthSessionsListResponseEntriesItemAppPrincipal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListResponseEntriesItemAppPrincipal {
    /// The `identity` wire field.
    pub identity: AuthSessionsListResponseEntriesItemAppPrincipalIdentity,
    /// The `name` wire field.
    pub name: String,
    /// The `type` wire field.
    pub r#type: AuthSessionsListResponseEntriesItemAppPrincipalType,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthSessionsListResponseEntriesItemAgentPrincipalIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListResponseEntriesItemAgentPrincipalIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthSessionsListResponseEntriesItemAgentPrincipalType`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthSessionsListResponseEntriesItemAgentPrincipalType {
    /// The `user` wire value.
    #[serde(rename = "user")]
    User,
}
impl AuthSessionsListResponseEntriesItemAgentPrincipalType {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
        }
    }
}
impl AsRef<str> for AuthSessionsListResponseEntriesItemAgentPrincipalType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthSessionsListResponseEntriesItemAgentPrincipalType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthSessionsListResponseEntriesItemAgentPrincipalType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthSessionsListResponseEntriesItemAgentPrincipalType> for &str {
    fn eq(&self, other: &AuthSessionsListResponseEntriesItemAgentPrincipalType) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthSessionsListResponseEntriesItemAgentPrincipal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListResponseEntriesItemAgentPrincipal {
    /// The `identity` wire field.
    pub identity: AuthSessionsListResponseEntriesItemAgentPrincipalIdentity,
    /// The `name` wire field.
    pub name: String,
    /// The `type` wire field.
    pub r#type: AuthSessionsListResponseEntriesItemAgentPrincipalType,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthSessionsListResponseEntriesItemDevicePrincipalType`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthSessionsListResponseEntriesItemDevicePrincipalType {
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
}
impl AuthSessionsListResponseEntriesItemDevicePrincipalType {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Device => "device",
        }
    }
}
impl AsRef<str> for AuthSessionsListResponseEntriesItemDevicePrincipalType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthSessionsListResponseEntriesItemDevicePrincipalType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthSessionsListResponseEntriesItemDevicePrincipalType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthSessionsListResponseEntriesItemDevicePrincipalType> for &str {
    fn eq(&self, other: &AuthSessionsListResponseEntriesItemDevicePrincipalType) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthSessionsListResponseEntriesItemDevicePrincipal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListResponseEntriesItemDevicePrincipal {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `deviceId` wire field.
    #[serde(rename = "deviceId")]
    pub device_id: String,
    /// The `deviceType` wire field.
    #[serde(rename = "deviceType")]
    pub device_type: String,
    /// The `runtimePublicKey` wire field.
    #[serde(rename = "runtimePublicKey")]
    pub runtime_public_key: String,
    /// The `type` wire field.
    pub r#type: AuthSessionsListResponseEntriesItemDevicePrincipalType,
}
/// Generated schema type `AuthSessionsListResponseEntriesItemServicePrincipalType`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthSessionsListResponseEntriesItemServicePrincipalType {
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
}
impl AuthSessionsListResponseEntriesItemServicePrincipalType {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
        }
    }
}
impl AsRef<str> for AuthSessionsListResponseEntriesItemServicePrincipalType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthSessionsListResponseEntriesItemServicePrincipalType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthSessionsListResponseEntriesItemServicePrincipalType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthSessionsListResponseEntriesItemServicePrincipalType> for &str {
    fn eq(&self, other: &AuthSessionsListResponseEntriesItemServicePrincipalType) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthSessionsListResponseEntriesItemServicePrincipal`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListResponseEntriesItemServicePrincipal {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `id` wire field.
    pub id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `name` wire field.
    pub name: String,
    /// The `type` wire field.
    pub r#type: AuthSessionsListResponseEntriesItemServicePrincipalType,
}
/// Generated schema type `AuthSessionsListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "participantKind")]
pub enum AuthSessionsListResponseEntriesItem {
    /// The `app` variant.
    #[serde(rename = "app")]
    App {
        /// The `contractDisplayName` wire field.
        #[serde(rename = "contractDisplayName")]
        contract_display_name: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `key` wire field.
        key: String,
        /// The `lastAuth` wire field.
        #[serde(rename = "lastAuth")]
        last_auth: String,
        /// The `principal` wire field.
        principal: AuthSessionsListResponseEntriesItemAppPrincipal,
        /// The `sessionKey` wire field.
        #[serde(rename = "sessionKey")]
        session_key: String,
    },
    /// The `agent` variant.
    #[serde(rename = "agent")]
    Agent {
        /// The `contractDisplayName` wire field.
        #[serde(rename = "contractDisplayName")]
        contract_display_name: String,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `key` wire field.
        key: String,
        /// The `lastAuth` wire field.
        #[serde(rename = "lastAuth")]
        last_auth: String,
        /// The `principal` wire field.
        principal: AuthSessionsListResponseEntriesItemAgentPrincipal,
        /// The `sessionKey` wire field.
        #[serde(rename = "sessionKey")]
        session_key: String,
    },
    /// The `device` variant.
    #[serde(rename = "device")]
    Device {
        /// The `contractDisplayName` wire field.
        #[serde(rename = "contractDisplayName")]
        #[serde(skip_serializing_if = "Option::is_none")]
        contract_display_name: Option<String>,
        /// The `contractId` wire field.
        #[serde(rename = "contractId")]
        contract_id: String,
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `key` wire field.
        key: String,
        /// The `lastAuth` wire field.
        #[serde(rename = "lastAuth")]
        last_auth: String,
        /// The `principal` wire field.
        principal: AuthSessionsListResponseEntriesItemDevicePrincipal,
        /// The `sessionKey` wire field.
        #[serde(rename = "sessionKey")]
        session_key: String,
    },
    /// The `service` variant.
    #[serde(rename = "service")]
    Service {
        /// The `createdAt` wire field.
        #[serde(rename = "createdAt")]
        created_at: String,
        /// The `key` wire field.
        key: String,
        /// The `lastAuth` wire field.
        #[serde(rename = "lastAuth")]
        last_auth: String,
        /// The `principal` wire field.
        principal: AuthSessionsListResponseEntriesItemServicePrincipal,
        /// The `sessionKey` wire field.
        #[serde(rename = "sessionKey")]
        session_key: String,
    },
}
/// Generated schema type `AuthSessionsListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthSessionsListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthSessionsLogoutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsLogoutResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthSessionsMeResponseParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthSessionsMeResponseParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
    /// The `device` wire value.
    #[serde(rename = "device")]
    Device,
    /// The `service` wire value.
    #[serde(rename = "service")]
    Service,
}
impl AuthSessionsMeResponseParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
            Self::Device => "device",
            Self::Service => "service",
        }
    }
}
impl AsRef<str> for AuthSessionsMeResponseParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthSessionsMeResponseParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthSessionsMeResponseParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthSessionsMeResponseParticipantKind> for &str {
    fn eq(&self, other: &AuthSessionsMeResponseParticipantKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthSessionsMeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsMeResponse {
    /// The `device` wire field.
    pub device: Option<BTreeMap<String, Value>>,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind: AuthSessionsMeResponseParticipantKind,
    /// The `service` wire field.
    pub service: Option<BTreeMap<String, Value>>,
    /// The `user` wire field.
    pub user: Option<BTreeMap<String, Value>>,
}
/// Generated schema type `AuthSessionsRevokeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsRevokeRequest {
    /// The `sessionKey` wire field.
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}
/// Generated schema type `AuthSessionsRevokeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsRevokeResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthUserIdentitiesListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUserIdentitiesListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesListResponseEntriesItem {
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    /// The `email` wire field.
    pub email: Option<String>,
    /// The `emailVerified` wire field.
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `lastLoginAt` wire field.
    #[serde(rename = "lastLoginAt")]
    pub last_login_at: Option<String>,
    /// The `linkedAt` wire field.
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthUserIdentitiesListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthUserIdentitiesListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthUserIdentitiesUnlinkRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesUnlinkRequest {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUserIdentitiesUnlinkResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserIdentitiesUnlinkResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthUserLifecycleDeactivateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserLifecycleDeactivateRequest {
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUserLifecycleDeactivateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserLifecycleDeactivateResponse {
    /// The `deactivated` wire field.
    pub deactivated: bool,
    /// The `revokedSessions` wire field.
    #[serde(rename = "revokedSessions")]
    pub revoked_sessions: i64,
}
/// Generated schema type `AuthUserLifecycleInspectRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserLifecycleInspectRequest {
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthUserLifecycleInspectResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserLifecycleInspectResponse {
    /// The `active` wire field.
    pub active: Option<bool>,
    /// The `email` wire field.
    pub email: Option<String>,
    /// The `found` wire field.
    pub found: bool,
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: Option<String>,
    /// The `provider` wire field.
    pub provider: Option<String>,
    /// The `subject` wire field.
    pub subject: Option<String>,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
}
/// Generated schema type `AuthUserLifecycleUnlinkRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserLifecycleUnlinkRequest {
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUserLifecycleUnlinkResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUserLifecycleUnlinkResponse {
    /// The `unlinked` wire field.
    pub unlinked: bool,
}
/// Generated schema type `AuthUsersCreateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersCreateRequest {
    /// The `active` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    /// The `capabilities` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    /// The `capabilityGroups` wire field.
    #[serde(rename = "capabilityGroups")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_groups: Option<Vec<String>>,
    /// The `email` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// The `name` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The `username` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}
/// Generated schema type `AuthUsersCreateResponseUserIdentitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersCreateResponseUserIdentitiesItem {
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    /// The `email` wire field.
    pub email: Option<String>,
    /// The `emailVerified` wire field.
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `lastLoginAt` wire field.
    #[serde(rename = "lastLoginAt")]
    pub last_login_at: Option<String>,
    /// The `linkedAt` wire field.
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthUsersCreateResponseUser`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersCreateResponseUser {
    /// The `active` wire field.
    pub active: bool,
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `capabilityGroups` wire field.
    #[serde(rename = "capabilityGroups")]
    pub capability_groups: Vec<String>,
    /// The `email` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// The `identities` wire field.
    pub identities: Vec<AuthUsersCreateResponseUserIdentitiesItem>,
    /// The `name` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersCreateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersCreateResponse {
    /// The `user` wire field.
    pub user: AuthUsersCreateResponseUser,
}
/// Generated schema type `AuthUsersGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersGetRequest {
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersGetResponseUserIdentitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersGetResponseUserIdentitiesItem {
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    /// The `email` wire field.
    pub email: Option<String>,
    /// The `emailVerified` wire field.
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `lastLoginAt` wire field.
    #[serde(rename = "lastLoginAt")]
    pub last_login_at: Option<String>,
    /// The `linkedAt` wire field.
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthUsersGetResponseUser`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersGetResponseUser {
    /// The `active` wire field.
    pub active: bool,
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `capabilityGroups` wire field.
    #[serde(rename = "capabilityGroups")]
    pub capability_groups: Vec<String>,
    /// The `email` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// The `identities` wire field.
    pub identities: Vec<AuthUsersGetResponseUserIdentitiesItem>,
    /// The `name` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersGetResponse {
    /// The `user` wire field.
    pub user: AuthUsersGetResponseUser,
}
/// Generated schema type `AuthUsersIdentityLinkCreateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersIdentityLinkCreateRequest {
    /// The `returnTo` wire field.
    #[serde(rename = "returnTo")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_to: Option<String>,
}
/// Generated schema type `AuthUsersIdentityLinkCreateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersIdentityLinkCreateResponse {
    /// The `expiresAt` wire field.
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    /// The `flowId` wire field.
    #[serde(rename = "flowId")]
    pub flow_id: String,
    /// The `url` wire field.
    pub url: String,
}
/// Generated schema type `AuthUsersListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersListRequest {
    /// The `limit` wire field.
    pub limit: i64,
    /// The `offset` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `AuthUsersListResponseEntriesItemIdentitiesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersListResponseEntriesItemIdentitiesItem {
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    /// The `email` wire field.
    pub email: Option<String>,
    /// The `emailVerified` wire field.
    #[serde(rename = "emailVerified")]
    pub email_verified: bool,
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `lastLoginAt` wire field.
    #[serde(rename = "lastLoginAt")]
    pub last_login_at: Option<String>,
    /// The `linkedAt` wire field.
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthUsersListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersListResponseEntriesItem {
    /// The `active` wire field.
    pub active: bool,
    /// The `capabilities` wire field.
    pub capabilities: Vec<String>,
    /// The `capabilityGroups` wire field.
    #[serde(rename = "capabilityGroups")]
    pub capability_groups: Vec<String>,
    /// The `email` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// The `identities` wire field.
    pub identities: Vec<AuthUsersListResponseEntriesItemIdentitiesItem>,
    /// The `name` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersListResponse {
    /// The `count` wire field.
    pub count: i64,
    /// The `entries` wire field.
    pub entries: Vec<AuthUsersListResponseEntriesItem>,
    /// The `limit` wire field.
    pub limit: i64,
    /// The `nextOffset` wire field.
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    /// The `offset` wire field.
    pub offset: i64,
}
/// Generated schema type `AuthUsersPasswordChangeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersPasswordChangeRequest {
    /// The `currentPassword` wire field.
    #[serde(rename = "currentPassword")]
    pub current_password: String,
    /// The `newPassword` wire field.
    #[serde(rename = "newPassword")]
    pub new_password: String,
}
/// Generated schema type `AuthUsersPasswordChangeResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersPasswordChangeResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthUsersPasswordResetCreateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersPasswordResetCreateRequest {
    /// The `expiresInSeconds` wire field.
    #[serde(rename = "expiresInSeconds")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in_seconds: Option<i64>,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersPasswordResetCreateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersPasswordResetCreateResponse {
    /// The `expiresAt` wire field.
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    /// The `flowId` wire field.
    #[serde(rename = "flowId")]
    pub flow_id: String,
    /// The `url` wire field.
    pub url: String,
}
/// Generated schema type `AuthUsersResolveRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersResolveRequest {
    /// The `userIds` wire field.
    #[serde(rename = "userIds")]
    pub user_ids: Vec<String>,
}
/// Generated schema type `AuthUsersResolveResponseUsersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersResolveResponseUsersItem {
    /// The `displayName` wire field.
    #[serde(rename = "displayName")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// The `email` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersResolveResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersResolveResponse {
    /// The `missing` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<Vec<String>>,
    /// The `users` wire field.
    pub users: Vec<AuthUsersResolveResponseUsersItem>,
}
/// Generated schema type `AuthUsersUpdateRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersUpdateRequest {
    /// The `active` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    /// The `capabilities` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    /// The `capabilityGroups` wire field.
    #[serde(rename = "capabilityGroups")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_groups: Option<Vec<String>>,
    /// The `email` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// The `name` wire field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthUsersUpdateResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUsersUpdateResponse {
    /// The `success` wire field.
    pub success: bool,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolveInput`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolveInput {
    /// The `flowId` wire field.
    #[serde(rename = "flowId")]
    pub flow_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolveProgressStatus`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesResolveProgressStatus {
    /// The `pending_review` wire value.
    #[serde(rename = "pending_review")]
    PendingReview,
}
impl AuthDeviceUserAuthoritiesResolveProgressStatus {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::PendingReview => "pending_review",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesResolveProgressStatus {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesResolveProgressStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesResolveProgressStatus {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesResolveProgressStatus> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesResolveProgressStatus) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolveProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolveProgress {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `requestedAt` wire field.
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    /// The `reviewId` wire field.
    #[serde(rename = "reviewId")]
    pub review_id: String,
    /// The `status` wire field.
    pub status: AuthDeviceUserAuthoritiesResolveProgressStatus,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolveOutput`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status")]
pub enum AuthDeviceUserAuthoritiesResolveOutput {
    /// The `activated` variant.
    #[serde(rename = "activated")]
    Activated {
        /// The `activatedAt` wire field.
        #[serde(rename = "activatedAt")]
        activated_at: String,
        /// The `confirmationCode` wire field.
        #[serde(rename = "confirmationCode")]
        #[serde(skip_serializing_if = "Option::is_none")]
        confirmation_code: Option<String>,
        /// The `deploymentId` wire field.
        #[serde(rename = "deploymentId")]
        deployment_id: String,
        /// The `instanceId` wire field.
        #[serde(rename = "instanceId")]
        instance_id: String,
    },
    /// The `rejected` variant.
    #[serde(rename = "rejected")]
    Rejected {
        /// The `reason` wire field.
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}
/// Generated schema type `AuthConnectionsClosedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsClosedEvent {
    /// The `id` wire field.
    pub id: String,
    /// The `origin` wire field.
    pub origin: String,
    /// The `sessionKey` wire field.
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    /// The `userNkey` wire field.
    #[serde(rename = "userNkey")]
    pub user_nkey: String,
}
/// Generated schema type `AuthConnectionsKickedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsKickedEvent {
    /// The `id` wire field.
    pub id: String,
    /// The `kickedBy` wire field.
    #[serde(rename = "kickedBy")]
    pub kicked_by: String,
    /// The `origin` wire field.
    pub origin: String,
    /// The `userNkey` wire field.
    #[serde(rename = "userNkey")]
    pub user_nkey: String,
}
/// Generated schema type `AuthConnectionsOpenedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionsOpenedEvent {
    /// The `id` wire field.
    pub id: String,
    /// The `origin` wire field.
    pub origin: String,
    /// The `sessionKey` wire field.
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    /// The `userNkey` wire field.
    #[serde(rename = "userNkey")]
    pub user_nkey: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventApprovedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEventApprovedByIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventApprovedBy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEventApprovedBy {
    /// The `identity` wire field.
    pub identity: AuthDeviceUserAuthoritiesApprovedEventApprovedByIdentity,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind: AuthDeviceUserAuthoritiesApprovedEventApprovedByParticipantKind,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventRequestedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEventRequestedByIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEventRequestedBy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEventRequestedBy {
    /// The `identity` wire field.
    pub identity: AuthDeviceUserAuthoritiesApprovedEventRequestedByIdentity,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind: AuthDeviceUserAuthoritiesApprovedEventRequestedByParticipantKind,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesApprovedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesApprovedEvent {
    /// The `approvedAt` wire field.
    #[serde(rename = "approvedAt")]
    pub approved_at: String,
    /// The `approvedBy` wire field.
    #[serde(rename = "approvedBy")]
    pub approved_by: AuthDeviceUserAuthoritiesApprovedEventApprovedBy,
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `flowId` wire field.
    #[serde(rename = "flowId")]
    pub flow_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `requestedAt` wire field.
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    /// The `requestedBy` wire field.
    #[serde(rename = "requestedBy")]
    pub requested_by: AuthDeviceUserAuthoritiesApprovedEventRequestedBy,
    /// The `reviewId` wire field.
    #[serde(rename = "reviewId")]
    pub review_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesRequestedEventRequestedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRequestedEventRequestedByIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind> for &str {
    fn eq(
        &self,
        other: &AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesRequestedEventRequestedBy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRequestedEventRequestedBy {
    /// The `identity` wire field.
    pub identity: AuthDeviceUserAuthoritiesRequestedEventRequestedByIdentity,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind: AuthDeviceUserAuthoritiesRequestedEventRequestedByParticipantKind,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesRequestedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesRequestedEvent {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `flowId` wire field.
    #[serde(rename = "flowId")]
    pub flow_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `requestedAt` wire field.
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    /// The `requestedBy` wire field.
    #[serde(rename = "requestedBy")]
    pub requested_by: AuthDeviceUserAuthoritiesRequestedEventRequestedBy,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolvedEventResolvedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolvedEventResolvedByIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind> for &str {
    fn eq(&self, other: &AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolvedEventResolvedBy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolvedEventResolvedBy {
    /// The `identity` wire field.
    pub identity: AuthDeviceUserAuthoritiesResolvedEventResolvedByIdentity,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind: AuthDeviceUserAuthoritiesResolvedEventResolvedByParticipantKind,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesResolvedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesResolvedEvent {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `flowId` wire field.
    #[serde(rename = "flowId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_id: Option<String>,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `resolvedAt` wire field.
    #[serde(rename = "resolvedAt")]
    pub resolved_at: String,
    /// The `resolvedBy` wire field.
    #[serde(rename = "resolvedBy")]
    pub resolved_by: AuthDeviceUserAuthoritiesResolvedEventResolvedBy,
    /// The `reviewId` wire field.
    #[serde(rename = "reviewId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByIdentity`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByIdentity {
    /// The `identityId` wire field.
    #[serde(rename = "identityId")]
    pub identity_id: String,
    /// The `provider` wire field.
    pub provider: String,
    /// The `subject` wire field.
    pub subject: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind {
    /// The `app` wire value.
    #[serde(rename = "app")]
    App,
    /// The `agent` wire value.
    #[serde(rename = "agent")]
    Agent,
}
impl AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind {
    /// Return the contract wire value.
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Agent => "agent",
        }
    }
}
impl AsRef<str> for AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl PartialEq<&str> for AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}
impl PartialEq<AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind> for &str {
    fn eq(
        &self,
        other: &AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind,
    ) -> bool {
        *self == other.as_str()
    }
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewRequestedEventRequestedBy`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewRequestedEventRequestedBy {
    /// The `identity` wire field.
    pub identity: AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByIdentity,
    /// The `participantKind` wire field.
    #[serde(rename = "participantKind")]
    pub participant_kind: AuthDeviceUserAuthoritiesReviewRequestedEventRequestedByParticipantKind,
    /// The `userId` wire field.
    #[serde(rename = "userId")]
    pub user_id: String,
}
/// Generated schema type `AuthDeviceUserAuthoritiesReviewRequestedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDeviceUserAuthoritiesReviewRequestedEvent {
    /// The `deploymentId` wire field.
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    /// The `flowId` wire field.
    #[serde(rename = "flowId")]
    pub flow_id: String,
    /// The `instanceId` wire field.
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    /// The `publicIdentityKey` wire field.
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    /// The `requestedAt` wire field.
    #[serde(rename = "requestedAt")]
    pub requested_at: String,
    /// The `requestedBy` wire field.
    #[serde(rename = "requestedBy")]
    pub requested_by: AuthDeviceUserAuthoritiesReviewRequestedEventRequestedBy,
    /// The `reviewId` wire field.
    #[serde(rename = "reviewId")]
    pub review_id: String,
}
/// Generated schema type `AuthSessionsRevokedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionsRevokedEvent {
    /// The `id` wire field.
    pub id: String,
    /// The `origin` wire field.
    pub origin: String,
    /// The `revokedBy` wire field.
    #[serde(rename = "revokedBy")]
    pub revoked_by: String,
    /// The `sessionKey` wire field.
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}
