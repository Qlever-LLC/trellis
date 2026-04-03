use std::collections::BTreeMap;

use trellis_core_bootstrap::CoreBootstrapClientPort;
use trellis_sdk_core::types::{
    TrellisBindingsGetRequest, TrellisBindingsGetResponseBinding,
    TrellisBindingsGetResponseBindingResourcesKvValue, TrellisBindingsGetResponseBindingResourcesStreamsValue,
};
use trellis_server::BootstrapContractRef;

use super::{JobsKvBuckets, JobsQueryError, JOBS_STATE_ALIAS};
use crate::worker_presence::worker_presence_bucket_name;

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
    let jobs_stream = extract_stream(streams_required(binding)?, "jobs")?;

    Ok(JobsKvBuckets {
        jobs_state_bucket,
        worker_presence_bucket: worker_presence_bucket_name(&jobs_stream.name),
        worker_presence_replicas: jobs_stream.num_replicas.unwrap_or(1).max(1) as usize,
    })
}

/// Extract all Jobs admin resource names from a resolved binding payload.
pub fn jobs_admin_resources_from_binding(
    binding: &TrellisBindingsGetResponseBinding,
) -> Result<JobsAdminResources, JobsQueryError> {
    let buckets = jobs_kv_buckets_from_binding(binding)?;
    let streams = binding
        .resources
        .streams
        .as_ref()
        .ok_or(JobsQueryError::MissingStreamResources)?;
    let jobs_stream = streams
        .get("jobs")
        .map(|stream| stream.name.clone())
        .ok_or_else(|| JobsQueryError::MissingStreamAlias("jobs".to_string()))?;
    let jobs_advisories_stream = streams
        .get("jobsAdvisories")
        .map(|stream| stream.name.clone())
        .ok_or_else(|| JobsQueryError::MissingStreamAlias("jobsAdvisories".to_string()))?;

    Ok(JobsAdminResources {
        jobs_state_bucket: buckets.jobs_state_bucket,
        worker_presence_bucket: buckets.worker_presence_bucket,
        worker_presence_replicas: buckets.worker_presence_replicas,
        jobs_stream,
        jobs_advisories_stream,
    })
}

fn streams_required(
    binding: &TrellisBindingsGetResponseBinding,
) -> Result<&std::collections::BTreeMap<String, TrellisBindingsGetResponseBindingResourcesStreamsValue>, JobsQueryError> {
    binding
        .resources
        .streams
        .as_ref()
        .ok_or(JobsQueryError::MissingStreamResources)
}

fn extract_stream<'a>(
    streams: &'a std::collections::BTreeMap<String, TrellisBindingsGetResponseBindingResourcesStreamsValue>,
    alias: &str,
) -> Result<&'a TrellisBindingsGetResponseBindingResourcesStreamsValue, JobsQueryError> {
    streams
        .get(alias)
        .ok_or_else(|| JobsQueryError::MissingStreamAlias(alias.to_string()))
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
