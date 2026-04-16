//! Reusable Trellis auth/session helpers for Rust clients and the CLI.

mod browser_login;
mod client;
mod device_activation;
mod error;
mod models;
mod protocol;
mod session_store;

pub use browser_login::{generate_session_keypair, start_admin_reauth, start_browser_login};
pub use client::{connect_admin_client_async, persist_renewed_admin_session, AuthClient};
pub use device_activation::{
    build_device_activation_payload, build_device_activation_url, build_device_wait_proof_input,
    derive_device_confirmation_code, derive_device_identity, derive_device_qr_mac,
    encode_device_activation_payload, parse_device_activation_payload, sign_device_wait_request,
    verify_device_confirmation_code, wait_for_device_activation,
    wait_for_device_activation_response,
};
pub use error::TrellisAuthError;
pub use models::{
    AdminLoginOutcome, AdminReauthOutcome, AdminSessionState, BoundSession, BrowserLoginChallenge,
    DeviceActivationActivatedResponse, DeviceActivationPayload, DeviceActivationPendingResponse,
    DeviceActivationRejectedResponse, DeviceActivationWaitRequest, DeviceIdentity,
    StartBrowserLoginOpts, WaitForDeviceActivationOpts, WaitForDeviceActivationResponse,
};
pub use protocol::{
    ApprovalEntryRecord, ApprovalScopeRecord, AuthGetInstalledContractRequest,
    AuthGetInstalledContractResponse, AuthGetInstalledContractResponseContract,
    AuthInstallServiceRequest, AuthInstallServiceResponse, AuthRemoveServiceRequest,
    AuthRemoveServiceResponse, AuthUpgradeServiceContractRequest,
    AuthUpgradeServiceContractResponse, AuthStartRequest, AuthStartResponse,
    AuthValidateRequestRequest, AuthValidateRequestResponse, AuthenticatedUser,
    ClientTransportRecord, ClientTransportsRecord, DisableInstanceGrantPolicyRequest,
    InstanceGrantPolicyActorRecord, InstanceGrantPolicyRecord, InstanceGrantPolicySourceRecord,
    ListApprovalsRequest, RenewBindingTokenBoundResponse, RenewBindingTokenRequest,
    RenewBindingTokenResponse,
    RevokeApprovalRequest, SentinelCredsRecord, ServiceListEntry, UpsertInstanceGrantPolicyRequest,
};
pub use session_store::{clear_admin_session, load_admin_session, save_admin_session};

#[cfg(test)]
mod tests;
