use std::collections::BTreeMap;

use crate::ServerError;

/// Contract identifier and digest pair used for bootstrap checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapContractRef {
    pub id: String,
    pub digest: String,
}

/// Resolved active binding for one service session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapBinding {
    pub contract_id: String,
    pub digest: String,
}

/// Typed service resource bindings resolved from Trellis core bootstrap data.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServiceResourceBindings {
    /// KV/state resources keyed by contract-local resource name.
    pub kv: BTreeMap<String, KvResourceBinding>,
    /// Object-store resources keyed by contract-local resource name.
    pub store: BTreeMap<String, StoreResourceBinding>,
    /// Service-private jobs resource, when declared by the contract.
    pub jobs: Option<JobsResourceBinding>,
}

/// Bound KV/state bucket resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KvResourceBinding {
    /// Concrete KV bucket name provisioned for this service binding.
    pub bucket: String,
    /// Number of historical values retained by the bucket.
    pub history: i64,
    /// Maximum encoded value size in bytes, when configured.
    pub max_value_bytes: Option<i64>,
    /// Bucket TTL in milliseconds.
    pub ttl_ms: i64,
}

/// Bound object-store resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreResourceBinding {
    /// Concrete object-store bucket name provisioned for this service binding.
    pub name: String,
    /// Maximum object size in bytes, when configured.
    pub max_object_bytes: Option<i64>,
    /// Maximum total store size in bytes, when configured.
    pub max_total_bytes: Option<i64>,
    /// Store TTL in milliseconds.
    pub ttl_ms: i64,
}

/// Bound service-private jobs resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobsResourceBinding {
    /// Service-local jobs namespace used in job subjects and stream names.
    pub namespace: String,
    /// Work stream used by private job workers, when provisioned.
    pub work_stream: Option<String>,
    /// Job queues keyed by contract-local queue type.
    pub queues: BTreeMap<String, JobsQueueResourceBinding>,
}

/// Bound service-private jobs queue resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobsQueueResourceBinding {
    /// Logical queue type from the contract binding.
    pub queue_type: String,
    /// Publish prefix for job lifecycle events.
    pub publish_prefix: String,
    /// NATS subject consumed by workers for this queue.
    pub work_subject: String,
    /// Durable consumer name for this queue.
    pub consumer_name: String,
    /// JSON schema reference for queued job payloads.
    pub payload: JobsSchemaRef,
    /// Optional JSON schema reference for successful job results.
    pub result: Option<JobsSchemaRef>,
    /// Maximum delivery attempts before dead-letter handling.
    pub max_deliver: i64,
    /// Redelivery backoff schedule in milliseconds.
    pub backoff_ms: Vec<i64>,
    /// Ack wait in milliseconds for the durable consumer.
    pub ack_wait_ms: i64,
    /// Optional business deadline applied to newly created jobs.
    pub default_deadline_ms: Option<i64>,
    /// Whether progress events are enabled for this queue.
    pub progress: bool,
    /// Whether log events are enabled for this queue.
    pub logs: bool,
    /// Whether dead-letter handling is enabled for this queue.
    pub dlq: bool,
    /// Suggested worker concurrency for this queue.
    pub concurrency: i64,
}

/// Schema reference attached to a jobs queue binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobsSchemaRef {
    pub schema: String,
}

/// Validate that the expected contract is active and bindings match it.
pub fn validate_bootstrap_contract_state(
    service_name: &str,
    expected: &BootstrapContractRef,
    catalog_contracts: &[BootstrapContractRef],
    binding: Option<&BootstrapBinding>,
) -> Result<BootstrapBinding, ServerError> {
    let is_active = catalog_contracts
        .iter()
        .any(|contract| contract.id == expected.id && contract.digest == expected.digest);

    if !is_active {
        return Err(ServerError::BootstrapInactiveContract {
            service_name: service_name.to_string(),
            contract_id: expected.id.clone(),
            contract_digest: expected.digest.clone(),
        });
    }

    let binding = binding.ok_or_else(|| ServerError::BootstrapMissingBinding {
        service_name: service_name.to_string(),
        contract_id: expected.id.clone(),
        contract_digest: expected.digest.clone(),
    })?;

    if binding.contract_id != expected.id || binding.digest != expected.digest {
        return Err(ServerError::BootstrapBindingMismatch {
            service_name: service_name.to_string(),
            expected_contract_id: expected.id.clone(),
            expected_contract_digest: expected.digest.clone(),
            actual_contract_id: binding.contract_id.clone(),
            actual_contract_digest: binding.digest.clone(),
        });
    }

    Ok(binding.clone())
}
