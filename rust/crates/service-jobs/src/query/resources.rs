use trellis::sdk::core::types::{TrellisBindingsGetRequest, TrellisBindingsGetResponseBinding};
use trellis::service::{BootstrapContractRef, CoreBootstrapClientPort};

use super::JobsQueryError;

const BUILTIN_JOBS_STREAM: &str = "JOBS";
const BUILTIN_JOBS_ADVISORIES_STREAM: &str = "JOBS_ADVISORIES";

/// Resolved admin-side resources needed by projector, janitor, and advisory loops.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobsAdminResources {
    pub jobs_stream: String,
    pub jobs_advisories_stream: String,
}

/// Resolve all admin-side Jobs resources from Trellis bootstrap bindings.
pub async fn resolve_jobs_admin_resources<C>(
    core_client: &C,
    expected_contract: &BootstrapContractRef,
) -> Result<JobsAdminResources, JobsQueryError>
where
    C: CoreBootstrapClientPort,
{
    let binding = fetch_binding(core_client, expected_contract).await?;
    jobs_admin_resources_from_binding(&binding)
}

/// Extract all Jobs admin resource names from a resolved binding payload.
pub fn jobs_admin_resources_from_binding(
    _binding: &TrellisBindingsGetResponseBinding,
) -> Result<JobsAdminResources, JobsQueryError> {
    Ok(JobsAdminResources {
        jobs_stream: BUILTIN_JOBS_STREAM.to_string(),
        jobs_advisories_stream: BUILTIN_JOBS_ADVISORIES_STREAM.to_string(),
    })
}

async fn fetch_binding<C>(
    core_client: &C,
    expected_contract: &BootstrapContractRef,
) -> Result<TrellisBindingsGetResponseBinding, JobsQueryError>
where
    C: CoreBootstrapClientPort,
{
    let binding_response = core_client
        .trellis_bindings_get(&TrellisBindingsGetRequest {
            contract_id: Some(expected_contract.id.clone()),
            digest: Some(expected_contract.digest.clone()),
        })
        .await
        .map_err(|error| JobsQueryError::BindingsFetch(error.to_string()))?;

    binding_response
        .binding
        .ok_or(JobsQueryError::MissingBinding)
}
