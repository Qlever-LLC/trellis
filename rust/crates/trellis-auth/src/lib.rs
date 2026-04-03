//! Reusable Trellis auth/session helpers for Rust clients and the CLI.

mod browser_login;
mod client;
mod error;
mod models;
mod protocol;
mod session_store;

pub use browser_login::{build_auth_login_url, generate_session_keypair, start_browser_login};
pub use client::{connect_admin_client_async, persist_renewed_admin_session, AuthClient};
pub use error::TrellisAuthError;
pub use models::{
    AdminLoginOutcome, AdminSessionState, BoundSession, BrowserLoginChallenge,
    StartBrowserLoginOpts,
};
pub use protocol::{
    ApprovalEntryRecord, ApprovalScopeRecord, AuthGetInstalledContractRequest,
    AuthGetInstalledContractResponse, AuthInstallServiceRequest, AuthInstallServiceResponse,
    AuthUpgradeServiceContractRequest, AuthUpgradeServiceContractResponse,
    AuthValidateRequestRequest, AuthValidateRequestResponse, AuthenticatedUser,
    ListApprovalsRequest, RenewBindingTokenResponse, RevokeApprovalRequest, SentinelCredsRecord,
    ServiceListEntry,
};
pub use session_store::{clear_admin_session, load_admin_session, save_admin_session};

#[cfg(test)]
mod tests;
