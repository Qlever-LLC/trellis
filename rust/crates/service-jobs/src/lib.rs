//! Jobs admin service runtime for Trellis.
//!
//! This crate owns the admin-side loops and RPC hosting for the `trellis.jobs@v1`
//! contract: KV-backed queries, stream projection, janitor expiry, and advisory
//! handling. Service-local job execution lives in [`trellis_jobs`].

mod advisory;
mod bootstrap;
#[path = "../contracts/trellis_jobs.rs"]
mod contract;
mod janitor;
mod kv_query;
mod projector;
mod router;
pub mod worker_presence;

pub use advisory::{
    map_dead_event_from_advisory_job, start_advisory_loop, AdvisoryHandle, MappedDeadEvent,
    MaxDeliveriesAdvisory,
};
pub use bootstrap::{
    bootstrap_jobs_service_host_from_client, bootstrap_jobs_service_host_with_clients,
    connect_and_run, connect_service, run_jobs_service_from_client,
    run_jobs_service_from_client_with_mode, run_jobs_service_with_clients,
    run_jobs_service_with_clients_with_mode, ConnectedJobsService, JobsServiceError,
    JobsServiceHost, JobsServiceHostWithValidator, JobsServiceMode,
};
pub use contract::{
    contract_manifest, expected_contract, rpc, CONTRACT_DIGEST, CONTRACT_ID, CONTRACT_JSON,
    JOBS_RPC_SUBJECT_WILDCARD, SERVICE_NAME,
};
pub use janitor::{
    plan_expired_events, run_janitor_once, start_janitor_loop, JanitorError, JanitorHandle,
    JanitorRunStats, PlannedExpiredEvent,
};
pub use kv_query::{
    resolve_jobs_admin_resources, resolve_jobs_kv_buckets, JobsAdminResources, JobsKvBuckets,
    JobsKvQuery, JobsQueryError,
};
pub use router::build_router_with_query;
