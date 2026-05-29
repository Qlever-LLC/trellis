//! Reusable Trellis auth/session helpers for Rust clients and the Trellis agent.

mod browser_login;
mod client;
mod device_activation;
mod error;
mod models;
mod protocol;
mod session_store;

pub use crate::sdk::auth::types::{
    AuthCapabilitiesListRequest, AuthCapabilitiesListResponse,
    AuthCapabilitiesListResponseEntriesItem, AuthCapabilityGroupsListRequest,
    AuthCapabilityGroupsListResponse, AuthCapabilityGroupsListResponseEntriesItem,
    AuthDeploymentsCreateRequest, AuthDeploymentsCreateResponse, AuthDeploymentsDisableRequest,
    AuthDeploymentsDisableResponse, AuthDeploymentsEnableRequest, AuthDeploymentsEnableResponse,
    AuthDeploymentsListRequest, AuthDeploymentsListResponse, AuthDeploymentsRemoveRequest,
    AuthDeploymentsRemoveResponse, AuthDevicesDisableRequest, AuthDevicesDisableResponse,
    AuthDevicesEnableRequest, AuthDevicesEnableResponse, AuthDevicesListRequest,
    AuthDevicesListResponse, AuthDevicesProvisionRequest, AuthDevicesProvisionResponse,
    AuthDevicesRemoveRequest, AuthDevicesRemoveResponse, AuthIdentityGrantsListRequest,
    AuthIdentityGrantsListResponse, AuthIdentityGrantsListResponseEntriesItem,
    AuthIdentityGrantsRevokeRequest, AuthIdentityGrantsRevokeResponse,
    AuthServiceInstancesDisableRequest, AuthServiceInstancesDisableResponse,
    AuthServiceInstancesEnableRequest, AuthServiceInstancesEnableResponse,
    AuthServiceInstancesListRequest, AuthServiceInstancesListResponse,
    AuthServiceInstancesProvisionRequest, AuthServiceInstancesProvisionResponse,
    AuthServiceInstancesRemoveRequest, AuthServiceInstancesRemoveResponse, AuthSessionsListRequest,
    AuthSessionsListResponse, AuthSessionsMeResponse, AuthUsersCreateRequest,
    AuthUsersCreateResponse, AuthUsersCreateResponseUser, AuthUsersGetRequest,
    AuthUsersGetResponse, AuthUsersGetResponseUser, AuthUsersListRequest, AuthUsersListResponse,
    AuthUsersListResponseEntriesItem, AuthUsersPasswordResetCreateRequest,
    AuthUsersPasswordResetCreateResponse, AuthUsersUpdateRequest, AuthUsersUpdateResponse,
};
pub use crate::service::payload_hash_base64url;
pub use browser_login::{
    contract_digest, generate_session_keypair, start_admin_reauth, start_agent_login,
};
pub use client::{
    connect_admin_client_async, AuthClient, DeviceDeploymentRecord, RemoveDeviceDeploymentOptions,
    RemoveServiceDeploymentOptions, ServiceDeploymentRecord,
};
pub use device_activation::{
    build_device_activation_payload, build_device_wait_proof_input,
    derive_device_confirmation_code, derive_device_identity, derive_device_qr_mac,
    encode_device_activation_payload, get_device_connect_info, parse_device_activation_payload,
    sign_device_wait_request, start_device_activation_request, verify_device_confirmation_code,
    wait_for_device_activation, wait_for_device_activation_response, DeviceActivationLocalState,
    DeviceActivationSession, DeviceActivationSessionBuilder, DeviceActivationStartResponse,
    DeviceActivationStatus,
};
pub use error::TrellisAuthError;
pub use models::{
    AdminLoginOutcome, AdminReauthOutcome, AdminSessionState, AgentLoginChallenge, BoundSession,
    DeviceActivationActivatedResponse, DeviceActivationPayload, DeviceActivationPendingResponse,
    DeviceActivationRejectedResponse, DeviceActivationWaitRequest, DeviceConnectInfo,
    DeviceConnectInfoAuth, DeviceConnectInfoAuthMode, DeviceConnectInfoNativeTransport,
    DeviceConnectInfoRequest, DeviceConnectInfoResponse, DeviceConnectInfoSentinel,
    DeviceConnectInfoTransport, DeviceConnectInfoTransports, DeviceIdentity,
    GetDeviceConnectInfoOpts, StartAgentLoginOpts, WaitForDeviceActivationOpts,
    WaitForDeviceActivationResponse,
};
pub use protocol::{
    AuthRequestsValidateRequest, AuthRequestsValidateResponse, AuthStartRequest, AuthStartResponse,
    AuthenticatedIdentity, AuthenticatedUser, ClientTransportRecord, ClientTransportsRecord,
    IdentityGrantContractEvidenceRecord, IdentityGrantEntryRecord, JobsBindings, JobsRegistry,
    ListIdentityGrantsRequest, ResourceBindings, RevokeIdentityGrantRequest, SentinelCredsRecord,
};
pub use session_store::{clear_admin_session, load_admin_session, save_admin_session};

#[cfg(test)]
mod tests;
