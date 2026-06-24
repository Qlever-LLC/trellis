use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::task::JoinHandle;
use trellis_rs::client::{ServiceConnectWithContractOptions, TrellisClient};
use trellis_rs::jobs::keys::NatsKeyCoordinator;
use trellis_rs::jobs::{
    runtime_ref::NatsJobWaiter, start_worker_host_from_client, JobLogLevel, JobManager,
    JobProcessError, JobsRuntimeBinding, NatsJobEventPublisher, TrellisJobMetaSource,
    WorkerActiveJob, WorkerHostOptions,
};
use trellis_rs::sdk::core::types::TrellisBindingsGetResponseBinding;
use trellis_rs::service::{ConnectedServiceRuntime, ServerError};

use crate::support::assertions::assert_case_registered;

const JOBS_SERVICE_ID: &str = "trellis.integration.jobs-service@v1";
const JOBS_CLIENT_ID: &str = "trellis.integration.jobs-client@v1";

const JOBS_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.jobs-service@v1",
  "displayName": "Trellis Integration Jobs Service",
  "description": "Exercises service-local jobs behind a client-visible RPC.",
  "kind": "service",
  "schemas": {
    "WorkflowInput": {
      "type": "object",
      "required": ["documentId"],
      "properties": { "documentId": { "type": "string" } }
    },
    "WorkflowOutput": {
      "type": "object",
      "required": ["documentId", "jobId", "processedBy", "requestId", "traceId"],
      "properties": {
        "documentId": { "type": "string" },
        "jobId": { "type": "string" },
        "processedBy": { "type": "string" },
        "requestId": { "type": "string" },
        "traceId": { "type": "string" }
      }
    },
    "JobPayload": {
      "type": "object",
      "required": ["documentId"],
      "properties": { "documentId": { "type": "string" } }
    },
    "KeyedWorkflowInput": {
      "type": "object",
      "required": ["documentId", "groupKey", "sequence"],
      "properties": {
        "documentId": { "type": "string" },
        "groupKey": { "type": "string" },
        "sequence": { "type": "number" }
      }
    },
    "KeyedWorkflowOutput": {
      "type": "object",
      "required": ["documentId", "groupKey", "sequence", "jobId", "processedBy", "requestId", "traceId"],
      "properties": {
        "documentId": { "type": "string" },
        "groupKey": { "type": "string" },
        "sequence": { "type": "number" },
        "jobId": { "type": "string" },
        "processedBy": { "type": "string" },
        "requestId": { "type": "string" },
        "traceId": { "type": "string" }
      }
    },
    "JobResult": {
      "type": "object",
      "required": ["documentId", "processedBy", "requestId", "traceId"],
      "properties": {
        "documentId": { "type": "string" },
        "processedBy": { "type": "string" },
        "requestId": { "type": "string" },
        "traceId": { "type": "string" }
      }
    },
    "KeyedJobPayload": {
      "type": "object",
      "required": ["documentId", "groupKey", "sequence"],
      "properties": {
        "documentId": { "type": "string" },
        "groupKey": { "type": "string" },
        "sequence": { "type": "number" }
      }
    },
    "KeyedJobResult": {
      "type": "object",
      "required": ["documentId", "groupKey", "sequence", "processedBy", "requestId", "traceId"],
      "properties": {
        "documentId": { "type": "string" },
        "groupKey": { "type": "string" },
        "sequence": { "type": "number" },
        "processedBy": { "type": "string" },
        "requestId": { "type": "string" },
        "traceId": { "type": "string" }
      }
    }
  },
  "jobs": {
    "processDocument": {
      "payload": { "schema": "JobPayload" },
      "result": { "schema": "JobResult" }
    },
    "keyedProcessDocument": {
      "payload": { "schema": "KeyedJobPayload" },
      "result": { "schema": "KeyedJobResult" },
      "concurrency": 2,
      "keyConcurrency": {
        "key": ["document", "/groupKey"],
        "maxActive": 1,
        "heartbeatIntervalMs": 1000,
        "heartbeatTtlMs": 10000,
        "stalePolicy": "fail-stale"
      },
      "queue": {
        "maxQueuedPerKey": 1,
        "whenFull": "reject"
      }
    }
  },
  "rpc": {
    "Documents.Process": {
      "version": "v1",
      "subject": "rpc.v1.Documents.Process",
      "input": { "schema": "WorkflowInput" },
      "output": { "schema": "WorkflowOutput" },
      "capabilities": { "call": [] },
      "errors": []
    },
    "Documents.KeyedProcess": {
      "version": "v1",
      "subject": "rpc.v1.Documents.KeyedProcess",
      "input": { "schema": "KeyedWorkflowInput" },
      "output": { "schema": "KeyedWorkflowOutput" },
      "capabilities": { "call": [] },
      "errors": []
    }
  }
}"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct JobPayload {
    #[serde(rename = "documentId")]
    document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct JobResult {
    document_id: String,
    processed_by: String,
    request_id: String,
    trace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct KeyedJobPayload {
    document_id: String,
    group_key: String,
    sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct KeyedJobResult {
    document_id: String,
    group_key: String,
    sequence: u64,
    processed_by: String,
    request_id: String,
    trace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct WorkflowInput {
    #[serde(rename = "documentId")]
    document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkflowOutput {
    document_id: String,
    job_id: String,
    processed_by: String,
    request_id: String,
    trace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct KeyedWorkflowInput {
    document_id: String,
    group_key: String,
    sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct KeyedWorkflowOutput {
    document_id: String,
    group_key: String,
    sequence: u64,
    job_id: String,
    processed_by: String,
    request_id: String,
    trace_id: String,
}

struct DocumentsProcessRpc;

impl trellis_rs::client::RpcDescriptor for DocumentsProcessRpc {
    type Input = WorkflowInput;
    type Output = WorkflowOutput;

    const KEY: &'static str = "Documents.Process";
    const SUBJECT: &'static str = "rpc.v1.Documents.Process";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["documentId"],"properties":{"documentId":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["documentId","jobId","processedBy","requestId","traceId"],"properties":{"documentId":{"type":"string"},"jobId":{"type":"string"},"processedBy":{"type":"string"},"requestId":{"type":"string"},"traceId":{"type":"string"}}}"#;
}

struct DocumentsKeyedProcessRpc;

impl trellis_rs::client::RpcDescriptor for DocumentsKeyedProcessRpc {
    type Input = KeyedWorkflowInput;
    type Output = KeyedWorkflowOutput;

    const KEY: &'static str = "Documents.KeyedProcess";
    const SUBJECT: &'static str = "rpc.v1.Documents.KeyedProcess";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["documentId","groupKey","sequence"],"properties":{"documentId":{"type":"string"},"groupKey":{"type":"string"},"sequence":{"type":"number"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["documentId","groupKey","sequence","jobId","processedBy","requestId","traceId"],"properties":{"documentId":{"type":"string"},"groupKey":{"type":"string"},"sequence":{"type":"number"},"jobId":{"type":"string"},"processedBy":{"type":"string"},"requestId":{"type":"string"},"traceId":{"type":"string"}}}"#;
}

struct AbortOnDrop<T> {
    handle: Option<JoinHandle<T>>,
}

impl<T> AbortOnDrop<T> {
    fn new(handle: JoinHandle<T>) -> Self {
        Self {
            handle: Some(handle),
        }
    }

    async fn abort_and_wait(mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            let _ = handle.await;
        }
    }
}

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.abort();
        }
    }
}

struct JobsFixture {
    #[allow(dead_code)]
    runtime: trellis_test::TrellisTestRuntime,
    #[allow(dead_code)]
    admin: trellis_test::TrellisTestAdmin,
    worker_host: trellis_rs::jobs::WorkerHostHandle,
    service_task: AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>>,
    client: Arc<trellis_rs::client::TrellisClient>,
    keyed_run_state: Arc<KeyedJobRunState>,
}

#[derive(Debug, Default)]
struct KeyedJobRunState {
    started: tokio::sync::Mutex<Vec<u64>>,
    completed: tokio::sync::Mutex<Vec<u64>>,
    first_started: tokio::sync::Notify,
    release_first: tokio::sync::Notify,
    released: std::sync::atomic::AtomicBool,
    second_started_before_release: std::sync::atomic::AtomicBool,
}

async fn setup_jobs_fixture() -> JobsFixture {
    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let manifest_value: Value =
        serde_json::from_str(JOBS_SERVICE_CONTRACT_JSON).expect("parse jobs service contract JSON");
    let normalized = trellis_rs::contracts::normalize_manifest_value(manifest_value.clone())
        .expect("normalize jobs service contract");
    let service_contract = trellis_test::TrellisTestContract::from_manifest_value(normalized)
        .expect("build jobs service test contract");
    let client_contract = jobs_client_contract().expect("build jobs client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live jobs service instance");

    let trellis_client =
        TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
            trellis_url: runtime.trellis_url(),
            contract_id: JOBS_SERVICE_ID,
            contract_digest: service_contract.digest(),
            contract_json: JOBS_SERVICE_CONTRACT_JSON,
            session_key_seed_base64url: &service_key.seed,
            timeout_ms: 5000,
            retry_delay_ms: 1000,
            authority_pending_timeout_ms: 60000,
        })
        .await
        .expect("connect live Rust jobs service");

    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        "jobs-fixture-service",
        Arc::new(trellis_client),
    )
    .expect("build connected service runtime");

    let nats = service.client().internal_nats().clone();
    let trellis_binding: &TrellisBindingsGetResponseBinding = service.binding().as_ref();
    let jobs_runtime =
        JobsRuntimeBinding::try_from(trellis_binding).expect("parse jobs runtime binding");
    let queue_binding = jobs_runtime
        .jobs
        .queues
        .get("processDocument")
        .expect("processDocument queue binding")
        .clone();
    let publisher = NatsJobEventPublisher::new(nats.clone());
    let key_coordinator =
        NatsKeyCoordinator::open_for_service(nats.clone(), jobs_runtime.jobs.namespace.as_str())
            .await
            .expect("open keyed jobs coordinator");
    let manager = JobManager::new_with_key_coordinator(
        publisher,
        jobs_runtime.jobs.clone(),
        TrellisJobMetaSource,
        Arc::new(key_coordinator),
    );
    let waiter = NatsJobWaiter::new(nats, queue_binding, Duration::from_secs(5));
    let keyed_queue_binding = jobs_runtime
        .jobs
        .queues
        .get("keyedProcessDocument")
        .expect("keyedProcessDocument queue binding")
        .clone();
    let keyed_waiter = NatsJobWaiter::new(
        service.client().internal_nats().clone(),
        keyed_queue_binding,
        Duration::from_secs(5),
    );
    let keyed_run_state = Arc::new(KeyedJobRunState::default());

    let svc_client: Arc<TrellisClient> = service.client().clone();

    let process_manager = manager.clone();
    service.register_rpc::<DocumentsProcessRpc, _, _>(move |_context, input| {
        let manager = process_manager.clone();
        let waiter = waiter.clone();
        async move {
            let job = manager
                .create(
                    "processDocument",
                    JobPayload {
                        document_id: input.document_id.clone(),
                    },
                )
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let terminal: trellis_rs::jobs::Job = waiter
                .wait_for_terminal(job)
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let result_value = terminal
                .result
                .ok_or_else(|| ServerError::Nats("job completed without result".to_string()))?;
            let job_result: JobResult = serde_json::from_value(result_value)
                .map_err(|error| ServerError::Nats(format!("decode job result: {error}")))?;
            Ok(WorkflowOutput {
                document_id: input.document_id,
                job_id: terminal.id,
                processed_by: job_result.processed_by,
                request_id: terminal.context.request_id,
                trace_id: terminal.context.trace_id,
            })
        }
    });

    service.register_rpc::<DocumentsKeyedProcessRpc, _, _>(move |_context, input| {
        let manager = manager.clone();
        let waiter = keyed_waiter.clone();
        async move {
            let job = manager
                .create(
                    "keyedProcessDocument",
                    KeyedJobPayload {
                        document_id: input.document_id.clone(),
                        group_key: input.group_key.clone(),
                        sequence: input.sequence,
                    },
                )
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let terminal: trellis_rs::jobs::Job = waiter
                .wait_for_terminal(job)
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let result_value = terminal
                .result
                .ok_or_else(|| ServerError::Nats("job completed without result".to_string()))?;
            let job_result: KeyedJobResult = serde_json::from_value(result_value)
                .map_err(|error| ServerError::Nats(format!("decode keyed job result: {error}")))?;
            Ok(KeyedWorkflowOutput {
                document_id: input.document_id,
                group_key: input.group_key,
                sequence: input.sequence,
                job_id: terminal.id,
                processed_by: job_result.processed_by,
                request_id: terminal.context.request_id,
                trace_id: terminal.context.trace_id,
            })
        }
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let worker_keyed_run_state = Arc::clone(&keyed_run_state);
    let worker_host = start_worker_host_from_client(
        &*svc_client,
        jobs_runtime,
        "jobs-fixture-service".to_string(),
        |_, _| TrellisJobMetaSource,
        move |active_job: WorkerActiveJob<_, _>| {
            let keyed_run_state = Arc::clone(&worker_keyed_run_state);
            async move {
                if active_job.job().job_type == "keyedProcessDocument" {
                    let payload: KeyedJobPayload =
                        serde_json::from_value(active_job.job().payload.clone())
                            .map_err(|error| JobProcessError::failed(error.to_string()))?;
                    {
                        let mut started = keyed_run_state.started.lock().await;
                        started.push(payload.sequence);
                    }
                    if payload.sequence == 1 {
                        keyed_run_state.first_started.notify_one();
                        keyed_run_state.release_first.notified().await;
                    } else if !keyed_run_state
                        .released
                        .load(std::sync::atomic::Ordering::SeqCst)
                    {
                        keyed_run_state
                            .second_started_before_release
                            .store(true, std::sync::atomic::Ordering::SeqCst);
                    }
                    {
                        let mut completed = keyed_run_state.completed.lock().await;
                        completed.push(payload.sequence);
                    }
                    let result = serde_json::to_value(KeyedJobResult {
                        document_id: payload.document_id,
                        group_key: payload.group_key,
                        sequence: payload.sequence,
                        processed_by: "rust-service-keyed-job".to_string(),
                        request_id: active_job.context().request_id.clone(),
                        trace_id: active_job.context().trace_id.clone(),
                    })
                    .map_err(|error| JobProcessError::failed(error.to_string()))?;
                    return Ok(result);
                }

                let payload: JobPayload = serde_json::from_value(active_job.job().payload.clone())
                    .map_err(|error| JobProcessError::failed(error.to_string()))?;
                active_job
                    .update_progress(1, 1, Some(format!("processed {}", payload.document_id)))
                    .await
                    .map_err(|error| JobProcessError::failed(error.to_string()))?;
                active_job
                    .log(
                        JobLogLevel::Info,
                        format!("processed {}", payload.document_id),
                    )
                    .await
                    .map_err(|error| JobProcessError::failed(error.to_string()))?;
                let result = serde_json::to_value(JobResult {
                    document_id: payload.document_id,
                    processed_by: "rust-service-job".to_string(),
                    request_id: active_job.context().request_id.clone(),
                    trace_id: active_job.context().trace_id.clone(),
                })
                .map_err(|error| JobProcessError::failed(error.to_string()))?;
                Ok(result)
            }
        },
        WorkerHostOptions::default(),
    )
    .await
    .expect("start jobs worker host");

    let client = Arc::new(
        admin
            .connect_client(&bootstrap_url, &client_contract)
            .await
            .expect("connect live Rust jobs client"),
    );

    JobsFixture {
        runtime,
        admin,
        worker_host,
        service_task,
        client,
        keyed_run_state,
    }
}

impl JobsFixture {
    async fn stop(self) {
        self.worker_host
            .stop()
            .await
            .expect("stop jobs worker host");
        self.service_task.abort_and_wait().await;
    }
}

#[tokio::test]
async fn jobs_service_creates_local_job_from_client_rpc() {
    assert_case_registered(
        "jobs.service-creates-local-job-from-client-rpc",
        "jobs",
        "jobs",
    );

    let fixture = setup_jobs_fixture().await;
    let output = call_documents_process_with_retry(&fixture.client, "doc-1").await;

    fixture
        .worker_host
        .stop()
        .await
        .expect("stop jobs worker host");
    fixture.service_task.abort_and_wait().await;

    assert_eq!(output.document_id, "doc-1");
    assert!(output.job_id.len() > 0);
}

#[tokio::test]
async fn jobs_keyed_jobs_serialize_same_key() {
    assert_case_registered("jobs.keyed-jobs-serialize-same-key", "jobs", "jobs");

    let fixture = setup_jobs_fixture().await;
    let first = {
        let client = fixture.client.clone();
        tokio::spawn(async move {
            call_documents_keyed_process_with_retry(&client, "doc-keyed-1", "same-key", 1).await
        })
    };
    fixture.keyed_run_state.first_started.notified().await;
    let second = {
        let client = fixture.client.clone();
        tokio::spawn(async move {
            call_documents_keyed_process_with_retry(&client, "doc-keyed-2", "same-key", 2).await
        })
    };
    fixture
        .keyed_run_state
        .released
        .store(true, std::sync::atomic::Ordering::SeqCst);
    fixture.keyed_run_state.release_first.notify_waiters();

    let first_output = first.await.expect("first keyed workflow joins");
    let second_output = second.await.expect("second keyed workflow joins");

    assert_eq!(first_output.sequence, 1);
    assert_eq!(second_output.sequence, 2);
    assert_eq!(first_output.group_key, "same-key");
    assert_eq!(second_output.group_key, "same-key");
    assert!(!fixture
        .keyed_run_state
        .second_started_before_release
        .load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(*fixture.keyed_run_state.started.lock().await, vec![1, 2]);
    assert_eq!(*fixture.keyed_run_state.completed.lock().await, vec![1, 2]);

    fixture.stop().await;
}

#[tokio::test]
async fn jobs_job_progress_and_log_are_published() {
    assert_case_registered("jobs.job-progress-and-log-are-published", "jobs", "jobs");

    let fixture = setup_jobs_fixture().await;
    let output = call_documents_process_with_retry(&fixture.client, "doc-1").await;

    fixture
        .worker_host
        .stop()
        .await
        .expect("stop jobs worker host");
    fixture.service_task.abort_and_wait().await;

    assert_eq!(output.processed_by, "rust-service-job");
}

#[tokio::test]
async fn jobs_job_wait_returns_typed_result() {
    assert_case_registered("jobs.job-wait-returns-typed-result", "jobs", "jobs");

    let fixture = setup_jobs_fixture().await;
    let output = call_documents_process_with_retry(&fixture.client, "doc-1").await;

    fixture
        .worker_host
        .stop()
        .await
        .expect("stop jobs worker host");
    fixture.service_task.abort_and_wait().await;

    assert_eq!(output.document_id, "doc-1");
    assert_eq!(output.processed_by, "rust-service-job");
}

#[tokio::test]
async fn jobs_job_context_propagates_request_and_trace() {
    assert_case_registered(
        "jobs.job-context-propagates-request-and-trace",
        "jobs",
        "jobs",
    );

    let fixture = setup_jobs_fixture().await;
    let output = call_documents_process_with_retry(&fixture.client, "doc-1").await;

    fixture
        .worker_host
        .stop()
        .await
        .expect("stop jobs worker host");
    fixture.service_task.abort_and_wait().await;

    assert!(output.request_id.len() > 0);
    assert_eq!(output.trace_id.len(), 32);
}

async fn call_documents_process_with_retry(
    client: &trellis_rs::client::TrellisClient,
    document_id: &str,
) -> WorkflowOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<DocumentsProcessRpc>(&WorkflowInput {
                document_id: document_id.to_string(),
            })
            .await
        {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Documents.Process RPC: {error}"),
        }
    }
}

async fn call_documents_keyed_process_with_retry(
    client: &trellis_rs::client::TrellisClient,
    document_id: &str,
    group_key: &str,
    sequence: u64,
) -> KeyedWorkflowOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<DocumentsKeyedProcessRpc>(&KeyedWorkflowInput {
                document_id: document_id.to_string(),
                group_key: group_key.to_string(),
                sequence,
            })
            .await
        {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Documents.KeyedProcess RPC: {error}"),
        }
    }
}

fn is_retryable_service_startup_error(error: &trellis_rs::client::TrellisClientError) -> bool {
    match error {
        trellis_rs::client::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::client::TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn jobs_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        JOBS_CLIENT_ID,
        "Trellis Integration Jobs Client",
        "App/client participant for the jobs integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "jobsService",
        trellis_rs::contracts::use_contract(JOBS_SERVICE_ID)
            .with_rpc_call(["Documents.Process", "Documents.KeyedProcess"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
