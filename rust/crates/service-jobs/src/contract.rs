//! Runtime adapter for hosting the standard Trellis Jobs API.

use trellis::sdk::jobs::contract as generated_contract;
use trellis::sdk::jobs::rpc::{
    JobsCancelRpc, JobsDismissDLQRpc, JobsGetRpc, JobsHealthRpc, JobsListDLQRpc, JobsListRpc,
    JobsListServicesRpc, JobsReplayDLQRpc, JobsRetryRpc,
};
use trellis::service::BootstrapContractRef;
use trellis::service::RpcDescriptor;

/// Runtime service name for the Jobs admin host.
pub const SERVICE_NAME: &str = "trellis-service-jobs";
/// Exact RPC subjects served by the Jobs admin service.
pub const JOBS_RPC_SUBJECTS: &[&str] = &[
    <JobsHealthRpc as RpcDescriptor>::SUBJECT,
    <JobsListServicesRpc as RpcDescriptor>::SUBJECT,
    <JobsListRpc as RpcDescriptor>::SUBJECT,
    <JobsGetRpc as RpcDescriptor>::SUBJECT,
    <JobsCancelRpc as RpcDescriptor>::SUBJECT,
    <JobsRetryRpc as RpcDescriptor>::SUBJECT,
    <JobsListDLQRpc as RpcDescriptor>::SUBJECT,
    <JobsReplayDLQRpc as RpcDescriptor>::SUBJECT,
    <JobsDismissDLQRpc as RpcDescriptor>::SUBJECT,
];

pub use generated_contract::{contract_manifest, CONTRACT_DIGEST, CONTRACT_ID, CONTRACT_JSON};
pub use trellis::sdk::jobs::rpc;

/// Return the contract id/digest pair expected by the Jobs admin service.
pub fn expected_contract() -> BootstrapContractRef {
    BootstrapContractRef {
        id: CONTRACT_ID.to_string(),
        digest: CONTRACT_DIGEST.to_string(),
    }
}
