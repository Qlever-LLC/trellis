use std::collections::BTreeMap;

use trellis_core_bootstrap::CoreBootstrapClientPort;
use trellis_sdk_core::types::{
    TrellisBindingsGetRequest, TrellisBindingsGetResponseBinding,
    TrellisBindingsGetResponseBindingResourcesKvValue,
};
use trellis_server::BootstrapContractRef;

use super::{JobsKvBuckets, JobsQueryError, JOBS_STATE_ALIAS};
use crate::worker_presence::worker_presence_bucket_name;

const BUILTIN_JOBS_STREAM: &str = "JOBS";
const BUILTIN_JOBS_ADVISORIES_STREAM: &str = "JOBS_ADVISORIES";
const BUILTIN_JOBS_STREAM_REPLICAS: usize = 3;

/// Resolved admin-side resources needed by projector, janitor, and advisory loops.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobsAdminResources {
    pub jobs_state_bucket: String,
    pub worker_presence_bucket: String,
    pub worker_presence_replicas: usize,
    pub jobs_stream: String,
    pub jobs_advisories_stream: String,
}

impl JobsAdminResources {
    /// Return just the KV bucket names needed by query code.
    pub fn kv_buckets(&self) -> JobsKvBuckets {
        JobsKvBuckets {
            jobs_state_bucket: self.jobs_state_bucket.clone(),
            worker_presence_bucket: self.worker_presence_bucket.clone(),
            worker_presence_replicas: self.worker_presence_replicas,
        }
    }
}

/// Resolve the KV buckets needed by Jobs query code from Trellis bootstrap bindings.
pub async fn resolve_jobs_kv_buckets<C>(
    core_client: &C,
    expected_contract: &BootstrapContractRef,
) -> Result<JobsKvBuckets, JobsQueryError>
where
    C: CoreBootstrapClientPort,
{
    let binding = fetch_binding(core_client, expected_contract).await?;
    jobs_kv_buckets_from_binding(&binding)
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

/// Extract the Jobs KV bucket names from a resolved binding payload.
pub fn jobs_kv_buckets_from_binding(
    binding: &TrellisBindingsGetResponseBinding,
) -> Result<JobsKvBuckets, JobsQueryError> {
    let kv = binding
        .resources
        .kv
        .as_ref()
        .ok_or(JobsQueryError::MissingKvResources)?;

    let jobs_state_bucket = extract_bucket_alias(kv, JOBS_STATE_ALIAS)?;

    Ok(JobsKvBuckets {
        jobs_state_bucket,
        worker_presence_bucket: worker_presence_bucket_name(BUILTIN_JOBS_STREAM),
        worker_presence_replicas: BUILTIN_JOBS_STREAM_REPLICAS,
    })
}

/// Extract all Jobs admin resource names from a resolved binding payload.
pub fn jobs_admin_resources_from_binding(
    binding: &TrellisBindingsGetResponseBinding,
) -> Result<JobsAdminResources, JobsQueryError> {
    let buckets = jobs_kv_buckets_from_binding(binding)?;

    Ok(JobsAdminResources {
        jobs_state_bucket: buckets.jobs_state_bucket,
        worker_presence_bucket: buckets.worker_presence_bucket,
        worker_presence_replicas: buckets.worker_presence_replicas,
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

fn extract_bucket_alias(
    kv: &BTreeMap<String, TrellisBindingsGetResponseBindingResourcesKvValue>,
    alias: &str,
) -> Result<String, JobsQueryError> {
    let value = kv
        .get(alias)
        .ok_or_else(|| JobsQueryError::MissingKvAlias(alias.to_string()))?;
    if value.bucket.is_empty() {
        return Err(JobsQueryError::InvalidKvAliasShape(alias.to_string()));
    }
    Ok(value.bucket.clone())
}
