//! Reusable Trellis auth/session helpers for Rust clients and the Trellis agent.

mod browser_login;
mod client;
mod device_activation;
mod error;
mod models;
mod protocol;
mod session_store;

pub use browser_login::{
    contract_digest, generate_session_keypair, start_admin_reauth, start_agent_login,
};
pub use client::{connect_admin_client_async, AuthClient};
pub use device_activation::{
    build_device_activation_payload, build_device_wait_proof_input,
    derive_device_confirmation_code, derive_device_identity, derive_device_qr_mac,
    encode_device_activation_payload, parse_device_activation_payload, sign_device_wait_request,
    start_device_activation_request, verify_device_confirmation_code, wait_for_device_activation,
    wait_for_device_activation_response, DeviceActivationStartResponse,
};
pub use error::TrellisAuthError;
pub use models::{
    AdminLoginOutcome, AdminReauthOutcome, AdminSessionState, AgentLoginChallenge, BoundSession,
    DeviceActivationActivatedResponse, DeviceActivationPayload, DeviceActivationPendingResponse,
    DeviceActivationRejectedResponse, DeviceActivationWaitRequest, DeviceIdentity,
    StartAgentLoginOpts, WaitForDeviceActivationOpts, WaitForDeviceActivationResponse,
};
pub use protocol::{
    ApprovalEntryRecord, ApprovalScopeRecord, AuthGetInstalledContractRequest,
    AuthGetInstalledContractResponse, AuthGetInstalledContractResponseContract, AuthStartRequest,
    AuthStartResponse, AuthValidateRequestRequest, AuthValidateRequestResponse, AuthenticatedUser,
    ClientTransportRecord, ClientTransportsRecord, DisableInstanceGrantPolicyRequest,
    InstanceGrantPolicyActorRecord, InstanceGrantPolicyRecord, InstanceGrantPolicySourceRecord,
    JobsBindings, JobsRegistry, ListApprovalsRequest, ResourceBindings, RevokeApprovalRequest,
    SentinelCredsRecord, UpsertInstanceGrantPolicyRequest,
};
pub use session_store::{clear_admin_session, load_admin_session, save_admin_session};
pub use trellis_sdk_auth::types::{
    AuthApplyDeviceDeploymentContractRequest, AuthApplyDeviceDeploymentContractResponse,
    AuthApplyServiceDeploymentContractRequest, AuthApplyServiceDeploymentContractResponse,
    AuthCreateDeviceDeploymentRequest, AuthCreateDeviceDeploymentResponse,
    AuthCreateServiceDeploymentRequest, AuthCreateServiceDeploymentResponse,
    AuthDisableDeviceDeploymentRequest, AuthDisableDeviceDeploymentResponse,
    AuthDisableDeviceInstanceRequest, AuthDisableDeviceInstanceResponse,
    AuthDisableServiceDeploymentRequest, AuthDisableServiceDeploymentResponse,
    AuthDisableServiceInstanceRequest, AuthDisableServiceInstanceResponse,
    AuthEnableDeviceDeploymentRequest, AuthEnableDeviceDeploymentResponse,
    AuthEnableDeviceInstanceRequest, AuthEnableDeviceInstanceResponse,
    AuthEnableServiceDeploymentRequest, AuthEnableServiceDeploymentResponse,
    AuthEnableServiceInstanceRequest, AuthEnableServiceInstanceResponse,
    AuthListDeviceDeploymentsRequest, AuthListDeviceDeploymentsResponse,
    AuthListDeviceInstancesRequest, AuthListDeviceInstancesResponse,
    AuthListServiceDeploymentsRequest, AuthListServiceDeploymentsResponse,
    AuthListServiceInstancesRequest, AuthListServiceInstancesResponse,
    AuthProvisionDeviceInstanceRequest, AuthProvisionDeviceInstanceResponse,
    AuthProvisionServiceInstanceRequest, AuthProvisionServiceInstanceResponse,
    AuthRemoveDeviceDeploymentRequest, AuthRemoveDeviceDeploymentResponse,
    AuthRemoveDeviceInstanceRequest, AuthRemoveDeviceInstanceResponse,
    AuthRemoveServiceDeploymentRequest, AuthRemoveServiceDeploymentResponse,
    AuthRemoveServiceInstanceRequest, AuthRemoveServiceInstanceResponse,
    AuthUnapplyDeviceDeploymentContractRequest, AuthUnapplyDeviceDeploymentContractResponse,
    AuthUnapplyServiceDeploymentContractRequest, AuthUnapplyServiceDeploymentContractResponse,
};

#[cfg(test)]
mod tests;
