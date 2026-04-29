//! Runtime adapter for hosting the standard Trellis Jobs API.

use trellis_sdk_jobs::contract as generated_contract;
use trellis_server::BootstrapContractRef;

/// Runtime service name for the Jobs admin host.
pub const SERVICE_NAME: &str = "trellis-service-jobs";
/// Wildcard subject used by the admin service request loop.
pub const JOBS_RPC_SUBJECT_WILDCARD: &str = "rpc.v1.Jobs.*";

pub use generated_contract::{contract_manifest, CONTRACT_DIGEST, CONTRACT_ID};
pub use trellis_sdk_jobs::rpc;

/// Return the contract id/digest pair expected by the Jobs admin service.
pub fn expected_contract() -> BootstrapContractRef {
    BootstrapContractRef {
        id: CONTRACT_ID.to_string(),
        digest: CONTRACT_DIGEST.to_string(),
    }
}
