//! Reusable Trellis auth/session helpers for Rust clients and the Trellis agent.

mod browser_login;
mod client;
mod device_activation;
mod device_identity;
mod error;
mod models;
mod protocol;
mod session_store;

pub use crate::service::payload_hash_base64url;
pub use browser_login::{
    cli_participant_digest, cli_participant_grants, contract_digest, generate_session_keypair,
    start_admin_reauth, start_agent_login,
};
pub use client::{connect_admin_client_async, session_public_key};
#[cfg(feature = "test-support")]
#[doc(hidden)]
pub use device_activation::check_device_activation_with_test_proof;
pub use device_activation::{
    check_device_activation, derive_device_confirmation_code, wait_for_device_activation,
    DeviceActivationError, DeviceActivationOptions, DeviceActivationPending,
    DeviceActivationSession, DeviceActivationStatus,
};
pub use device_identity::derive_device_identity;
pub use error::TrellisAuthError;
pub use models::{
    AdminLoginOutcome, AdminReauthOutcome, AdminSessionState, AgentLoginChallenge, BoundSession,
    DeviceIdentity, StartAgentLoginOpts,
};
pub use protocol::AuthenticatedUser;
pub use session_store::{
    admin_session_matches_participant, clear_admin_session, load_admin_session, save_admin_session,
};
