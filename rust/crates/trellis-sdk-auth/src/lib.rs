//! Generated Rust SDK crate for one Trellis contract.

pub mod client;
pub mod contract;
pub mod events;
pub mod rpc;
pub mod server;
pub mod subjects;
pub mod types;

pub use client::AuthClient;
pub use contract::{contract_manifest, CONTRACT_DIGEST, CONTRACT_ID, CONTRACT_JSON, CONTRACT_NAME};
pub use events::*;
pub use rpc::*;
pub use types::*;

pub use types::{
    AuthListApprovalsRequest as ListApprovalsRequest,
    AuthListApprovalsResponseApprovalsItem as ApprovalEntryRecord,
    AuthListApprovalsResponseApprovalsItemApproval as ApprovalScopeRecord,
    AuthListServicesResponseServicesItem as ServiceListEntry,
    AuthMeResponseUser as AuthenticatedUser,
    AuthRenewBindingTokenResponse as RenewBindingTokenResponse,
    AuthRenewBindingTokenResponseSentinel as SentinelCredsRecord,
    AuthRevokeApprovalRequest as RevokeApprovalRequest,
};
