//! Reusable Trellis auth/session helpers for Rust clients and the CLI.

mod browser_login;
mod client;
mod error;
mod models;
mod protocol;
mod session_store;
mod workload_activation;

pub use browser_login::{build_auth_login_url, generate_session_keypair, start_browser_login};
pub use client::{
    connect_admin_client_async, persist_renewed_admin_session, AuthClient,
};
pub use workload_activation::{
    build_workload_activation_payload, build_workload_activation_url, build_workload_wait_proof_input,
    derive_workload_confirmation_code, derive_workload_identity, derive_workload_qr_mac,
    encode_workload_activation_payload, parse_workload_activation_payload, sign_workload_wait_request,
    verify_workload_confirmation_code, wait_for_workload_activation,
    wait_for_workload_activation_response,
};
pub use error::TrellisAuthError;
pub use models::{
    AdminLoginOutcome, AdminSessionState, BoundSession, BrowserLoginChallenge,
    StartBrowserLoginOpts, WaitForWorkloadActivationOpts, WaitForWorkloadActivationResponse,
    WorkloadActivationActivatedResponse, WorkloadActivationPayload,
    WorkloadActivationPendingResponse, WorkloadActivationRejectedResponse,
    WorkloadActivationWaitRequest, WorkloadIdentity,
};
pub use protocol::{
    ApprovalEntryRecord, ApprovalScopeRecord, AuthGetInstalledContractRequest,
    AuthGetInstalledContractResponse, AuthGetInstalledContractResponseContract,
    AuthInstallServiceRequest, AuthInstallServiceResponse, AuthUpgradeServiceContractRequest,
    AuthUpgradeServiceContractResponse, AuthValidateRequestRequest, AuthValidateRequestResponse,
    AuthenticatedUser, ListApprovalsRequest,
    RenewBindingTokenResponse, RevokeApprovalRequest, SentinelCredsRecord, ServiceListEntry,
};
pub use session_store::{clear_admin_session, load_admin_session, save_admin_session};

#[cfg(test)]
mod tests;
