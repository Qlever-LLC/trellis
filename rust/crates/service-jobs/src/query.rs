//! SQLite-backed query and mutation helpers for the Jobs admin service.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::Duration;

use time::OffsetDateTime;
use trellis_jobs::types::{Job, JobEvent, JobState};
use trellis_jobs::{
    cancelled_event, dismissed_event, job_event_subject, reduce_job_event, retried_event,
};

use trellis_sdk_jobs::types::{
    JobsCancelRequest, JobsCancelResponse, JobsDismissDLQRequest, JobsDismissDLQResponse,
    JobsGetRequest, JobsGetResponse, JobsListDLQRequest, JobsListDLQResponse,
    JobsListDLQResponseJobsItem, JobsListRequest, JobsListResponse, JobsListResponseJobsItem,
    JobsListServicesResponse, JobsListServicesResponseServicesItem,
    JobsListServicesResponseServicesItemWorkersItem, JobsReplayDLQRequest, JobsReplayDLQResponse,
    JobsRetryRequest, JobsRetryResponse,
};

mod resources;
mod state;
mod wire;
use crate::paths::jobs_db_path_from_env;
use crate::storage::{ListJobsFilter, SqliteJobsStore, SqliteJobsStoreError};
use crate::worker_presence::WORKER_PRESENCE_FRESH_FOR;

pub use resources::{
    jobs_admin_resources_from_binding, resolve_jobs_admin_resources, JobsAdminResources,
};
use state::{now_timestamp_string, parse_state_filter, JobsStateFilter};
use wire::{
    job_to_cancel_item, job_to_dismiss_item, job_to_dlq_item, job_to_get_item, job_to_list_item,
    job_to_replay_item, job_to_retry_item,
};

/// Errors returned while resolving bindings, reading projection state, or publishing admin events.
#[derive(Debug, thiserror::Error)]
pub enum JobsQueryError {
    #[error("failed to fetch Trellis bindings: {0}")]
    BindingsFetch(String),
    #[error("missing binding in Trellis.Bindings.Get response")]
    MissingBinding,
    #[error("duplicate projected jobs found for globally addressable id '{id}'")]
    DuplicateJobId { id: String },
    #[error("job state conflict for key '{key}': expected '{expected}', found '{actual}'")]
    JobStateConflict {
        key: String,
        expected: String,
        actual: String,
    },
    #[error("projected job not found for key '{key}'")]
    JobNotFound { key: String },
    #[error("failed to encode job event for key '{key}': {details}")]
    EncodeEvent { key: String, details: String },
    #[error("failed to publish job event on subject '{subject}': {details}")]
    PublishEvent { subject: String, details: String },
    #[error("timed out waiting for projection of key '{key}'")]
    ProjectionTimeout { key: String },
    #[error("failed to read Jobs SQLite projection: {details}")]
    ProjectionStore { details: String },
    #[error("failed to convert {model} between internal and generated wire shapes: {details}")]
    ConvertWireModel {
        model: &'static str,
        details: String,
    },
}

#[derive(Clone)]
pub struct JobsQuery {
    nats: async_nats::Client,
    store: SqliteJobsStore,
}

impl JobsQuery {
    /// Create a SQLite-backed Jobs query adapter from a NATS client and resolved resources.
    pub fn new(nats: async_nats::Client) -> Self {
        let db_path = jobs_db_path_from_env();
        let store = open_default_store(&db_path);
        Self::with_store(nats, store)
    }

    /// Create a SQLite-backed Jobs query adapter with an already-open store.
    pub fn with_store(nats: async_nats::Client, store: SqliteJobsStore) -> Self {
        Self { nats, store }
    }

    /// List registered service instances grouped by service name.
    pub async fn list_services(&self) -> Result<JobsListServicesResponse, JobsQueryError> {
        let now = OffsetDateTime::now_utc();
        let workers = self
            .store
            .list_fresh_workers(now, WORKER_PRESENCE_FRESH_FOR)?;

        let mut grouped =
            BTreeMap::<String, Vec<JobsListServicesResponseServicesItemWorkersItem>>::new();
        for worker in workers {
            let service_name = worker.service.clone();
            grouped
                .entry(service_name)
                .or_default()
                .push(wire::worker_presence_to_wire(&worker));
        }

        let mut services = Vec::new();
        for (name, mut workers) in grouped {
            workers.sort_by(|left, right| {
                left.job_type
                    .cmp(&right.job_type)
                    .then_with(|| left.instance_id.cmp(&right.instance_id))
            });
            services.push(JobsListServicesResponseServicesItem {
                healthy: !workers.is_empty(),
                name,
                workers,
            });
        }

        Ok(JobsListServicesResponse { services })
    }

    /// List projected jobs using the generated `Jobs.List` wire shape.
    pub async fn list_jobs(
        &self,
        request: &JobsListRequest,
    ) -> Result<JobsListResponse, JobsQueryError> {
        let state_filter = parse_state_filter(request.state.as_ref())?;
        let page = self.store.list_jobs(&ListJobsFilter {
            service: request.service.clone(),
            job_type: request.r#type.clone(),
            states: state_filter_to_vec(state_filter.as_ref()),
            since: request.since.clone(),
            limit: request.limit.and_then(|value| u64::try_from(value).ok()),
            cursor: request.cursor.clone(),
        })?;
        Ok(JobsListResponse {
            has_more: page.has_more,
            jobs: page
                .jobs
                .iter()
                .map(job_to_list_item)
                .collect::<Result<Vec<JobsListResponseJobsItem>, _>>()?,
            next_cursor: page.next_cursor,
        })
    }

    /// Fetch one projected job by globally addressable admin job id.
    pub async fn get_job(
        &self,
        request: &JobsGetRequest,
    ) -> Result<JobsGetResponse, JobsQueryError> {
        let job = self.store.get_job_by_global_id(&request.id)?;

        Ok(JobsGetResponse {
            job: job.as_ref().map(job_to_get_item).transpose()?,
        })
    }

    /// Cancel a projected job by publishing a `cancelled` event.
    pub async fn cancel_job(
        &self,
        request: &JobsCancelRequest,
    ) -> Result<JobsCancelResponse, JobsQueryError> {
        let job = self
            .transition_job(&request.id, "pending|retry|active", |job, now| {
                match job.state {
                    JobState::Pending | JobState::Retry | JobState::Active => {
                        Some(cancelled_event(
                            &job.service,
                            &job.job_type,
                            &job.id,
                            job.state,
                            job.tries,
                            now,
                        ))
                    }
                    _ => None,
                }
            })
            .await?;

        Ok(JobsCancelResponse {
            job: job_to_cancel_item(&job)?,
        })
    }

    /// Retry a failed job by publishing a `retried` event.
    pub async fn retry_job(
        &self,
        request: &JobsRetryRequest,
    ) -> Result<JobsRetryResponse, JobsQueryError> {
        let job = self
            .transition_job(&request.id, "failed", |job, now| match job.state {
                JobState::Failed => Some(retried_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    job.state,
                    now,
                    Some(job.payload.clone()),
                    Some(job.max_tries),
                    job.deadline.as_deref(),
                )),
                _ => None,
            })
            .await?;

        Ok(JobsRetryResponse {
            job: job_to_retry_item(&job)?,
        })
    }

    /// List only jobs currently in the DLQ (`dead`) state.
    pub async fn list_dlq(
        &self,
        request: &JobsListDLQRequest,
    ) -> Result<JobsListDLQResponse, JobsQueryError> {
        let dead_only = JobsStateFilter::Single(JobState::Dead);
        let page = self.store.list_jobs(&ListJobsFilter {
            service: request.service.clone(),
            job_type: request.r#type.clone(),
            states: state_filter_to_vec(Some(&dead_only)),
            since: request.since.clone(),
            limit: request.limit.and_then(|value| u64::try_from(value).ok()),
            cursor: request.cursor.clone(),
        })?;
        Ok(JobsListDLQResponse {
            has_more: page.has_more,
            jobs: page
                .jobs
                .iter()
                .map(job_to_dlq_item)
                .collect::<Result<Vec<JobsListDLQResponseJobsItem>, _>>()?,
            next_cursor: page.next_cursor,
        })
    }

    /// Replay a dead-lettered job by publishing a `retried` event.
    pub async fn replay_dlq(
        &self,
        request: &JobsReplayDLQRequest,
    ) -> Result<JobsReplayDLQResponse, JobsQueryError> {
        let job = self
            .transition_job(&request.id, "dead", |job, now| match job.state {
                JobState::Dead => Some(retried_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    job.state,
                    now,
                    Some(job.payload.clone()),
                    Some(job.max_tries),
                    job.deadline.as_deref(),
                )),
                _ => None,
            })
            .await?;

        Ok(JobsReplayDLQResponse {
            job: job_to_replay_item(&job)?,
        })
    }

    /// Dismiss a dead-lettered job by publishing a `dismissed` event.
    pub async fn dismiss_dlq(
        &self,
        request: &JobsDismissDLQRequest,
    ) -> Result<JobsDismissDLQResponse, JobsQueryError> {
        let job = self
            .transition_job(&request.id, "dead", |job, now| match job.state {
                JobState::Dead => Some(dismissed_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    JobState::Dead,
                    job.tries,
                    now,
                    job.last_error.as_deref(),
                )),
                _ => None,
            })
            .await?;

        Ok(JobsDismissDLQResponse {
            job: job_to_dismiss_item(&job)?,
        })
    }

    async fn transition_job<F>(
        &self,
        id: &str,
        expected_states: &str,
        build_event: F,
    ) -> Result<Job, JobsQueryError>
    where
        F: FnOnce(&Job, &str) -> Option<JobEvent>,
    {
        let job =
            self.store
                .get_job_by_global_id(id)?
                .ok_or_else(|| JobsQueryError::JobNotFound {
                    key: id.to_string(),
                })?;
        let key = projection_key(&job);

        let now = now_timestamp_string();
        let event = build_event(&job, &now).ok_or_else(|| JobsQueryError::JobStateConflict {
            key: key.clone(),
            expected: expected_states.to_string(),
            actual: format!("{:?}", job.state).to_lowercase(),
        })?;
        let subject = job_event_subject(&job.service, &job.job_type, &job.id, event.event_type);
        let payload = serde_json::to_vec(&event).map_err(|error| JobsQueryError::EncodeEvent {
            key: key.clone(),
            details: error.to_string(),
        })?;

        self.nats
            .publish(subject.clone(), payload.into())
            .await
            .map_err(|error| JobsQueryError::PublishEvent {
                subject,
                details: error.to_string(),
            })?;

        let predicted = reduce_job_event(Some(&job), &event).ok_or_else(|| {
            JobsQueryError::JobStateConflict {
                key: key.clone(),
                expected: expected_states.to_string(),
                actual: format!("{:?}", job.state).to_lowercase(),
            }
        })?;
        let projected = self.await_job_projection(&key, &predicted).await?;

        Ok(projected)
    }

    async fn await_job_projection(&self, key: &str, expected: &Job) -> Result<Job, JobsQueryError> {
        for _ in 0..20 {
            if let Some(job) =
                self.store
                    .get_job(&expected.service, &expected.job_type, &expected.id)?
            {
                if job.state == expected.state && job.updated_at == expected.updated_at {
                    return Ok(job);
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }

        Err(JobsQueryError::ProjectionTimeout {
            key: key.to_string(),
        })
    }
}

impl From<SqliteJobsStoreError> for JobsQueryError {
    fn from(error: SqliteJobsStoreError) -> Self {
        match error {
            SqliteJobsStoreError::DuplicateJobId { id } => Self::DuplicateJobId { id },
            other => Self::ProjectionStore {
                details: other.to_string(),
            },
        }
    }
}

fn state_filter_to_vec(filter: Option<&JobsStateFilter>) -> Option<Vec<JobState>> {
    match filter {
        None => None,
        Some(JobsStateFilter::Single(state)) => Some(vec![*state]),
        Some(JobsStateFilter::Many(states)) => Some(states.clone()),
    }
}

fn projection_key(job: &Job) -> String {
    format!("{}/{}/{}", job.service, job.job_type, job.id)
}

fn open_default_store(path: &Path) -> SqliteJobsStore {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).unwrap_or_else(|error| {
            panic!(
                "failed to create Jobs SQLite projection directory '{}': {error}",
                parent.display()
            )
        });
    }
    SqliteJobsStore::open(path).unwrap_or_else(|error| {
        panic!(
            "failed to open Jobs SQLite projection at '{}': {error}",
            path.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use futures_util::future::{ready, BoxFuture, FutureExt};
    use trellis_client::{RpcErrorPayload, TrellisClientError};
    use trellis_core_bootstrap::CoreBootstrapClientPort;
    use trellis_sdk_core::types::{
        TrellisBindingsGetRequest, TrellisBindingsGetResponse, TrellisBindingsGetResponseBinding,
        TrellisBindingsGetResponseBindingResources, TrellisCatalogResponse,
    };

    use crate::contract::expected_contract;

    use super::{jobs_admin_resources_from_binding, resolve_jobs_admin_resources, JobsQueryError};

    struct FakeCoreClient {
        binding_result: Mutex<Option<Result<TrellisBindingsGetResponse, TrellisClientError>>>,
        seen_requests: Arc<Mutex<Vec<TrellisBindingsGetRequest>>>,
    }

    impl CoreBootstrapClientPort for FakeCoreClient {
        fn trellis_catalog<'a>(
            &'a self,
        ) -> BoxFuture<'a, Result<TrellisCatalogResponse, TrellisClientError>> {
            ready(Err(TrellisClientError::RpcError(
                RpcErrorPayload::from_message("trellis_catalog should not be called"),
            )))
            .boxed()
        }

        fn trellis_bindings_get<'a>(
            &'a self,
            input: &'a TrellisBindingsGetRequest,
        ) -> BoxFuture<'a, Result<TrellisBindingsGetResponse, TrellisClientError>> {
            self.seen_requests
                .lock()
                .expect("lock seen requests")
                .push(input.clone());
            let result = self
                .binding_result
                .lock()
                .expect("lock binding result")
                .take()
                .expect("binding result should be set");
            ready(result).boxed()
        }
    }

    fn core_client_with_binding(
        binding: Option<TrellisBindingsGetResponseBinding>,
    ) -> (FakeCoreClient, Arc<Mutex<Vec<TrellisBindingsGetRequest>>>) {
        let seen_requests = Arc::new(Mutex::new(Vec::new()));
        (
            FakeCoreClient {
                binding_result: Mutex::new(Some(Ok(TrellisBindingsGetResponse { binding }))),
                seen_requests: Arc::clone(&seen_requests),
            },
            seen_requests,
        )
    }

    fn sample_binding_with_resources() -> TrellisBindingsGetResponseBinding {
        let expected = expected_contract();
        TrellisBindingsGetResponseBinding {
            contract_id: expected.id,
            digest: expected.digest,
            resources: TrellisBindingsGetResponseBindingResources {
                jobs: None,
                kv: None,
                store: None,
            },
        }
    }

    #[tokio::test]
    async fn resolve_jobs_admin_resources_reads_expected_binding_and_request_fields() {
        let expected = expected_contract();
        let (core_client, seen_requests) =
            core_client_with_binding(Some(sample_binding_with_resources()));

        let resources = resolve_jobs_admin_resources(&core_client, &expected)
            .await
            .expect("admin resources should resolve");

        assert_eq!(resources.jobs_stream, "JOBS");
        assert_eq!(resources.jobs_advisories_stream, "JOBS_ADVISORIES");

        let seen = seen_requests.lock().expect("lock seen requests");
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].contract_id.as_deref(), Some(expected.id.as_str()));
        assert_eq!(seen[0].digest.as_deref(), Some(expected.digest.as_str()));
    }

    #[tokio::test]
    async fn resolve_jobs_admin_resources_errors_when_binding_missing() {
        let expected = expected_contract();
        let (core_client, _) = core_client_with_binding(None);

        let error = resolve_jobs_admin_resources(&core_client, &expected)
            .await
            .expect_err("missing binding should fail");

        assert!(matches!(error, JobsQueryError::MissingBinding));
    }

    #[tokio::test]
    async fn resolve_jobs_admin_resources_does_not_require_kv_resources() {
        let expected = expected_contract();
        let (core_client, _) = core_client_with_binding(Some(sample_binding_with_resources()));

        let resources = resolve_jobs_admin_resources(&core_client, &expected)
            .await
            .expect("admin resources should not require kv resources");

        assert_eq!(resources.jobs_stream, "JOBS");
        assert_eq!(resources.jobs_advisories_stream, "JOBS_ADVISORIES");
    }

    #[tokio::test]
    async fn resolve_jobs_admin_resources_errors_when_bindings_request_fails() {
        let expected = expected_contract();
        let core_client = FakeCoreClient {
            binding_result: Mutex::new(Some(Err(TrellisClientError::RpcError(
                RpcErrorPayload::from_message("bindings failed"),
            )))),
            seen_requests: Arc::new(Mutex::new(Vec::new())),
        };

        let error = resolve_jobs_admin_resources(&core_client, &expected)
            .await
            .expect_err("bindings fetch failure should fail");

        assert!(matches!(error, JobsQueryError::BindingsFetch(_)));
    }

    #[tokio::test]
    async fn resolve_jobs_admin_resources_uses_builtin_stream_names() {
        let expected = expected_contract();
        let (core_client, _) = core_client_with_binding(Some(sample_binding_with_resources()));

        let resources = resolve_jobs_admin_resources(&core_client, &expected)
            .await
            .expect("admin resources should resolve");

        assert_eq!(resources.jobs_stream, "JOBS");
        assert_eq!(resources.jobs_advisories_stream, "JOBS_ADVISORIES");
    }

    #[test]
    fn jobs_admin_resources_from_binding_uses_builtin_stream_names() {
        let resources = jobs_admin_resources_from_binding(&sample_binding_with_resources())
            .expect("admin resources should not require stream aliases");

        assert_eq!(resources.jobs_stream, "JOBS");
        assert_eq!(resources.jobs_advisories_stream, "JOBS_ADVISORIES");
    }
}
