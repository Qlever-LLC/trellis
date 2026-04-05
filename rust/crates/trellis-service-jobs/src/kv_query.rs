//! KV-backed query and mutation helpers for the Jobs admin service.

use std::collections::BTreeMap;
use std::time::Duration;

use async_nats::jetstream;
use futures_util::TryStreamExt;
use time::OffsetDateTime;
use trellis_jobs::types::{Job, JobEvent, JobState};
use trellis_jobs::{
    cancelled_event, dismissed_event, job_event_subject, job_key, reduce_job_event, retried_event,
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
use crate::worker_presence::{
    ensure_worker_presence_bucket, worker_presence_is_fresh, WorkerPresenceRecord,
};

pub use resources::{
    jobs_admin_resources_from_binding, resolve_jobs_admin_resources, resolve_jobs_kv_buckets,
    JobsAdminResources,
};
use state::{filter_jobs, now_timestamp_string, parse_state_filter, JobsStateFilter};
use wire::{
    job_to_cancel_item, job_to_dismiss_item, job_to_dlq_item, job_to_get_item, job_to_list_item,
    job_to_replay_item, job_to_retry_item,
};

const JOBS_STATE_ALIAS: &str = "jobsState";

/// Resolved KV buckets used by the Jobs admin service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobsKvBuckets {
    pub jobs_state_bucket: String,
    pub worker_presence_bucket: String,
    pub worker_presence_replicas: usize,
}

/// Errors returned while resolving bindings, reading KV state, or publishing admin events.
#[derive(Debug, thiserror::Error)]
pub enum JobsQueryError {
    #[error("failed to fetch Trellis bindings: {0}")]
    BindingsFetch(String),
    #[error("missing binding in Trellis.Bindings.Get response")]
    MissingBinding,
    #[error("missing resources.kv map in binding")]
    MissingKvResources,
    #[error("missing resources.streams map in binding")]
    MissingStreamResources,
    #[error("missing required kv alias '{0}' in binding")]
    MissingKvAlias(String),
    #[error("missing required stream alias '{0}' in binding")]
    MissingStreamAlias(String),
    #[error("invalid kv alias '{0}': expected object with non-empty 'bucket'")]
    InvalidKvAliasShape(String),
    #[error("failed to open kv bucket '{bucket}': {details}")]
    OpenKvBucket { bucket: String, details: String },
    #[error("failed to list keys in bucket '{bucket}': {details}")]
    ListKeys { bucket: String, details: String },
    #[error("failed to read key '{key}' from bucket '{bucket}': {details}")]
    ReadKey {
        bucket: String,
        key: String,
        details: String,
    },
    #[error("failed to decode json from key '{key}' in bucket '{bucket}': {details}")]
    DecodeJson {
        bucket: String,
        key: String,
        details: String,
    },
    #[error("failed to encode job event for key '{key}' in bucket '{bucket}': {details}")]
    EncodeEvent {
        bucket: String,
        key: String,
        details: String,
    },
    #[error("job not found for key '{key}' in bucket '{bucket}'")]
    JobNotFound { bucket: String, key: String },
    #[error("job state conflict for key '{key}': expected '{expected}', found '{actual}'")]
    JobStateConflict {
        key: String,
        expected: String,
        actual: String,
    },
    #[error("failed to publish job event on subject '{subject}': {details}")]
    PublishEvent { subject: String, details: String },
    #[error("timed out waiting for projection of key '{key}' in bucket '{bucket}'")]
    ProjectionTimeout { bucket: String, key: String },
    #[error("failed to convert {model} between internal and generated wire shapes: {details}")]
    ConvertWireModel {
        model: &'static str,
        details: String,
    },
}

#[derive(Clone)]
pub struct JobsKvQuery {
    nats: async_nats::Client,
    jetstream: jetstream::Context,
    buckets: JobsKvBuckets,
}

impl JobsKvQuery {
    /// Create a KV-backed Jobs query adapter from a NATS client and resolved buckets.
    pub fn new(nats: async_nats::Client, buckets: JobsKvBuckets) -> Self {
        Self {
            jetstream: jetstream::new(nats.clone()),
            nats,
            buckets,
        }
    }

    /// List registered service instances grouped by service name.
    pub async fn list_services(&self) -> Result<JobsListServicesResponse, JobsQueryError> {
        ensure_worker_presence_bucket(
            &self.jetstream,
            &self.buckets.worker_presence_bucket,
            self.buckets.worker_presence_replicas,
        )
        .await
        .map_err(|error| JobsQueryError::OpenKvBucket {
            bucket: self.buckets.worker_presence_bucket.clone(),
            details: error.to_string(),
        })?;
        let now = OffsetDateTime::now_utc();
        let workers = self
            .scan_bucket::<WorkerPresenceRecord>(&self.buckets.worker_presence_bucket)
            .await?;

        let mut grouped =
            BTreeMap::<String, Vec<JobsListServicesResponseServicesItemWorkersItem>>::new();
        for worker in workers {
            if !worker_presence_is_fresh(&worker, now) {
                continue;
            }
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
        Ok(JobsListResponse {
            jobs: filter_jobs(
                self.scan_bucket::<Job>(&self.buckets.jobs_state_bucket)
                    .await?,
                request.service.as_deref(),
                request.r#type.as_deref(),
                state_filter.as_ref(),
                request.since.as_deref(),
                request.limit.and_then(|value| u64::try_from(value).ok()),
            )
            .iter()
            .map(job_to_list_item)
            .collect::<Result<Vec<JobsListResponseJobsItem>, _>>()?,
        })
    }

    /// Fetch one projected job by service, type, and id.
    pub async fn get_job(
        &self,
        request: &JobsGetRequest,
    ) -> Result<JobsGetResponse, JobsQueryError> {
        let key = job_key(&request.service, &request.job_type, &request.id);
        let kv = self
            .jetstream
            .get_key_value(&self.buckets.jobs_state_bucket)
            .await
            .map_err(|error| JobsQueryError::OpenKvBucket {
                bucket: self.buckets.jobs_state_bucket.clone(),
                details: error.to_string(),
            })?;

        let payload = kv
            .get(&key)
            .await
            .map_err(|error| JobsQueryError::ReadKey {
                bucket: self.buckets.jobs_state_bucket.clone(),
                key: key.clone(),
                details: error.to_string(),
            })?;

        let job = match payload {
            Some(bytes) => Some(serde_json::from_slice::<Job>(&bytes).map_err(|error| {
                JobsQueryError::DecodeJson {
                    bucket: self.buckets.jobs_state_bucket.clone(),
                    key,
                    details: error.to_string(),
                }
            })?),
            None => None,
        };

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
            .transition_job(
                &request.service,
                &request.job_type,
                &request.id,
                "pending|retry|active",
                |job, now| match job.state {
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
                },
            )
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
            .transition_job(
                &request.service,
                &request.job_type,
                &request.id,
                "failed",
                |job, now| match job.state {
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
                },
            )
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
        Ok(JobsListDLQResponse {
            jobs: filter_jobs(
                self.scan_bucket::<Job>(&self.buckets.jobs_state_bucket)
                    .await?,
                request.service.as_deref(),
                request.r#type.as_deref(),
                Some(&dead_only),
                request.since.as_deref(),
                request.limit.and_then(|value| u64::try_from(value).ok()),
            )
            .iter()
            .map(job_to_dlq_item)
            .collect::<Result<Vec<JobsListDLQResponseJobsItem>, _>>()?,
        })
    }

    /// Replay a dead-lettered job by publishing a `retried` event.
    pub async fn replay_dlq(
        &self,
        request: &JobsReplayDLQRequest,
    ) -> Result<JobsReplayDLQResponse, JobsQueryError> {
        let job = self
            .transition_job(
                &request.service,
                &request.job_type,
                &request.id,
                "dead",
                |job, now| match job.state {
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
                },
            )
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
            .transition_job(
                &request.service,
                &request.job_type,
                &request.id,
                "dead",
                |job, now| match job.state {
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
                },
            )
            .await?;

        Ok(JobsDismissDLQResponse {
            job: job_to_dismiss_item(&job)?,
        })
    }

    async fn scan_bucket<T>(&self, bucket: &str) -> Result<Vec<T>, JobsQueryError>
    where
        T: serde::de::DeserializeOwned,
    {
        let kv = self
            .jetstream
            .get_key_value(bucket)
            .await
            .map_err(|error| JobsQueryError::OpenKvBucket {
                bucket: bucket.to_string(),
                details: error.to_string(),
            })?;

        let mut keys = kv.keys().await.map_err(|error| JobsQueryError::ListKeys {
            bucket: bucket.to_string(),
            details: error.to_string(),
        })?;

        let mut values = Vec::new();
        while let Some(key) = keys
            .try_next()
            .await
            .map_err(|error| JobsQueryError::ListKeys {
                bucket: bucket.to_string(),
                details: error.to_string(),
            })?
        {
            let payload = kv
                .get(&key)
                .await
                .map_err(|error| JobsQueryError::ReadKey {
                    bucket: bucket.to_string(),
                    key: key.clone(),
                    details: error.to_string(),
                })?;

            let Some(payload) = payload else {
                continue;
            };

            let value = serde_json::from_slice::<T>(&payload).map_err(|error| {
                JobsQueryError::DecodeJson {
                    bucket: bucket.to_string(),
                    key: key.clone(),
                    details: error.to_string(),
                }
            })?;
            values.push(value);
        }

        Ok(values)
    }

    async fn transition_job<F>(
        &self,
        service: &str,
        job_type: &str,
        id: &str,
        expected_states: &str,
        build_event: F,
    ) -> Result<Job, JobsQueryError>
    where
        F: FnOnce(&Job, &str) -> Option<JobEvent>,
    {
        let key = job_key(service, job_type, id);
        let kv = self
            .jetstream
            .get_key_value(&self.buckets.jobs_state_bucket)
            .await
            .map_err(|error| JobsQueryError::OpenKvBucket {
                bucket: self.buckets.jobs_state_bucket.clone(),
                details: error.to_string(),
            })?;

        let job = self
            .read_job(&kv, &self.buckets.jobs_state_bucket, &key)
            .await?
            .ok_or_else(|| JobsQueryError::JobNotFound {
                bucket: self.buckets.jobs_state_bucket.clone(),
                key: key.clone(),
            })?;

        let now = now_timestamp_string();
        let event = build_event(&job, &now).ok_or_else(|| JobsQueryError::JobStateConflict {
            key: key.clone(),
            expected: expected_states.to_string(),
            actual: format!("{:?}", job.state).to_lowercase(),
        })?;
        let subject = job_event_subject(&job.service, &job.job_type, &job.id, event.event_type);
        let payload = serde_json::to_vec(&event).map_err(|error| JobsQueryError::EncodeEvent {
            bucket: self.buckets.jobs_state_bucket.clone(),
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
        let projected = self
            .await_job_projection(&kv, &self.buckets.jobs_state_bucket, &key, &predicted)
            .await?;

        Ok(projected)
    }

    async fn await_job_projection(
        &self,
        kv: &jetstream::kv::Store,
        bucket: &str,
        key: &str,
        expected: &Job,
    ) -> Result<Job, JobsQueryError> {
        for _ in 0..20 {
            if let Some(job) = self.read_job(kv, bucket, key).await? {
                if job.state == expected.state && job.updated_at == expected.updated_at {
                    return Ok(job);
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }

        Err(JobsQueryError::ProjectionTimeout {
            bucket: bucket.to_string(),
            key: key.to_string(),
        })
    }

    async fn read_job(
        &self,
        kv: &jetstream::kv::Store,
        bucket: &str,
        key: &str,
    ) -> Result<Option<Job>, JobsQueryError> {
        let payload = kv.get(key).await.map_err(|error| JobsQueryError::ReadKey {
            bucket: bucket.to_string(),
            key: key.to_string(),
            details: error.to_string(),
        })?;

        let job = match payload {
            Some(bytes) => Some(serde_json::from_slice::<Job>(&bytes).map_err(|error| {
                JobsQueryError::DecodeJson {
                    bucket: bucket.to_string(),
                    key: key.to_string(),
                    details: error.to_string(),
                }
            })?),
            None => None,
        };

        Ok(job)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::{Arc, Mutex};

    use futures_util::future::{ready, BoxFuture, FutureExt};
    use trellis_client::TrellisClientError;
    use trellis_core_bootstrap::CoreBootstrapClientPort;
    use trellis_sdk_core::types::{
        TrellisBindingsGetRequest, TrellisBindingsGetResponse, TrellisBindingsGetResponseBinding,
        TrellisBindingsGetResponseBindingResources,
        TrellisBindingsGetResponseBindingResourcesKvValue,
        TrellisBindingsGetResponseBindingResourcesStreamsValue, TrellisCatalogResponse,
    };

    use crate::contract::expected_contract;

    use super::{
        jobs_admin_resources_from_binding, resolve_jobs_admin_resources, resolve_jobs_kv_buckets,
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
                "trellis_catalog should not be called".to_string(),
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

    fn sample_binding_with_resources(
        kv: Option<BTreeMap<String, TrellisBindingsGetResponseBindingResourcesKvValue>>,
        streams: Option<BTreeMap<String, TrellisBindingsGetResponseBindingResourcesStreamsValue>>,
    ) -> TrellisBindingsGetResponseBinding {
        let expected = expected_contract();
        TrellisBindingsGetResponseBinding {
            contract_id: expected.id,
            digest: expected.digest,
            resources: TrellisBindingsGetResponseBindingResources {
                jobs: None,
                kv,
                streams,
            },
        }
    }

    fn sample_streams() -> BTreeMap<String, TrellisBindingsGetResponseBindingResourcesStreamsValue>
    {
        BTreeMap::from([
            (
                "jobs".to_string(),
                TrellisBindingsGetResponseBindingResourcesStreamsValue {
                    discard: None,
                    max_age_ms: None,
                    max_bytes: None,
                    max_msgs: None,
                    name: "JOBS".to_string(),
                    num_replicas: Some(3),
                    retention: Some("limits".to_string()),
                    sources: None,
                    storage: Some("file".to_string()),
                    subjects: vec!["trellis.jobs.>".to_string()],
                },
            ),
            (
                "jobsAdvisories".to_string(),
                TrellisBindingsGetResponseBindingResourcesStreamsValue {
                    discard: None,
                    max_age_ms: None,
                    max_bytes: None,
                    max_msgs: None,
                    name: "JOBS_ADVISORIES".to_string(),
                    num_replicas: Some(1),
                    retention: Some("limits".to_string()),
                    sources: None,
                    storage: Some("file".to_string()),
                    subjects: vec![
                        "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>".to_string()
                    ],
                },
            ),
        ])
    }

    #[tokio::test]
    async fn resolve_jobs_kv_buckets_reads_expected_aliases_and_request_fields() {
        let expected = expected_contract();
        let (core_client, seen_requests) =
            core_client_with_binding(Some(sample_binding_with_resources(
                Some(BTreeMap::from([(
                    "jobsState".to_string(),
                    TrellisBindingsGetResponseBindingResourcesKvValue {
                        bucket: "jobs_state_bucket".to_string(),
                        history: 1,
                        max_value_bytes: None,
                        ttl_ms: 0,
                    },
                )])),
                Some(sample_streams()),
            )));

        let buckets = resolve_jobs_kv_buckets(&core_client, &expected)
            .await
            .expect("bucket resolution should succeed");

        assert_eq!(buckets.jobs_state_bucket, "jobs_state_bucket");
        assert_eq!(buckets.worker_presence_bucket, "JOBS_WORKER_PRESENCE");
        assert_eq!(buckets.worker_presence_replicas, 3);

        let seen = seen_requests.lock().expect("lock seen requests");
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].contract_id.as_deref(), Some(expected.id.as_str()));
        assert_eq!(seen[0].digest.as_deref(), Some(expected.digest.as_str()));
    }

    #[tokio::test]
    async fn resolve_jobs_kv_buckets_errors_when_binding_missing() {
        let expected = expected_contract();
        let (core_client, _) = core_client_with_binding(None);

        let error = resolve_jobs_kv_buckets(&core_client, &expected)
            .await
            .expect_err("missing binding should fail");

        assert!(matches!(error, JobsQueryError::MissingBinding));
    }

    #[tokio::test]
    async fn resolve_jobs_kv_buckets_errors_when_kv_map_missing() {
        let expected = expected_contract();
        let (core_client, _) =
            core_client_with_binding(Some(sample_binding_with_resources(None, None)));

        let error = resolve_jobs_kv_buckets(&core_client, &expected)
            .await
            .expect_err("missing kv resources should fail");

        assert!(matches!(error, JobsQueryError::MissingKvResources));
    }

    #[tokio::test]
    async fn resolve_jobs_kv_buckets_errors_when_alias_missing() {
        let expected = expected_contract();
        let (core_client, _) = core_client_with_binding(Some(sample_binding_with_resources(
            Some(BTreeMap::from([(
                "jobsState".to_string(),
                TrellisBindingsGetResponseBindingResourcesKvValue {
                    bucket: "jobs_state_bucket".to_string(),
                    history: 1,
                    max_value_bytes: None,
                    ttl_ms: 0,
                },
            )])),
            None,
        )));

        let error = resolve_jobs_kv_buckets(&core_client, &expected)
            .await
            .expect_err("missing streams should fail");

        assert!(matches!(error, JobsQueryError::MissingStreamResources));
    }

    #[tokio::test]
    async fn resolve_jobs_kv_buckets_errors_when_alias_shape_invalid() {
        let expected = expected_contract();
        let (core_client, _) = core_client_with_binding(Some(sample_binding_with_resources(
            Some(BTreeMap::from([(
                "jobsState".to_string(),
                TrellisBindingsGetResponseBindingResourcesKvValue {
                    bucket: "".to_string(),
                    history: 1,
                    max_value_bytes: None,
                    ttl_ms: 0,
                },
            )])),
            Some(sample_streams()),
        )));

        let error = resolve_jobs_kv_buckets(&core_client, &expected)
            .await
            .expect_err("invalid alias shape should fail");

        assert!(matches!(
            error,
            JobsQueryError::InvalidKvAliasShape(alias) if alias == "jobsState"
        ));
    }

    #[tokio::test]
    async fn resolve_jobs_kv_buckets_errors_when_bindings_request_fails() {
        let expected = expected_contract();
        let core_client = FakeCoreClient {
            binding_result: Mutex::new(Some(Err(TrellisClientError::RpcError(
                "bindings failed".to_string(),
            )))),
            seen_requests: Arc::new(Mutex::new(Vec::new())),
        };

        let error = resolve_jobs_kv_buckets(&core_client, &expected)
            .await
            .expect_err("bindings fetch failure should fail");

        assert!(matches!(error, JobsQueryError::BindingsFetch(_)));
    }

    #[tokio::test]
    async fn resolve_jobs_admin_resources_reads_stream_names_and_kv_aliases() {
        let expected = expected_contract();
        let (core_client, _) = core_client_with_binding(Some(sample_binding_with_resources(
            Some(BTreeMap::from([(
                "jobsState".to_string(),
                TrellisBindingsGetResponseBindingResourcesKvValue {
                    bucket: "jobs_state_bucket".to_string(),
                    history: 1,
                    max_value_bytes: None,
                    ttl_ms: 0,
                },
            )])),
            Some(sample_streams()),
        )));

        let resources = resolve_jobs_admin_resources(&core_client, &expected)
            .await
            .expect("admin resources should resolve");

        assert_eq!(resources.jobs_state_bucket, "jobs_state_bucket");
        assert_eq!(resources.worker_presence_bucket, "JOBS_WORKER_PRESENCE");
        assert_eq!(resources.worker_presence_replicas, 3);
        assert_eq!(resources.jobs_stream, "JOBS");
        assert_eq!(resources.jobs_advisories_stream, "JOBS_ADVISORIES");
    }

    #[test]
    fn jobs_admin_resources_from_binding_requires_stream_aliases() {
        let error = jobs_admin_resources_from_binding(&sample_binding_with_resources(
            Some(BTreeMap::from([(
                "jobsState".to_string(),
                TrellisBindingsGetResponseBindingResourcesKvValue {
                    bucket: "jobs_state_bucket".to_string(),
                    history: 1,
                    max_value_bytes: None,
                    ttl_ms: 0,
                },
            )])),
            None,
        ))
        .expect_err("missing streams should fail");

        assert!(matches!(error, JobsQueryError::MissingStreamResources));
    }
}
