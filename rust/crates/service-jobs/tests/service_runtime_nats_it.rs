use std::collections::BTreeMap;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_nats::header::HeaderMap;
use async_nats::jetstream::{self, kv, stream};
use bytes::Bytes;
use futures_util::{
    future::{ready, BoxFuture, FutureExt},
    StreamExt,
};
use serde_json::json;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use trellis_client::TrellisClientError;
use trellis_jobs::bindings::{JobsBinding, JobsQueueBinding, JobsRuntimeBinding};
use trellis_jobs::events::created_event;
use trellis_jobs::manager::{JobManager, JobMetaSource, JobProcessError};
use trellis_jobs::runtime_worker::{
    run_single_queue_worker_from_binding, run_single_queue_worker_from_binding_with_context,
    JobCancellationToken, NatsJobEventPublisher,
};
use trellis_jobs::subjects::{job_event_subject, worker_heartbeat_subject};
use trellis_jobs::{start_worker_host_from_binding, WorkerHostOptions};
use trellis_jobs::{Job, JobState, WorkerHeartbeat};
use trellis_sdk_jobs::types::{
    JobsGetRequest, JobsGetResponse, JobsHealthResponse, JobsListDLQResponse, JobsListRequest,
    JobsListResponse, JobsListServicesResponse,
};
use trellis_service_jobs::{
    rpc, run_janitor_once, run_jobs_service_with_clients, run_jobs_service_with_clients_with_mode,
    JobsServiceMode,
};

use trellis_auth::{AuthValidateRequestRequest, AuthValidateRequestResponse};
use trellis_auth_adapters::AuthRequestValidatorClientPort;
use trellis_core_bootstrap::CoreBootstrapClientPort;
use trellis_sdk_core::types::{
    TrellisBindingsGetRequest, TrellisBindingsGetResponse, TrellisBindingsGetResponseBinding,
    TrellisBindingsGetResponseBindingResources, TrellisBindingsGetResponseBindingResourcesJobs,
    TrellisBindingsGetResponseBindingResourcesJobsQueuesValue,
    TrellisBindingsGetResponseBindingResourcesJobsQueuesValuePayload,
    TrellisBindingsGetResponseBindingResourcesKvValue,
    TrellisBindingsGetResponseBindingResourcesStreamsValue, TrellisCatalogResponse,
    TrellisCatalogResponseCatalog, TrellisCatalogResponseCatalogContractsItem,
};
use trellis_server::RpcDescriptor;

struct FakeCoreClient {
    jobs_state_bucket: String,
    #[allow(dead_code)]
    service_instances_bucket: String,
}

impl FakeCoreClient {
    fn binding(&self) -> TrellisBindingsGetResponseBinding {
        TrellisBindingsGetResponseBinding {
            contract_id: trellis_service_jobs::CONTRACT_ID.to_string(),
            digest: trellis_service_jobs::CONTRACT_DIGEST.to_string(),
            resources: TrellisBindingsGetResponseBindingResources {
                jobs: Some(TrellisBindingsGetResponseBindingResourcesJobs {
                    namespace: "documents".to_string(),
                    queues: BTreeMap::from([(
                        "document-process".to_string(),
                        TrellisBindingsGetResponseBindingResourcesJobsQueuesValue {
                            ack_wait_ms: 60_000,
                            backoff_ms: vec![5_000],
                            concurrency: 1,
                            consumer_name: "documents-document-process".to_string(),
                            default_deadline_ms: None,
                            dlq: true,
                            logs: true,
                            max_deliver: 5,
                            payload:
                                TrellisBindingsGetResponseBindingResourcesJobsQueuesValuePayload {
                                    schema: "DocumentPayload".to_string(),
                                },
                            progress: true,
                            publish_prefix: "trellis.jobs.documents.document-process".to_string(),
                            queue_type: "document-process".to_string(),
                            result: None,
                            work_subject: "trellis.work.documents.document-process".to_string(),
                        },
                    )]),
                }),
                kv: Some(BTreeMap::from([(
                    "jobsState".to_string(),
                    TrellisBindingsGetResponseBindingResourcesKvValue {
                        bucket: self.jobs_state_bucket.clone(),
                        history: 1,
                        max_value_bytes: None,
                        ttl_ms: 0,
                    },
                )])),
                streams: Some(BTreeMap::from([
                    (
                        "jobs".to_string(),
                        TrellisBindingsGetResponseBindingResourcesStreamsValue {
                            discard: Some("old".to_string()),
                            max_age_ms: Some(0),
                            max_bytes: Some(-1),
                            max_msgs: Some(-1),
                            name: "JOBS".to_string(),
                            num_replicas: Some(3),
                            retention: Some("limits".to_string()),
                            sources: None,
                            storage: Some("file".to_string()),
                            subjects: vec!["trellis.jobs.>".to_string()],
                        },
                    ),
                    (
                        "jobsWork".to_string(),
                        TrellisBindingsGetResponseBindingResourcesStreamsValue {
                            discard: None,
                            max_age_ms: None,
                            max_bytes: None,
                            max_msgs: None,
                            name: "JOBS_WORK".to_string(),
                            num_replicas: Some(3),
                            retention: Some("workqueue".to_string()),
                            sources: None,
                            storage: Some("file".to_string()),
                            subjects: vec!["trellis.work.>".to_string()],
                        },
                    ),
                    (
                        "jobsAdvisories".to_string(),
                        TrellisBindingsGetResponseBindingResourcesStreamsValue {
                            discard: None,
                            max_age_ms: Some(604_800_000),
                            max_bytes: None,
                            max_msgs: None,
                            name: "JOBS_ADVISORIES".to_string(),
                            num_replicas: Some(1),
                            retention: Some("limits".to_string()),
                            sources: None,
                            storage: Some("file".to_string()),
                            subjects: vec![
                                "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>"
                                    .to_string(),
                            ],
                        },
                    ),
                ])),
            },
        }
    }
}

impl CoreBootstrapClientPort for FakeCoreClient {
    fn trellis_catalog<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<TrellisCatalogResponse, TrellisClientError>> {
        ready(Ok(TrellisCatalogResponse {
            catalog: TrellisCatalogResponseCatalog {
                contracts: vec![TrellisCatalogResponseCatalogContractsItem {
                    description: "jobs".to_string(),
                    digest: trellis_service_jobs::CONTRACT_DIGEST.to_string(),
                    display_name: "Jobs".to_string(),
                    id: trellis_service_jobs::CONTRACT_ID.to_string(),
                }],
                format: "trellis.catalog.v1".to_string(),
            },
        }))
        .boxed()
    }

    fn trellis_bindings_get<'a>(
        &'a self,
        _input: &'a TrellisBindingsGetRequest,
    ) -> BoxFuture<'a, Result<TrellisBindingsGetResponse, TrellisClientError>> {
        ready(Ok(TrellisBindingsGetResponse {
            binding: Some(self.binding()),
        }))
        .boxed()
    }
}

struct FakeAuthValidateClient;

impl AuthRequestValidatorClientPort for FakeAuthValidateClient {
    fn auth_validate_request<'a>(
        &'a self,
        _input: &'a AuthValidateRequestRequest,
    ) -> BoxFuture<'a, Result<AuthValidateRequestResponse, TrellisClientError>> {
        ready(Ok(AuthValidateRequestResponse {
            allowed: true,
            caller: json!({
                "type": "service",
                "id": "svc-user",
                "name": "Service",
                "active": true,
                "capabilities": ["service"],
            }),
            inbox_prefix: "_INBOX.test".to_string(),
        }))
        .boxed()
    }
}

struct RuntimeContainer {
    runtime: String,
    name: String,
}

impl Drop for RuntimeContainer {
    fn drop(&mut self) {
        let _ = Command::new(&self.runtime)
            .args(["rm", "-f", &self.name])
            .output();
    }
}

struct SequenceMetaSource {
    id: String,
    times: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

impl SequenceMetaSource {
    fn new(id: &str, times: Vec<&str>) -> Self {
        Self {
            id: id.to_string(),
            times: std::sync::Arc::new(std::sync::Mutex::new(
                times.into_iter().map(str::to_string).collect(),
            )),
        }
    }
}

impl JobMetaSource for SequenceMetaSource {
    fn next_job_id(&self) -> String {
        self.id.clone()
    }

    fn now_iso(&self) -> String {
        self.times.lock().expect("lock times").remove(0)
    }
}

fn detect_runtime() -> Option<&'static str> {
    for runtime in ["podman", "docker"] {
        if Command::new(runtime)
            .arg("--version")
            .status()
            .ok()?
            .success()
        {
            return Some(runtime);
        }
    }
    None
}

fn run_command(runtime: &str, args: &[&str]) -> String {
    let output = Command::new(runtime)
        .args(args)
        .output()
        .expect("runtime command should execute");
    if !output.status.success() {
        panic!(
            "runtime command failed: {} {}\nstdout: {}\nstderr: {}",
            runtime,
            args.join(" "),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }
    String::from_utf8(output.stdout)
        .expect("stdout should be utf-8")
        .trim()
        .to_string()
}

fn start_nats_container() -> (RuntimeContainer, String) {
    let runtime = detect_runtime().expect("podman or docker runtime is required");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    let name = format!("trellis-service-jobs-it-{}-{}", std::process::id(), now);

    run_command(
        runtime,
        &[
            "run",
            "-d",
            "--rm",
            "--name",
            &name,
            "-p",
            "127.0.0.1::4222",
            "docker.io/library/nats:2.10-alpine",
            "-js",
        ],
    );

    let mapping = run_command(runtime, &["port", &name, "4222/tcp"]);
    let host_port = mapping
        .split(':')
        .next_back()
        .expect("port output should include ':'")
        .trim()
        .to_string();

    (
        RuntimeContainer {
            runtime: runtime.to_string(),
            name,
        },
        format!("127.0.0.1:{host_port}"),
    )
}

async fn connect_with_retry(server: &str) -> async_nats::Client {
    for _ in 0..30 {
        if let Ok(client) = async_nats::connect(server).await {
            return client;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    panic!("failed to connect to nats server {server}");
}

fn unique_name(prefix: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    format!("{prefix}_{}_{}", std::process::id(), now)
}

fn sample_job(id: &str, updated_at: &str, state: JobState) -> Job {
    Job {
        id: id.to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state,
        payload: json!({ "jobId": id }),
        result: None,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: updated_at.to_string(),
        started_at: None,
        completed_at: None,
        tries: 1,
        max_tries: 5,
        last_error: None,
        deadline: None,
        progress: None,
        logs: None,
    }
}

async fn create_bucket(js: &jetstream::Context, bucket: &str) -> jetstream::kv::Store {
    js.create_key_value(kv::Config {
        bucket: bucket.to_string(),
        history: 1,
        ..Default::default()
    })
    .await
    .expect("kv bucket should be created")
}

async fn ensure_stream(
    js: &jetstream::Context,
    name: &str,
    subjects: Vec<String>,
) -> jetstream::stream::Stream {
    if let Ok(stream) = js.get_stream(name).await {
        return stream;
    }
    js.create_stream(stream::Config {
        name: name.to_string(),
        subjects,
        ..Default::default()
    })
    .await
    .expect("stream should be created")
}

async fn seed_kv_data(
    nats_client: &async_nats::Client,
    jobs_state_bucket: &str,
    service_instances_bucket: &str,
) {
    let js = jetstream::new(nats_client.clone());
    let (jobs_kv, _service_instances_kv) =
        seed_jobs_infrastructure(&js, jobs_state_bucket, service_instances_bucket).await;

    let older = sample_job("job-1", "2026-01-02T00:00:00Z", JobState::Completed);
    let newer = sample_job("job-2", "2026-01-03T00:00:00Z", JobState::Failed);

    jobs_kv
        .put(
            "documents.document-process.job-1",
            serde_json::to_vec(&older).expect("serialize job").into(),
        )
        .await
        .expect("seed first job");
    jobs_kv
        .put(
            "documents.document-process.job-2",
            serde_json::to_vec(&newer).expect("serialize job").into(),
        )
        .await
        .expect("seed second job");

    publish_fresh_worker_heartbeat(nats_client, "documents", "document-process", "documents-1")
        .await;
}

async fn publish_fresh_worker_heartbeat(
    nats_client: &async_nats::Client,
    service: &str,
    job_type: &str,
    instance_id: &str,
) {
    let heartbeat = WorkerHeartbeat {
        service: service.to_string(),
        job_type: job_type.to_string(),
        instance_id: instance_id.to_string(),
        concurrency: Some(1),
        version: Some("0.6.1".to_string()),
        timestamp: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .expect("format current timestamp"),
    };
    nats_client
        .publish(
            worker_heartbeat_subject(service, job_type, instance_id),
            serde_json::to_vec(&heartbeat)
                .expect("serialize worker heartbeat")
                .into(),
        )
        .await
        .expect("publish worker heartbeat");
}

async fn seed_jobs_infrastructure(
    js: &jetstream::Context,
    jobs_state_bucket: &str,
    service_instances_bucket: &str,
) -> (jetstream::kv::Store, jetstream::kv::Store) {
    let jobs_kv = create_bucket(js, jobs_state_bucket).await;
    let service_instances_kv = create_bucket(js, service_instances_bucket).await;
    let _jobs_stream = ensure_stream(js, "JOBS", vec!["trellis.jobs.>".to_string()]).await;
    let _work_stream = ensure_stream(js, "JOBS_WORK", vec!["trellis.work.>".to_string()]).await;
    let _advisories_stream = ensure_stream(
        js,
        "JOBS_ADVISORIES",
        vec!["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.>".to_string()],
    )
    .await;
    (jobs_kv, service_instances_kv)
}

async fn await_projected_job(
    requester_client: &async_nats::Client,
    headers: HeaderMap,
    id: &str,
) -> Job {
    for _ in 0..40 {
        let get_request_payload = serde_json::to_vec(&JobsGetRequest {
            service: "documents".to_string(),
            job_type: "document-process".to_string(),
            id: id.to_string(),
        })
        .expect("serialize jobs get request");
        let get_response = match requester_client
            .request_with_headers(
                rpc::JobsGetRpc::SUBJECT.to_string(),
                headers.clone(),
                get_request_payload.into(),
            )
            .await
        {
            Ok(response) => response,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };

        let get_response_payload: JobsGetResponse =
            serde_json::from_slice(&get_response.payload).expect("decode jobs get response");
        if let Some(job) = get_response_payload.job {
            return map_job_from_wire(&job);
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    panic!("projected job did not appear in Jobs.Get within timeout");
}

fn map_job_from_wire<T>(job: &T) -> Job
where
    T: serde::Serialize,
{
    serde_json::from_value(serde_json::to_value(job).expect("serialize generated job"))
        .expect("decode internal job")
}

async fn await_projected_job_state(
    requester_client: &async_nats::Client,
    headers: HeaderMap,
    id: &str,
    expected: JobState,
) -> Job {
    await_projected_job_state_with_retry(requester_client, headers, id, expected, 60, 50).await
}

async fn await_projected_job_state_with_retry(
    requester_client: &async_nats::Client,
    headers: HeaderMap,
    id: &str,
    expected: JobState,
    attempts: usize,
    sleep_ms: u64,
) -> Job {
    for _ in 0..attempts {
        let job = await_projected_job(requester_client, headers.clone(), id).await;
        if job.state == expected {
            return job;
        }
        tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
    }

    panic!("projected job did not reach expected state within timeout");
}

async fn await_jobs_health(requester_client: &async_nats::Client, headers: HeaderMap) {
    for _ in 0..40 {
        if requester_client
            .request_with_headers(
                rpc::JobsHealthRpc::SUBJECT.to_string(),
                headers.clone(),
                Bytes::from_static(b"{}"),
            )
            .await
            .is_ok()
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    panic!("jobs service health responder did not become ready within timeout");
}

async fn await_worker_presence(
    requester_client: &async_nats::Client,
    headers: HeaderMap,
    service: &str,
    instance_id: &str,
) -> trellis_sdk_jobs::types::JobsListServicesResponseServicesItemWorkersItem {
    for _ in 0..60 {
        let response = requester_client
            .request_with_headers(
                rpc::JobsListServicesRpc::SUBJECT.to_string(),
                headers.clone(),
                Bytes::from_static(b"{}"),
            )
            .await
            .expect("list services request should get reply");
        let payload: JobsListServicesResponse =
            serde_json::from_slice(&response.payload).expect("decode jobs list services response");
        if let Some(worker) = payload
            .services
            .into_iter()
            .find(|entry| entry.name == service)
            .and_then(|entry| {
                entry
                    .workers
                    .into_iter()
                    .find(|worker| worker.instance_id == instance_id)
            })
        {
            return worker;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    panic!("worker presence did not appear for {service}:{instance_id}");
}

fn sample_jobs_binding() -> JobsBinding {
    JobsBinding {
        namespace: "documents".to_string(),
        jobs_state_bucket: None,
        queues: BTreeMap::from([(
            "document-process".to_string(),
            JobsQueueBinding {
                queue_type: "document-process".to_string(),
                publish_prefix: "trellis.jobs.documents.document-process".to_string(),
                work_subject: "trellis.work.documents.document-process".to_string(),
                consumer_name: "documents-document-process".to_string(),
                max_deliver: 5,
                backoff_ms: vec![5_000],
                ack_wait_ms: 60_000,
                default_deadline_ms: None,
                progress: true,
                logs: true,
                concurrency: 1,
            },
        )]),
    }
}

#[tokio::test]
async fn run_jobs_service_with_clients_serves_jobs_health_list_services_list_and_get_over_nats() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    seed_kv_data(
        &service_client,
        &jobs_state_bucket,
        &service_instances_bucket,
    )
    .await;

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client,
        FakeCoreClient {
            jobs_state_bucket,
            service_instances_bucket,
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    let health_response = requester_client
        .request_with_headers(
            rpc::JobsHealthRpc::SUBJECT.to_string(),
            headers.clone(),
            Bytes::from_static(b"{}"),
        )
        .await
        .expect("request should get reply");

    let payload: JobsHealthResponse =
        serde_json::from_slice(&health_response.payload).expect("decode jobs health response");
    assert_eq!(payload.service, trellis_service_jobs::SERVICE_NAME);

    let list_services_response = requester_client
        .request_with_headers(
            rpc::JobsListServicesRpc::SUBJECT.to_string(),
            headers.clone(),
            Bytes::from_static(b"{}"),
        )
        .await
        .expect("list services request should get reply");

    let list_payload: JobsListServicesResponse =
        serde_json::from_slice(&list_services_response.payload)
            .expect("decode jobs list services response");
    assert_eq!(list_payload.services.len(), 1);
    assert_eq!(list_payload.services[0].name, "documents");
    assert_eq!(list_payload.services[0].workers.len(), 1);

    let list_request_payload = serde_json::to_vec(&JobsListRequest {
        limit: None,
        service: None,
        since: None,
        state: None,
        r#type: None,
    })
    .expect("serialize jobs list request");
    let list_response = requester_client
        .request_with_headers(
            rpc::JobsListRpc::SUBJECT.to_string(),
            headers.clone(),
            list_request_payload.into(),
        )
        .await
        .expect("list request should get reply");

    let list_response_payload: JobsListResponse =
        serde_json::from_slice(&list_response.payload).expect("decode jobs list response");
    assert_eq!(list_response_payload.jobs.len(), 2);
    assert_eq!(list_response_payload.jobs[0].id, "job-2");
    assert_eq!(list_response_payload.jobs[1].id, "job-1");

    let get_request_payload = serde_json::to_vec(&JobsGetRequest {
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        id: "job-1".to_string(),
    })
    .expect("serialize jobs get request");
    let get_response = requester_client
        .request_with_headers(
            rpc::JobsGetRpc::SUBJECT.to_string(),
            headers,
            get_request_payload.into(),
        )
        .await
        .expect("get request should get reply");

    let get_response_payload: JobsGetResponse =
        serde_json::from_slice(&get_response.payload).expect("decode jobs get response");
    assert_eq!(
        get_response_payload.job.expect("job should be present").id,
        "job-1"
    );

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn worker_presence_projection_survives_owner_restart_and_rpc_only_reads_durable_state() {
    let (_container, server) = start_nats_container();
    let owner_client = connect_with_retry(&server).await;
    let rpc_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    seed_kv_data(&owner_client, &jobs_state_bucket, &service_instances_bucket).await;

    let owner_task = tokio::spawn(run_jobs_service_with_clients(
        owner_client,
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;
    let runtime_binding = JobsRuntimeBinding::try_from(
        &FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        }
        .binding(),
    )
    .expect("runtime binding");
    let worker_host = start_worker_host_from_binding(
        requester_client.clone(),
        runtime_binding,
        "documents-1".to_string(),
        {
            let requester_client = requester_client.clone();
            move || NatsJobEventPublisher::new(requester_client.clone())
        },
        |_queue_type, worker_index| match worker_index {
            0 => SequenceMetaSource::new(
                "ignored-worker-presence-restart",
                vec!["2026-03-28T12:00:01.000Z", "2026-03-28T12:00:02.000Z"],
            ),
            _ => unreachable!("default test binding starts one worker"),
        },
        |_job| async {
            Ok::<serde_json::Value, JobProcessError<String>>(json!({ "processed": true }))
        },
        WorkerHostOptions::default(),
    )
    .await
    .expect("start worker host for durable presence test");
    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    let worker = await_worker_presence(
        &requester_client,
        headers.clone(),
        "documents",
        "documents-1",
    )
    .await;
    assert_eq!(worker.job_type, "document-process");
    owner_task.abort();
    let _ = owner_task.await;
    worker_host.stop().await.expect("stop worker host");

    let rpc_only_task = tokio::spawn(run_jobs_service_with_clients_with_mode(
        rpc_client,
        FakeCoreClient {
            jobs_state_bucket,
            service_instances_bucket,
        },
        FakeAuthValidateClient,
        JobsServiceMode::RpcOnly,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let response = requester_client
        .request_with_headers(
            rpc::JobsListServicesRpc::SUBJECT.to_string(),
            headers,
            Bytes::from_static(b"{}"),
        )
        .await
        .expect("list services request should get reply");
    let payload: JobsListServicesResponse =
        serde_json::from_slice(&response.payload).expect("decode jobs list services response");
    assert_eq!(payload.services.len(), 1);
    assert_eq!(payload.services[0].name, "documents");
    assert_eq!(payload.services[0].workers.len(), 1);

    rpc_only_task.abort();
    let _ = rpc_only_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_projects_stream_events_into_jobs_state_kv() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let _infra = seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let created = created_event(
        "documents",
        "document-process",
        "job-projected-1",
        json!({ "documentId": "doc-1" }),
        5,
        "2026-03-28T12:00:00.000Z",
        None,
    );
    service_client
        .publish(
            job_event_subject(
                &created.service,
                &created.job_type,
                &created.job_id,
                created.event_type,
            ),
            serde_json::to_vec(&created)
                .expect("serialize created event")
                .into(),
        )
        .await
        .expect("publish jobs created event");

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");

    let projected = await_projected_job(&requester_client, headers, "job-projected-1").await;
    assert_eq!(projected.id, "job-projected-1");
    assert_eq!(projected.service, "documents");
    assert_eq!(projected.job_type, "document-process");
    assert_eq!(projected.state, JobState::Pending);
    assert_eq!(projected.payload, json!({ "documentId": "doc-1" }));

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_serves_jobs_cancel_and_retry_mutations() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let (jobs_kv, _service_instances_kv) =
        seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let pending = sample_job("job-pending-1", "2026-01-02T00:00:00Z", JobState::Pending);
    let failed = sample_job("job-failed-1", "2026-01-03T00:00:00Z", JobState::Failed);
    jobs_kv
        .put(
            "documents.document-process.job-pending-1",
            serde_json::to_vec(&pending)
                .expect("serialize pending job")
                .into(),
        )
        .await
        .expect("seed pending job");
    jobs_kv
        .put(
            "documents.document-process.job-failed-1",
            serde_json::to_vec(&failed)
                .expect("serialize failed job")
                .into(),
        )
        .await
        .expect("seed failed job");
    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client,
        FakeCoreClient {
            jobs_state_bucket,
            service_instances_bucket,
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");

    let mutate_payload = serde_json::to_vec(&json!({
        "service": "documents",
        "jobType": "document-process",
        "id": "job-pending-1"
    }))
    .expect("serialize mutate payload");

    let cancel_response = requester_client
        .request_with_headers(
            rpc::JobsCancelRpc::SUBJECT.to_string(),
            headers.clone(),
            mutate_payload.clone().into(),
        )
        .await
        .expect("cancel request should get reply");

    let cancel_json: serde_json::Value =
        serde_json::from_slice(&cancel_response.payload).expect("decode cancel response");
    assert_eq!(cancel_json["job"]["state"], json!("cancelled"));

    let retry_response = requester_client
        .request_with_headers(
            rpc::JobsRetryRpc::SUBJECT.to_string(),
            headers.clone(),
            serde_json::to_vec(&json!({
                "service": "documents",
                "jobType": "document-process",
                "id": "job-failed-1"
            }))
            .expect("serialize retry payload")
            .into(),
        )
        .await
        .expect("retry request should get reply");

    let retry_json: serde_json::Value =
        serde_json::from_slice(&retry_response.payload).expect("decode retry response");
    assert_eq!(retry_json["job"]["state"], json!("pending"));
    assert!(retry_json["job"].get("lastError").is_none());
    assert!(retry_json["job"].get("result").is_none());
    assert!(retry_json["job"].get("startedAt").is_none());
    assert!(retry_json["job"].get("completedAt").is_none());
    assert!(retry_json["job"].get("progress").is_none());

    let get_request_payload = serde_json::to_vec(&JobsGetRequest {
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        id: "job-failed-1".to_string(),
    })
    .expect("serialize jobs get request");
    let get_response = requester_client
        .request_with_headers(
            rpc::JobsGetRpc::SUBJECT.to_string(),
            headers,
            get_request_payload.into(),
        )
        .await
        .expect("get request should get reply");
    let get_response_payload: JobsGetResponse =
        serde_json::from_slice(&get_response.payload).expect("decode jobs get response");
    let job = map_job_from_wire(&get_response_payload.job.expect("job should be present"));
    assert_eq!(job.state, JobState::Pending);

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_filters_jobs_list_results() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let (jobs_kv, _service_instances_kv) =
        seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let pending_old = sample_job("job-pending-old", "2026-01-02T00:00:00Z", JobState::Pending);
    let pending_new = sample_job("job-pending-new", "2026-01-04T00:00:00Z", JobState::Pending);
    let failed_job = sample_job("job-failed-1", "2026-01-03T00:00:00Z", JobState::Failed);
    let other_service = Job {
        service: "billing".to_string(),
        ..sample_job("job-billing-1", "2026-01-05T00:00:00Z", JobState::Pending)
    };

    for job in [&pending_old, &pending_new, &failed_job, &other_service] {
        jobs_kv
            .put(
                format!("{}.{}.{}", job.service, job.job_type, job.id),
                serde_json::to_vec(job)
                    .expect("serialize seeded job")
                    .into(),
            )
            .await
            .expect("seed job");
    }

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client,
        FakeCoreClient {
            jobs_state_bucket,
            service_instances_bucket,
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");

    let filtered_response = requester_client
        .request_with_headers(
            rpc::JobsListRpc::SUBJECT.to_string(),
            headers,
            serde_json::to_vec(&JobsListRequest {
                service: Some("documents".to_string()),
                r#type: Some("document-process".to_string()),
                state: Some(json!(["pending", "failed"])),
                since: Some("2026-01-03T00:00:00Z".to_string()),
                limit: Some(2),
            })
            .expect("serialize list request")
            .into(),
        )
        .await
        .expect("list request should reply");
    let filtered: JobsListResponse =
        serde_json::from_slice(&filtered_response.payload).expect("decode list response");

    let ids = filtered
        .jobs
        .iter()
        .map(|job| job.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["job-pending-new", "job-failed-1"]);

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_worker_creates_and_processes_job_using_trellis_jobs() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let worker_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let _infra = seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let mut runtime_binding = JobsRuntimeBinding::try_from(
        &FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        }
        .binding(),
    )
    .expect("runtime binding");
    let queue = runtime_binding
        .jobs
        .queues
        .get_mut("document-process")
        .expect("document-process queue");
    queue.ack_wait_ms = 250;
    queue.backoff_ms = vec![0];
    let worker_task = tokio::spawn(run_single_queue_worker_from_binding(
        worker_client.clone(),
        runtime_binding.clone(),
        "document-process",
        NatsJobEventPublisher::new(worker_client.clone()),
        SequenceMetaSource::new(
            "job-runtime-checkpoint-1",
            vec!["2026-03-28T12:00:01.000Z", "2026-03-28T12:00:02.000Z"],
        ),
        |_job| async {
            Ok::<serde_json::Value, JobProcessError<String>>(json!({ "processed": true }))
        },
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;
    publish_fresh_worker_heartbeat(
        &worker_client,
        "documents",
        "document-process",
        "documents-worker-1",
    )
    .await;

    let worker = await_worker_presence(
        &requester_client,
        headers.clone(),
        "documents",
        "documents-worker-1",
    )
    .await;
    assert_eq!(worker.job_type, "document-process");

    let create_manager = JobManager::new(
        NatsJobEventPublisher::new(service_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new("job-runtime-checkpoint-1", vec!["2026-03-28T12:00:00.000Z"]),
    );

    let created_job = create_manager
        .create("document-process", json!({ "documentId": "doc-runtime-1" }))
        .await
        .expect("create should publish created event");

    let mut event_subscriber = requester_client
        .subscribe("trellis.jobs.documents.document-process.job-runtime-checkpoint-1.>".to_string())
        .await
        .expect("subscribe to runtime checkpoint event stream");

    worker_client
        .publish(
            "trellis.work.documents.document-process".to_string(),
            serde_json::to_vec(&created_event(
                &created_job.service,
                &created_job.job_type,
                &created_job.id,
                created_job.payload.clone(),
                created_job.max_tries,
                &created_job.created_at,
                created_job.deadline.as_deref(),
            ))
            .expect("serialize created work event")
            .into(),
        )
        .await
        .expect("publish work item");

    let mut saw_started = false;
    let mut saw_completed = false;
    for _ in 0..12 {
        let message = tokio::time::timeout(Duration::from_millis(300), event_subscriber.next())
            .await
            .ok()
            .flatten();
        let Some(message) = message else {
            continue;
        };
        let subject = message.subject.to_string();
        if subject.ends_with(".started") {
            saw_started = true;
        }
        if subject.ends_with(".completed") {
            saw_completed = true;
        }
        if saw_started && saw_completed {
            break;
        }
    }

    assert!(saw_started, "worker should publish started event");
    assert!(saw_completed, "worker should publish completed event");

    let projected = await_projected_job_state(
        &requester_client,
        headers,
        "job-runtime-checkpoint-1",
        JobState::Completed,
    )
    .await;

    assert_eq!(projected.id, "job-runtime-checkpoint-1");
    assert_eq!(projected.service, "documents");
    assert_eq!(projected.job_type, "document-process");
    assert_eq!(projected.state, JobState::Completed);
    assert_eq!(projected.result, Some(json!({ "processed": true })));

    worker_task.abort();
    let _ = worker_task.await;
    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_rpc_only_serves_rpcs_without_owning_projection_loops() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let _infra = seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let loop_task = tokio::spawn(run_jobs_service_with_clients_with_mode(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
        JobsServiceMode::RpcOnly,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let create_manager = JobManager::new(
        NatsJobEventPublisher::new(service_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new("job-rpc-only-1", vec!["2026-03-28T12:20:00.000Z"]),
    );
    let _created_job = create_manager
        .create(
            "document-process",
            json!({ "documentId": "doc-rpc-only-1" }),
        )
        .await
        .expect("create should publish created event");

    tokio::time::sleep(Duration::from_millis(300)).await;
    let get_response = requester_client
        .request_with_headers(
            rpc::JobsGetRpc::SUBJECT.to_string(),
            headers,
            serde_json::to_vec(&JobsGetRequest {
                service: "documents".to_string(),
                job_type: "document-process".to_string(),
                id: "job-rpc-only-1".to_string(),
            })
            .expect("serialize jobs get request")
            .into(),
        )
        .await
        .expect("jobs get should reply in rpc-only mode");
    let payload: JobsGetResponse =
        serde_json::from_slice(&get_response.payload).expect("decode jobs get response");
    assert!(
        payload.job.is_none(),
        "rpc-only mode should not project stream events"
    );

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_owner_and_rpc_only_coexist_with_shared_projected_state() {
    let (_container, server) = start_nats_container();
    let owner_client = connect_with_retry(&server).await;
    let rpc_only_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(owner_client.clone());
    let _infra = seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let owner_task = tokio::spawn(run_jobs_service_with_clients_with_mode(
        owner_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
        JobsServiceMode::Owner,
    ));
    let rpc_only_task = tokio::spawn(run_jobs_service_with_clients_with_mode(
        rpc_only_client,
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
        JobsServiceMode::RpcOnly,
    ));
    tokio::time::sleep(Duration::from_millis(150)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let create_manager = JobManager::new(
        NatsJobEventPublisher::new(owner_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new("job-owner-rpc-only-1", vec!["2026-03-28T12:30:00.000Z"]),
    );
    create_manager
        .create(
            "document-process",
            json!({ "documentId": "doc-owner-rpc-only-1" }),
        )
        .await
        .expect("create should publish created event");

    let projected = await_projected_job_state(
        &requester_client,
        headers.clone(),
        "job-owner-rpc-only-1",
        JobState::Pending,
    )
    .await;
    assert_eq!(projected.id, "job-owner-rpc-only-1");

    let get_response = requester_client
        .request_with_headers(
            rpc::JobsGetRpc::SUBJECT.to_string(),
            headers,
            serde_json::to_vec(&JobsGetRequest {
                service: "documents".to_string(),
                job_type: "document-process".to_string(),
                id: "job-owner-rpc-only-1".to_string(),
            })
            .expect("serialize jobs get request")
            .into(),
        )
        .await
        .expect("jobs get should reply while owner and rpc-only coexist");
    let payload: JobsGetResponse =
        serde_json::from_slice(&get_response.payload).expect("decode jobs get response");
    let job = payload.job.expect("owner should keep projection fresh");
    assert_eq!(job.id, "job-owner-rpc-only-1");
    assert_eq!(job.service, "documents");

    owner_task.abort();
    let _ = owner_task.await;
    rpc_only_task.abort();
    let _ = rpc_only_task.await;
}

#[tokio::test]
async fn run_single_queue_worker_host_shutdown_requeues_work_end_to_end() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let worker_a_client = connect_with_retry(&server).await;
    let worker_b_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let _infra = seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let owner_task = tokio::spawn(run_jobs_service_with_clients_with_mode(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
        JobsServiceMode::Owner,
    ));
    tokio::time::sleep(Duration::from_millis(150)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let runtime_binding = JobsRuntimeBinding::try_from(
        &FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        }
        .binding(),
    )
    .expect("runtime binding");

    let create_manager = JobManager::new(
        NatsJobEventPublisher::new(service_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new("job-host-redelivery-1", vec!["2026-03-28T12:40:00.000Z"]),
    );
    let created_job = create_manager
        .create(
            "document-process",
            json!({ "documentId": "doc-host-redelivery-1" }),
        )
        .await
        .expect("create should publish created event");

    worker_a_client
        .publish(
            "trellis.work.documents.document-process".to_string(),
            serde_json::to_vec(&created_event(
                &created_job.service,
                &created_job.job_type,
                &created_job.id,
                created_job.payload.clone(),
                created_job.max_tries,
                &created_job.created_at,
                created_job.deadline.as_deref(),
            ))
            .expect("serialize created work event")
            .into(),
        )
        .await
        .expect("publish work item");

    let shutdown = JobCancellationToken::new();
    let worker_a = tokio::spawn(run_single_queue_worker_from_binding_with_context(
        worker_a_client,
        runtime_binding.clone(),
        "document-process",
        NatsJobEventPublisher::new(service_client.clone()),
        SequenceMetaSource::new(
            "job-host-redelivery-1",
            vec!["2026-03-28T12:40:01.000Z", "2026-03-28T12:40:02.000Z"],
        ),
        shutdown.clone(),
        move |job| async move {
            job.heartbeat()
                .await
                .expect("heartbeat should work before shutdown");
            loop {
                if job.is_cancelled() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            Ok::<serde_json::Value, JobProcessError<String>>(json!({
                "processedBy": "worker-a"
            }))
        },
    ));

    let active = await_projected_job_state(
        &requester_client,
        headers.clone(),
        "job-host-redelivery-1",
        JobState::Active,
    )
    .await;
    assert_eq!(active.state, JobState::Active);

    shutdown.cancel_for_shutdown();
    tokio::time::timeout(Duration::from_secs(3), worker_a)
        .await
        .expect("worker A should stop after shutdown")
        .expect("worker A join should succeed")
        .expect("worker A should return runtime result");

    let worker_b = tokio::spawn(run_single_queue_worker_from_binding(
        worker_b_client,
        runtime_binding,
        "document-process",
        NatsJobEventPublisher::new(service_client.clone()),
        SequenceMetaSource::new(
            "job-host-redelivery-1",
            vec!["2026-03-28T12:40:03.000Z", "2026-03-28T12:40:04.000Z"],
        ),
        |_job| async move {
            Ok::<serde_json::Value, JobProcessError<String>>(json!({
                "processedBy": "worker-b"
            }))
        },
    ));

    let completed = await_projected_job_state_with_retry(
        &requester_client,
        headers,
        "job-host-redelivery-1",
        JobState::Completed,
        160,
        50,
    )
    .await;
    assert_eq!(completed.result, Some(json!({ "processedBy": "worker-b" })));

    worker_b.abort();
    let _ = worker_b.await;
    owner_task.abort();
    let _ = owner_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_cancels_active_worker_job() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let worker_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let (_jobs_kv, _services_kv) =
        seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let runtime_binding = JobsRuntimeBinding::try_from(
        &FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        }
        .binding(),
    )
    .expect("runtime binding");
    let worker_task = tokio::spawn(run_single_queue_worker_from_binding(
        worker_client.clone(),
        runtime_binding,
        "document-process",
        NatsJobEventPublisher::new(worker_client.clone()),
        SequenceMetaSource::new(
            "job-active-cancel-1",
            vec!["2026-03-28T12:00:01.000Z", "2026-03-28T12:00:02.000Z"],
        ),
        |job| async move {
            for _ in 0..40 {
                if job.is_cancelled() {
                    return Ok::<serde_json::Value, JobProcessError<String>>(json!({
                        "processed": false,
                    }));
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            Ok::<serde_json::Value, JobProcessError<String>>(json!({ "processed": true }))
        },
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let create_manager = JobManager::new(
        NatsJobEventPublisher::new(service_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new("job-active-cancel-1", vec!["2026-03-28T12:00:00.000Z"]),
    );
    let created_job = create_manager
        .create("document-process", json!({ "documentId": "doc-cancel-1" }))
        .await
        .expect("create should publish created event");

    worker_client
        .publish(
            "trellis.work.documents.document-process".to_string(),
            serde_json::to_vec(&created_event(
                &created_job.service,
                &created_job.job_type,
                &created_job.id,
                created_job.payload.clone(),
                created_job.max_tries,
                &created_job.created_at,
                created_job.deadline.as_deref(),
            ))
            .expect("serialize created work event")
            .into(),
        )
        .await
        .expect("publish work item");

    let active = await_projected_job_state(
        &requester_client,
        headers.clone(),
        "job-active-cancel-1",
        JobState::Active,
    )
    .await;
    assert_eq!(active.state, JobState::Active);

    let cancel_response = requester_client
        .request_with_headers(
            rpc::JobsCancelRpc::SUBJECT.to_string(),
            headers.clone(),
            serde_json::to_vec(&json!({
                "service": "documents",
                "jobType": "document-process",
                "id": "job-active-cancel-1"
            }))
            .expect("serialize cancel payload")
            .into(),
        )
        .await
        .expect("cancel active should reply");
    let cancel_json: serde_json::Value =
        serde_json::from_slice(&cancel_response.payload).expect("decode cancel response");
    assert_eq!(cancel_json["job"]["state"], json!("cancelled"));

    let cancelled = await_projected_job_state(
        &requester_client,
        headers,
        "job-active-cancel-1",
        JobState::Cancelled,
    )
    .await;
    assert_eq!(cancelled.state, JobState::Cancelled);

    worker_task.abort();
    let _ = worker_task.await;
    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn start_worker_host_from_binding_projects_worker_presence_and_processes_jobs() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let worker_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let _infra = seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let runtime_binding = JobsRuntimeBinding::try_from(
        &FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        }
        .binding(),
    )
    .expect("runtime binding");
    let worker_host = start_worker_host_from_binding(
        worker_client.clone(),
        runtime_binding,
        "documents-host-1".to_string(),
        {
            let worker_client = worker_client.clone();
            move || NatsJobEventPublisher::new(worker_client.clone())
        },
        |_queue_type, worker_index| match worker_index {
            0 => SequenceMetaSource::new(
                "ignored-worker-host-0",
                vec!["2026-03-28T12:00:01.000Z", "2026-03-28T12:00:02.000Z"],
            ),
            _ => SequenceMetaSource::new(
                "ignored-worker-host-other",
                vec!["2026-03-28T12:00:03.000Z", "2026-03-28T12:00:04.000Z"],
            ),
        },
        |_job| async {
            Ok::<serde_json::Value, JobProcessError<String>>(json!({ "processed": true }))
        },
        WorkerHostOptions::default(),
    )
    .await
    .expect("start worker host");

    let worker = await_worker_presence(
        &requester_client,
        headers.clone(),
        "documents",
        "documents-host-1",
    )
    .await;
    assert_eq!(worker.job_type, "document-process");
    assert_eq!(worker.concurrency, Some(1));

    let create_manager = JobManager::new(
        NatsJobEventPublisher::new(service_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new("job-worker-host-1", vec!["2026-03-28T12:00:00.000Z"]),
    );
    let created_job = create_manager
        .create(
            "document-process",
            json!({ "documentId": "doc-worker-host-1" }),
        )
        .await
        .expect("create should publish created event");

    worker_client
        .publish(
            "trellis.work.documents.document-process".to_string(),
            serde_json::to_vec(&created_event(
                &created_job.service,
                &created_job.job_type,
                &created_job.id,
                created_job.payload.clone(),
                created_job.max_tries,
                &created_job.created_at,
                created_job.deadline.as_deref(),
            ))
            .expect("serialize created work event")
            .into(),
        )
        .await
        .expect("publish work item");

    let projected = await_projected_job_state(
        &requester_client,
        headers,
        "job-worker-host-1",
        JobState::Completed,
    )
    .await;
    assert_eq!(projected.result, Some(json!({ "processed": true })));

    worker_host.stop().await.expect("stop worker host");

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn start_worker_host_from_binding_honors_queue_concurrency() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let worker_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let _infra = seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let mut runtime_binding = JobsRuntimeBinding::try_from(
        &FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        }
        .binding(),
    )
    .expect("runtime binding");
    runtime_binding
        .jobs
        .queues
        .get_mut("document-process")
        .expect("document-process queue")
        .concurrency = 2;

    let worker_host = start_worker_host_from_binding(
        worker_client.clone(),
        runtime_binding,
        "documents-host-concurrency-1".to_string(),
        {
            let worker_client = worker_client.clone();
            move || NatsJobEventPublisher::new(worker_client.clone())
        },
        |_queue_type, worker_index| match worker_index {
            0 => SequenceMetaSource::new(
                "ignored-worker-concurrency-0",
                vec![
                    "2026-03-28T12:10:01.000Z",
                    "2026-03-28T12:10:02.000Z",
                    "2026-03-28T12:10:05.000Z",
                    "2026-03-28T12:10:06.000Z",
                ],
            ),
            _ => SequenceMetaSource::new(
                "ignored-worker-concurrency-1",
                vec![
                    "2026-03-28T12:10:03.000Z",
                    "2026-03-28T12:10:04.000Z",
                    "2026-03-28T12:10:07.000Z",
                    "2026-03-28T12:10:08.000Z",
                ],
            ),
        },
        |_job| async {
            Ok::<serde_json::Value, JobProcessError<String>>(json!({ "processed": true }))
        },
        WorkerHostOptions::default(),
    )
    .await
    .expect("start worker host with concurrency");
    assert_eq!(worker_host.worker_count(), 2);
    let worker = await_worker_presence(
        &requester_client,
        headers.clone(),
        "documents",
        "documents-host-concurrency-1",
    )
    .await;
    assert_eq!(worker.concurrency, Some(2));
    assert_eq!(worker.job_type, "document-process");

    let create_manager_a = JobManager::new(
        NatsJobEventPublisher::new(service_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new("job-concurrency-a", vec!["2026-03-28T12:10:00.000Z"]),
    );
    let create_manager_b = JobManager::new(
        NatsJobEventPublisher::new(service_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new("job-concurrency-b", vec!["2026-03-28T12:10:00.100Z"]),
    );
    let created_job_a = create_manager_a
        .create(
            "document-process",
            json!({ "documentId": "doc-concurrency-a" }),
        )
        .await
        .expect("create job a");
    let created_job_b = create_manager_b
        .create(
            "document-process",
            json!({ "documentId": "doc-concurrency-b" }),
        )
        .await
        .expect("create job b");

    for created_job in [created_job_a, created_job_b] {
        worker_client
            .publish(
                "trellis.work.documents.document-process".to_string(),
                serde_json::to_vec(&created_event(
                    &created_job.service,
                    &created_job.job_type,
                    &created_job.id,
                    created_job.payload.clone(),
                    created_job.max_tries,
                    &created_job.created_at,
                    created_job.deadline.as_deref(),
                ))
                .expect("serialize created work event")
                .into(),
            )
            .await
            .expect("publish work item");
    }

    let projected_a = await_projected_job_state(
        &requester_client,
        headers.clone(),
        "job-concurrency-a",
        JobState::Completed,
    )
    .await;
    let projected_b = await_projected_job_state(
        &requester_client,
        headers,
        "job-concurrency-b",
        JobState::Completed,
    )
    .await;
    assert_eq!(projected_a.result, Some(json!({ "processed": true })));
    assert_eq!(projected_b.result, Some(json!({ "processed": true })));

    worker_host
        .stop()
        .await
        .expect("stop concurrent worker host");
    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_does_not_process_work_if_job_was_cancelled_before_worker_startup(
) {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let worker_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let (_jobs_kv, _services_kv) =
        seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let create_manager = JobManager::new(
        NatsJobEventPublisher::new(service_client.clone()),
        sample_jobs_binding(),
        SequenceMetaSource::new(
            "job-cancel-before-worker-1",
            vec!["2026-03-28T12:00:00.000Z"],
        ),
    );
    let created_job = create_manager
        .create(
            "document-process",
            json!({ "documentId": "doc-cancel-before-start" }),
        )
        .await
        .expect("create should publish created event");

    let pending = await_projected_job_state(
        &requester_client,
        headers.clone(),
        "job-cancel-before-worker-1",
        JobState::Pending,
    )
    .await;
    assert_eq!(pending.state, JobState::Pending);

    worker_client
        .publish(
            "trellis.work.documents.document-process".to_string(),
            serde_json::to_vec(&created_event(
                &created_job.service,
                &created_job.job_type,
                &created_job.id,
                created_job.payload.clone(),
                created_job.max_tries,
                &created_job.created_at,
                created_job.deadline.as_deref(),
            ))
            .expect("serialize created work event")
            .into(),
        )
        .await
        .expect("publish work item");

    requester_client
        .request_with_headers(
            rpc::JobsCancelRpc::SUBJECT.to_string(),
            headers.clone(),
            serde_json::to_vec(&json!({
                "service": "documents",
                "jobType": "document-process",
                "id": "job-cancel-before-worker-1"
            }))
            .expect("serialize cancel payload")
            .into(),
        )
        .await
        .expect("cancel should reply");

    let cancelled = await_projected_job_state(
        &requester_client,
        headers.clone(),
        "job-cancel-before-worker-1",
        JobState::Cancelled,
    )
    .await;
    assert_eq!(cancelled.state, JobState::Cancelled);

    let handler_calls = Arc::new(AtomicUsize::new(0));
    let runtime_binding = JobsRuntimeBinding::try_from(
        &FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket: service_instances_bucket.clone(),
        }
        .binding(),
    )
    .expect("runtime binding");
    let started_subject = job_event_subject(
        "documents",
        "document-process",
        "job-cancel-before-worker-1",
        trellis_jobs::JobEventType::Started,
    );
    let mut started_subscriber = requester_client
        .subscribe(started_subject)
        .await
        .expect("subscribe started subject");
    let worker_task = tokio::spawn(run_single_queue_worker_from_binding(
        worker_client,
        runtime_binding,
        "document-process",
        NatsJobEventPublisher::new(service_client.clone()),
        SequenceMetaSource::new(
            "job-cancel-before-worker-1",
            vec!["2026-03-28T12:00:01.000Z", "2026-03-28T12:00:02.000Z"],
        ),
        {
            let handler_calls = Arc::clone(&handler_calls);
            move |_job| {
                let handler_calls = Arc::clone(&handler_calls);
                async move {
                    handler_calls.fetch_add(1, Ordering::SeqCst);
                    Ok::<serde_json::Value, JobProcessError<String>>(json!({
                        "processed": true,
                    }))
                }
            }
        },
    ));

    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(handler_calls.load(Ordering::SeqCst), 0);
    assert!(
        tokio::time::timeout(Duration::from_millis(200), started_subscriber.next())
            .await
            .is_err(),
        "worker should not emit started after pre-start cancellation"
    );

    worker_task.abort();
    let _ = worker_task.await;
    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_janitor_once_publishes_expired_events_and_projector_materializes_state() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let (jobs_kv, _services_kv) =
        seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let mut overdue_active = sample_job(
        "job-overdue-active",
        "2026-03-28T11:59:00.000Z",
        JobState::Active,
    );
    overdue_active.deadline = Some("2026-03-28T12:00:00.000Z".to_string());

    let mut future_active = sample_job(
        "job-future-active",
        "2026-03-28T11:59:00.000Z",
        JobState::Active,
    );
    future_active.deadline = Some("2026-03-28T12:10:00.000Z".to_string());

    let mut overdue_completed = sample_job(
        "job-overdue-completed",
        "2026-03-28T11:59:00.000Z",
        JobState::Completed,
    );
    overdue_completed.deadline = Some("2026-03-28T12:00:00.000Z".to_string());

    jobs_kv
        .put(
            "documents.document-process.job-overdue-active",
            serde_json::to_vec(&overdue_active)
                .expect("serialize overdue active job")
                .into(),
        )
        .await
        .expect("seed overdue active job");
    jobs_kv
        .put(
            "documents.document-process.job-future-active",
            serde_json::to_vec(&future_active)
                .expect("serialize future active job")
                .into(),
        )
        .await
        .expect("seed future active job");
    jobs_kv
        .put(
            "documents.document-process.job-overdue-completed",
            serde_json::to_vec(&overdue_completed)
                .expect("serialize overdue completed job")
                .into(),
        )
        .await
        .expect("seed overdue completed job");

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket,
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let stats = run_janitor_once(
        service_client.clone(),
        &jobs_state_bucket,
        "2026-03-28T12:01:00.000Z",
    )
    .await
    .expect("janitor run should succeed");

    assert_eq!(stats.scanned, 3);
    assert_eq!(stats.eligible, 1);
    assert_eq!(stats.published, 1);

    let overdue_projected = await_projected_job_state(
        &requester_client,
        headers.clone(),
        "job-overdue-active",
        JobState::Expired,
    )
    .await;
    assert_eq!(
        overdue_projected.last_error.as_deref(),
        Some("job exceeded deadline")
    );

    let future_projected =
        await_projected_job(&requester_client, headers.clone(), "job-future-active").await;
    assert_eq!(future_projected.state, JobState::Active);

    let completed_projected =
        await_projected_job(&requester_client, headers, "job-overdue-completed").await;
    assert_eq!(completed_projected.state, JobState::Completed);

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_maps_max_deliveries_advisory_to_dead_event_and_projects_dead_state(
) {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let (jobs_kv, _services_kv) =
        seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let mut current = sample_job(
        "job-advisory-dead-1",
        "2026-03-28T11:59:00.000Z",
        JobState::Active,
    );
    current.tries = 2;
    jobs_kv
        .put(
            "documents.document-process.job-advisory-dead-1",
            serde_json::to_vec(&current)
                .expect("serialize current job")
                .into(),
        )
        .await
        .expect("seed active projected job");

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client.clone(),
        FakeCoreClient {
            jobs_state_bucket: jobs_state_bucket.clone(),
            service_instances_bucket,
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    await_jobs_health(&requester_client, headers.clone()).await;

    let ack = js
        .publish(
            "trellis.work.documents.document-process".to_string(),
            serde_json::to_vec(&created_event(
                &current.service,
                &current.job_type,
                &current.id,
                current.payload.clone(),
                current.max_tries,
                &current.updated_at,
                current.deadline.as_deref(),
            ))
            .expect("serialize work event")
            .into(),
        )
        .await
        .expect("publish work message")
        .await
        .expect("await publish ack");

    let dead_subject = "trellis.jobs.documents.document-process.job-advisory-dead-1.dead";
    let mut dead_subscriber = requester_client
        .subscribe(dead_subject.to_string())
        .await
        .expect("subscribe dead event subject");

    let advisory_payload = json!({
        "stream": "JOBS_WORK",
        "consumer": "documents-document-process",
        "stream_seq": ack.sequence,
        "deliveries": 5,
        "timestamp": "2026-03-28T12:03:00.000Z"
    });
    service_client
        .publish(
            "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.documents-document-process"
                .to_string(),
            serde_json::to_vec(&advisory_payload)
                .expect("serialize advisory payload")
                .into(),
        )
        .await
        .expect("publish max deliveries advisory");

    let dead_message = tokio::time::timeout(Duration::from_secs(3), dead_subscriber.next())
        .await
        .expect("dead event should arrive before timeout")
        .expect("dead event should be present");
    let dead_event_json: serde_json::Value =
        serde_json::from_slice(&dead_message.payload).expect("decode dead event payload");
    assert_eq!(dead_event_json["eventType"], json!("dead"));
    assert_eq!(dead_event_json["state"], json!("dead"));
    assert_eq!(dead_event_json["tries"], json!(5));

    let projected = await_projected_job_state(
        &requester_client,
        headers,
        "job-advisory-dead-1",
        JobState::Dead,
    )
    .await;
    assert_eq!(projected.state, JobState::Dead);
    assert_eq!(projected.tries, 5);
    assert!(projected
        .last_error
        .as_deref()
        .unwrap_or_default()
        .contains("max deliveries exceeded"));

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_serves_jobs_dlq_list_replay_and_dismiss() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let (jobs_kv, _services_kv) =
        seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let mut dead1 = sample_job("job-dead-1", "2026-03-28T11:59:00.000Z", JobState::Dead);
    dead1.last_error = Some("dlq-1".to_string());
    dead1.tries = 5;
    let mut dead2 = sample_job("job-dead-2", "2026-03-28T11:59:00.000Z", JobState::Dead);
    dead2.last_error = Some("dlq-2".to_string());
    dead2.tries = 5;
    let active = sample_job("job-active-1", "2026-03-28T11:59:00.000Z", JobState::Active);

    jobs_kv
        .put(
            "documents.document-process.job-dead-1",
            serde_json::to_vec(&dead1).expect("serialize dead1").into(),
        )
        .await
        .expect("seed dead1");
    jobs_kv
        .put(
            "documents.document-process.job-dead-2",
            serde_json::to_vec(&dead2).expect("serialize dead2").into(),
        )
        .await
        .expect("seed dead2");
    jobs_kv
        .put(
            "documents.document-process.job-active-1",
            serde_json::to_vec(&active)
                .expect("serialize active")
                .into(),
        )
        .await
        .expect("seed active");

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client,
        FakeCoreClient {
            jobs_state_bucket,
            service_instances_bucket,
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");

    let list_dlq_response = requester_client
        .request_with_headers(
            rpc::JobsListDLQRpc::SUBJECT.to_string(),
            headers.clone(),
            Bytes::from_static(b"{}"),
        )
        .await
        .expect("list dlq should reply");
    let list_dlq_payload: JobsListDLQResponse =
        serde_json::from_slice(&list_dlq_response.payload).expect("decode list dlq");
    assert_eq!(list_dlq_payload.jobs.len(), 2);
    assert!(list_dlq_payload
        .jobs
        .iter()
        .all(|job| map_job_from_wire(job).state == JobState::Dead));

    let replay_payload = serde_json::to_vec(&json!({
        "service": "documents",
        "jobType": "document-process",
        "id": "job-dead-1"
    }))
    .expect("serialize replay payload");
    let replay_response = requester_client
        .request_with_headers(
            rpc::JobsReplayDLQRpc::SUBJECT.to_string(),
            headers.clone(),
            replay_payload.into(),
        )
        .await
        .expect("replay dlq should reply");
    let replay_json: serde_json::Value =
        serde_json::from_slice(&replay_response.payload).expect("decode replay response");
    assert_eq!(replay_json["job"]["state"], json!("pending"));

    let dismiss_payload = serde_json::to_vec(&json!({
        "service": "documents",
        "jobType": "document-process",
        "id": "job-dead-2"
    }))
    .expect("serialize dismiss payload");
    let dismiss_response = requester_client
        .request_with_headers(
            rpc::JobsDismissDLQRpc::SUBJECT.to_string(),
            headers.clone(),
            dismiss_payload.into(),
        )
        .await
        .expect("dismiss dlq should reply");
    let dismiss_json: serde_json::Value =
        serde_json::from_slice(&dismiss_response.payload).expect("decode dismiss response");
    assert_eq!(dismiss_json["job"]["state"], json!("dismissed"));

    let list_after_response = requester_client
        .request_with_headers(
            rpc::JobsListDLQRpc::SUBJECT.to_string(),
            headers.clone(),
            Bytes::from_static(b"{}"),
        )
        .await
        .expect("list dlq after should reply");
    let list_after_payload: JobsListResponse =
        serde_json::from_slice(&list_after_response.payload).expect("decode list after");
    assert_eq!(list_after_payload.jobs.len(), 0);

    let get_removed_payload = serde_json::to_vec(&JobsGetRequest {
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        id: "job-dead-2".to_string(),
    })
    .expect("serialize get removed payload");
    let get_removed_response = requester_client
        .request_with_headers(
            rpc::JobsGetRpc::SUBJECT.to_string(),
            headers,
            get_removed_payload.into(),
        )
        .await
        .expect("get removed should reply");
    let get_removed: JobsGetResponse =
        serde_json::from_slice(&get_removed_response.payload).expect("decode get removed");
    let removed_job = get_removed
        .job
        .expect("dismissed dlq job should remain queryable");
    assert_eq!(map_job_from_wire(&removed_job).state, JobState::Dismissed);

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
async fn run_jobs_service_with_clients_rejects_invalid_mutation_states() {
    let (_container, server) = start_nats_container();
    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let jobs_state_bucket = unique_name("jobs_state");
    let service_instances_bucket = unique_name("service_instances");
    let js = jetstream::new(service_client.clone());
    let (jobs_kv, _services_kv) =
        seed_jobs_infrastructure(&js, &jobs_state_bucket, &service_instances_bucket).await;

    let completed = sample_job(
        "job-completed-1",
        "2026-01-03T00:00:00Z",
        JobState::Completed,
    );
    let pending = sample_job("job-pending-1", "2026-01-03T00:00:00Z", JobState::Pending);
    let active = sample_job("job-active-1", "2026-01-03T00:00:00Z", JobState::Active);

    for job in [&completed, &pending, &active] {
        jobs_kv
            .put(
                format!("{}.{}.{}", job.service, job.job_type, job.id),
                serde_json::to_vec(job)
                    .expect("serialize seeded job")
                    .into(),
            )
            .await
            .expect("seed job");
    }

    let loop_task = tokio::spawn(run_jobs_service_with_clients(
        service_client,
        FakeCoreClient {
            jobs_state_bucket,
            service_instances_bucket,
        },
        FakeAuthValidateClient,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");

    let cancel_completed = requester_client
        .request_with_headers(
            rpc::JobsCancelRpc::SUBJECT.to_string(),
            headers.clone(),
            serde_json::to_vec(&json!({
                "service": "documents",
                "jobType": "document-process",
                "id": "job-completed-1"
            }))
            .expect("serialize cancel payload")
            .into(),
        )
        .await
        .expect("cancel completed should reply");
    let cancel_completed_headers = cancel_completed.headers.expect("cancel error headers");
    let cancel_completed_json: serde_json::Value =
        serde_json::from_slice(&cancel_completed.payload).expect("decode cancel error");
    assert_eq!(
        cancel_completed_headers.get("status").unwrap().as_str(),
        "error"
    );
    let cancel_completed_error = cancel_completed_json["error"]
        .as_str()
        .expect("cancel error string");
    assert!(cancel_completed_error.contains("job state conflict"));
    assert!(cancel_completed_error.contains("completed"));

    let retry_pending = requester_client
        .request_with_headers(
            rpc::JobsRetryRpc::SUBJECT.to_string(),
            headers.clone(),
            serde_json::to_vec(&json!({
                "service": "documents",
                "jobType": "document-process",
                "id": "job-pending-1"
            }))
            .expect("serialize retry payload")
            .into(),
        )
        .await
        .expect("retry pending should reply");
    let retry_pending_headers = retry_pending.headers.expect("retry error headers");
    let retry_pending_json: serde_json::Value =
        serde_json::from_slice(&retry_pending.payload).expect("decode retry error");
    assert_eq!(
        retry_pending_headers.get("status").unwrap().as_str(),
        "error"
    );
    let retry_pending_error = retry_pending_json["error"]
        .as_str()
        .expect("retry error string");
    assert!(retry_pending_error.contains("job state conflict"));
    assert!(retry_pending_error.contains("pending"));

    let dismiss_active = requester_client
        .request_with_headers(
            rpc::JobsDismissDLQRpc::SUBJECT.to_string(),
            headers,
            serde_json::to_vec(&json!({
                "service": "documents",
                "jobType": "document-process",
                "id": "job-active-1"
            }))
            .expect("serialize dismiss payload")
            .into(),
        )
        .await
        .expect("dismiss active should reply");
    let dismiss_active_headers = dismiss_active.headers.expect("dismiss error headers");
    let dismiss_active_json: serde_json::Value =
        serde_json::from_slice(&dismiss_active.payload).expect("decode dismiss error");
    assert_eq!(
        dismiss_active_headers.get("status").unwrap().as_str(),
        "error"
    );
    let dismiss_active_error = dismiss_active_json["error"]
        .as_str()
        .expect("dismiss error string");
    assert!(dismiss_active_error.contains("job state conflict"));
    assert!(dismiss_active_error.contains("active"));

    loop_task.abort();
    let _ = loop_task.await;
}
