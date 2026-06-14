//! SQLite-backed query and mutation helpers for the Jobs admin service.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::Duration;

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use trellis_rs::jobs::types::{Job, JobEvent, JobState};
use trellis_rs::jobs::{
    cancelled_event, dismissed_event, job_event_subject, reduce_job_event, retried_event,
};

use trellis_rs::sdk::jobs::types::{
    JobsCancelRequest, JobsCancelResponse, JobsDismissDLQRequest, JobsDismissDLQResponse,
    JobsGetKeyRequest, JobsGetKeyResponse, JobsGetKeyResponseActiveItem,
    JobsGetKeyResponseQueuedItem, JobsGetRequest, JobsGetResponse, JobsListDLQRequest,
    JobsListDLQResponse, JobsListDLQResponseEntriesItem, JobsListRequest, JobsListResponse,
    JobsListResponseEntriesItem, JobsListServicesRequest, JobsListServicesResponse,
    JobsListServicesResponseEntriesItem, JobsListServicesResponseEntriesItemWorkersItem,
    JobsReplayDLQRequest, JobsReplayDLQResponse, JobsRetryRequest, JobsRetryResponse,
};

mod resources;
mod state;
mod wire;
use crate::paths::jobs_db_path_from_env;
use crate::storage::{
    JobProjectionMetadata, ListJobsFilter, SqliteJobsStore, SqliteJobsStoreError,
};
use crate::worker_presence::WORKER_PRESENCE_FRESH_FOR;

pub use resources::{
    jobs_admin_resources_from_binding, resolve_jobs_admin_resources, JobsAdminResources,
};
use state::{now_timestamp_string, parse_state_filter};
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
    #[error("invalid {field}: {details}")]
    Validation {
        field: &'static str,
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
    pub async fn list_services(
        &self,
        request: &JobsListServicesRequest,
    ) -> Result<JobsListServicesResponse, JobsQueryError> {
        let (offset, limit) = parse_page_request(request.offset, request.limit)?;
        let now = OffsetDateTime::now_utc();
        let workers = self
            .store
            .list_fresh_workers(now, WORKER_PRESENCE_FRESH_FOR)?;

        let mut grouped =
            BTreeMap::<String, Vec<JobsListServicesResponseEntriesItemWorkersItem>>::new();
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
            services.push(JobsListServicesResponseEntriesItem {
                healthy: !workers.is_empty(),
                name,
                workers,
            });
        }
        let count = u64::try_from(services.len()).unwrap_or(u64::MAX);
        let services = services
            .into_iter()
            .skip(usize::try_from(offset).unwrap_or(usize::MAX))
            .take(usize::try_from(limit).unwrap_or(usize::MAX))
            .collect();
        let next_offset = offset.checked_add(limit).filter(|next| *next < count);

        Ok(JobsListServicesResponse {
            count: to_wire_integer(count),
            entries: services,
            limit: to_wire_integer(limit),
            next_offset: next_offset.map(to_wire_integer),
            offset: to_wire_integer(offset),
        })
    }

    /// List projected jobs using the generated `Jobs.List` wire shape.
    pub async fn list_jobs(
        &self,
        request: &JobsListRequest,
    ) -> Result<JobsListResponse, JobsQueryError> {
        let state_filter = parse_state_filter(request.state.as_ref())?;
        let (offset, limit) = parse_page_request(request.offset, request.limit)?;
        let since = parse_since_filter(request.since.as_deref())?;
        let page = self.store.list_jobs(&ListJobsFilter {
            service: request.service.clone(),
            job_type: request.r#type.clone(),
            states: state_filter,
            since,
            offset: Some(offset),
            limit,
        })?;
        Ok(JobsListResponse {
            count: to_wire_integer(page.count),
            entries: page
                .jobs
                .iter()
                .map(|job| {
                    let metadata = self.job_metadata(job)?;
                    job_to_list_item(job, &metadata)
                })
                .collect::<Result<Vec<JobsListResponseEntriesItem>, _>>()?,
            limit: to_wire_integer(page.limit),
            next_offset: page.next_offset.map(to_wire_integer),
            offset: to_wire_integer(page.offset),
        })
    }

    /// Fetch one projected job by globally addressable admin job id.
    pub async fn get_job(
        &self,
        request: &JobsGetRequest,
    ) -> Result<JobsGetResponse, JobsQueryError> {
        let job = self
            .store
            .get_job_by_global_id(&request.id)?
            .ok_or_else(|| JobsQueryError::JobNotFound {
                key: request.id.clone(),
            })?;

        Ok(JobsGetResponse {
            job: job_to_get_item(&job, &self.job_metadata(&job)?)?,
        })
    }

    /// Fetch projection-backed keyed-concurrency state by service, job type, and display key.
    ///
    /// This path currently reads SQLite projection state only. The Jobs admin binding does not yet
    /// expose a `JOBS_KEYS` KV handle here, so very recent runtime coordinator updates may be newer
    /// than this response until lifecycle events are projected.
    pub async fn get_key(
        &self,
        request: &JobsGetKeyRequest,
    ) -> Result<JobsGetKeyResponse, JobsQueryError> {
        let key = self
            .store
            .get_projected_key(&request.service, &request.r#type, &request.key)?
            .ok_or_else(|| JobsQueryError::JobNotFound {
                key: format!("{}/{}/{}", request.service, request.r#type, request.key),
            })?;
        let now = OffsetDateTime::now_utc();

        Ok(JobsGetKeyResponse {
            active: key
                .active
                .iter()
                .filter_map(|active| {
                    let started_at = active.started_at.clone()?;
                    let heartbeat_at = active.heartbeat_at.clone()?;
                    let lease_expires_at = active.lease_expires_at.clone()?;
                    Some(JobsGetKeyResponseActiveItem {
                        heartbeat_age_ms: heartbeat_age_ms(&heartbeat_at, now),
                        heartbeat_at,
                        instance_id: active.instance_id.clone().unwrap_or_default(),
                        job_id: active.job_id.clone(),
                        lease_expires_at,
                        started_at,
                    })
                })
                .collect(),
            key: key.key,
            key_hash: key.key_hash,
            latest_policy_reason: key.latest_policy_reason,
            queued_depth: to_wire_integer(u64::try_from(key.queued.len()).unwrap_or(u64::MAX)),
            queued: key
                .queued
                .iter()
                .map(|queued| JobsGetKeyResponseQueuedItem {
                    created_at: queued.created_at.clone(),
                    job_id: queued.job_id.clone(),
                })
                .collect(),
            service: key.service,
            stale_takeover_count: to_wire_integer(key.stale_takeover_count),
            r#type: key.job_type,
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
                            &job.context,
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
            job: job_to_cancel_item(&job, &self.job_metadata(&job)?)?,
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
                    &job.context,
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
            job: job_to_retry_item(&job, &self.job_metadata(&job)?)?,
        })
    }

    /// List only jobs currently in the DLQ (`dead`) state.
    pub async fn list_dlq(
        &self,
        request: &JobsListDLQRequest,
    ) -> Result<JobsListDLQResponse, JobsQueryError> {
        let (offset, limit) = parse_page_request(request.offset, request.limit)?;
        let since = parse_since_filter(request.since.as_deref())?;
        let page = self.store.list_jobs(&ListJobsFilter {
            service: request.service.clone(),
            job_type: request.r#type.clone(),
            states: Some(vec![JobState::Dead]),
            since,
            offset: Some(offset),
            limit,
        })?;
        Ok(JobsListDLQResponse {
            count: to_wire_integer(page.count),
            entries: page
                .jobs
                .iter()
                .map(|job| {
                    let metadata = self.job_metadata(job)?;
                    job_to_dlq_item(job, &metadata)
                })
                .collect::<Result<Vec<JobsListDLQResponseEntriesItem>, _>>()?,
            limit: to_wire_integer(page.limit),
            next_offset: page.next_offset.map(to_wire_integer),
            offset: to_wire_integer(page.offset),
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
                    &job.context,
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
            job: job_to_replay_item(&job, &self.job_metadata(&job)?)?,
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
                    &job.context,
                    JobState::Dead,
                    job.tries,
                    now,
                    job.last_error.as_deref(),
                )),
                _ => None,
            })
            .await?;

        Ok(JobsDismissDLQResponse {
            job: job_to_dismiss_item(&job, &self.job_metadata(&job)?)?,
        })
    }

    fn job_metadata(&self, job: &Job) -> Result<JobProjectionMetadata, JobsQueryError> {
        Ok(self
            .store
            .get_job_metadata(&job.service, &job.job_type, &job.id)?
            .unwrap_or_default())
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
            .publish_with_headers(subject.clone(), job_event_headers(&event), payload.into())
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

fn job_event_headers(event: &JobEvent) -> async_nats::header::HeaderMap {
    let mut headers = async_nats::header::HeaderMap::new();
    headers.insert("request-id", event.context.request_id.as_str());
    headers.insert("traceparent", event.context.traceparent.as_str());
    if let Some(tracestate) = event.context.tracestate.as_deref() {
        headers.insert("tracestate", tracestate);
    }
    headers
}

impl From<SqliteJobsStoreError> for JobsQueryError {
    fn from(error: SqliteJobsStoreError) -> Self {
        match error {
            other => Self::ProjectionStore {
                details: other.to_string(),
            },
        }
    }
}

fn parse_page_request(offset: Option<i64>, limit: i64) -> Result<(u64, u64), JobsQueryError> {
    let offset = match offset {
        Some(offset) => parse_non_negative_integer("offset", offset)?,
        None => 0,
    };
    let limit = parse_positive_integer("limit", limit)?;
    Ok((offset, limit))
}

fn parse_since_filter(value: Option<&str>) -> Result<Option<OffsetDateTime>, JobsQueryError> {
    value
        .map(|since| {
            OffsetDateTime::parse(since, &Rfc3339).map_err(|error| JobsQueryError::Validation {
                field: "since",
                details: error.to_string(),
            })
        })
        .transpose()
}

fn heartbeat_age_ms(heartbeat_at: &str, now: OffsetDateTime) -> i64 {
    let Some(heartbeat_at) = OffsetDateTime::parse(heartbeat_at, &Rfc3339).ok() else {
        return 0;
    };
    let age = (now - heartbeat_at).whole_milliseconds();
    if age < 0 {
        0
    } else {
        i64::try_from(age).unwrap_or(i64::MAX)
    }
}

fn parse_positive_integer(field: &'static str, value: i64) -> Result<u64, JobsQueryError> {
    if value < 1 {
        return Err(JobsQueryError::ConvertWireModel {
            model: field,
            details: "must be at least 1".to_string(),
        });
    }
    u64::try_from(value).map_err(|error| JobsQueryError::ConvertWireModel {
        model: field,
        details: error.to_string(),
    })
}

fn parse_non_negative_integer(field: &'static str, value: i64) -> Result<u64, JobsQueryError> {
    if value < 0 {
        return Err(JobsQueryError::ConvertWireModel {
            model: field,
            details: "must be non-negative".to_string(),
        });
    }
    u64::try_from(value).map_err(|error| JobsQueryError::ConvertWireModel {
        model: field,
        details: error.to_string(),
    })
}

fn to_wire_integer(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
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
    use trellis_rs::client::{RpcErrorPayload, TrellisClientError};
    use trellis_rs::sdk::core::types::{
        TrellisBindingsGetRequest, TrellisBindingsGetResponse, TrellisBindingsGetResponseBinding,
        TrellisBindingsGetResponseBindingResources, TrellisCatalogResponse,
    };
    use trellis_rs::service::CoreBootstrapClientPort;

    use crate::contract::expected_contract;

    use super::{
        jobs_admin_resources_from_binding, parse_since_filter, resolve_jobs_admin_resources,
        JobsQueryError,
    };

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
                binding_result: Mutex::new(Some(Ok(TrellisBindingsGetResponse {
                    binding,
                    event_consumers: None,
                }))),
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
                event_consumers: None,
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

    #[test]
    fn parse_since_filter_accepts_rfc3339_offset_timestamps() {
        let parsed = parse_since_filter(Some("2025-12-31T19:00:30-05:00"))
            .expect("offset timestamp should parse")
            .expect("since should be present");

        assert_eq!(parsed.unix_timestamp(), 1_767_225_630);
    }

    #[test]
    fn parse_since_filter_rejects_invalid_timestamps_as_validation_errors() {
        let error =
            parse_since_filter(Some("not-a-timestamp")).expect_err("invalid timestamp should fail");

        assert!(matches!(
            error,
            JobsQueryError::Validation { field: "since", .. }
        ));
    }
}
