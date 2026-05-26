use std::collections::{BTreeMap, VecDeque};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use miette::{miette, IntoDiagnostic, Result};
use serde_json::{json, Value};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use trellis::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis::client::{ServiceConnectOptions, TrellisClient};
use trellis::contracts::{
    digest_contract_json, job_queue, schema_ref, use_contract, ContractKind,
    ContractManifestBuilder,
};
use trellis::jobs::{
    completed_event, created_event, dead_event, failed_event, start_worker_host_from_binding,
    started_event, JobCancellationToken, JobManager, JobMetaSource, JobProcessError,
    JobProcessOutcome, JobsRuntimeBinding, NatsJobEventPublisher, WorkerHostOptions,
};
use trellis::jobs::{
    job_event_subject, worker_heartbeat_subject, Job, JobContext, JobEvent, JobLogLevel,
    WorkerHeartbeat,
};
use trellis::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis::sdk::auth::types::AuthEnvelopesExpandRequest;
use trellis::sdk::core::types::TrellisBindingsGetResponseBinding;
use trellis::sdk::jobs::client::JobsClient;
use trellis::sdk::jobs::types::{
    JobsCancelRequest, JobsDismissDLQRequest, JobsGetRequest, JobsListDLQRequest, JobsListRequest,
    JobsListServicesRequest, JobsListServicesResponseEntriesItemWorkersItem, JobsReplayDLQRequest,
    JobsRetryRequest,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::deno_fixture::{deno_fixture_log_paths, deno_fixture_path};
use crate::workspace::repo_root;

const JOBS_DEPLOYMENT_ID: &str = "harness.jobs-admin";
const JOBS_SERVICE_INSTANCE_ID: &str = "harness-jobs-rust";
const HARNESS_JOBS_SERVICE: &str = "harness-jobs-documents";
const HARNESS_JOBS_QUEUE: &str = "document-process";
const LOCAL_JOBS_DEPLOYMENT_ID: &str = "harness.jobs-local";
const LOCAL_JOBS_CONTRACT_ID: &str = "trellis.integration-harness.jobs-local@v1";
const LOCAL_RUST_QUEUE: &str = "rustProcess";
const LOCAL_RUST_SHUTDOWN_QUEUE: &str = "rustShutdown";
const LOCAL_TS_QUEUE: &str = "tsProcess";
const LOCAL_RUST_WORKER_CONSUMER: &str = "harness-local-jobs-rust-worker";
const PASSING_CASES: usize = 29;

#[derive(Debug, Clone, Copy)]
enum JobsAdminServiceMode {
    Owner,
    RpcOnly,
}

fn local_jobs_service_contract_json() -> Result<String> {
    let payload_schema = json!({
        "type": "object",
        "properties": {
            "documentId": { "type": "string" }
        },
        "required": ["documentId"]
    });
    let result_schema = json!({
        "type": "object",
        "properties": {
            "documentId": { "type": "string" },
            "processedBy": { "type": "string" },
            "requestId": { "type": "string" },
            "traceId": { "type": "string" },
            "traceparent": { "type": "string" }
        },
        "required": ["documentId", "processedBy"]
    });
    let manifest = ContractManifestBuilder::new(
        LOCAL_JOBS_CONTRACT_ID,
        "Trellis Integration Harness Service-Local Jobs",
        "Harness-owned service contract for full-stack service-local Jobs verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("JobPayload", payload_schema)
    .schema("JobResult", result_schema)
    .job_queue(
        LOCAL_RUST_QUEUE,
        job_queue(schema_ref("JobPayload"), Some(schema_ref("JobResult"))),
    )
    .job_queue(
        LOCAL_RUST_SHUTDOWN_QUEUE,
        job_queue(schema_ref("JobPayload"), Some(schema_ref("JobResult"))),
    )
    .job_queue(
        LOCAL_TS_QUEUE,
        job_queue(schema_ref("JobPayload"), Some(schema_ref("JobResult"))),
    )
    .build()
    .map_err(|error| miette!("failed to build service-local Jobs contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize service-local Jobs contract: {error}"))
}

pub(crate) async fn run_jobs_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis::auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(JOBS_DEPLOYMENT_ID, vec!["trellis".to_string()])
        .await
        .into_diagnostic()?;

    let jobs_contract_json = trellis::sdk::jobs::contract::CONTRACT_JSON;
    let jobs_contract_digest = digest_contract_json(jobs_contract_json).into_diagnostic()?;
    SdkAuthClient::new(&admin_client)
        .rpc()
        .auth()
        .envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(jobs_contract_json)?,
            deployment_id: JOBS_DEPLOYMENT_ID.to_string(),
            expected_digest: jobs_contract_digest,
        })
        .await
        .into_diagnostic()?;

    let (jobs_service_seed, jobs_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: JOBS_DEPLOYMENT_ID.to_string(),
            instance_key: jobs_service_key,
        })
        .await
        .into_diagnostic()?;

    let jobs_db_path = std::env::temp_dir().join(format!(
        "trellis-integration-jobs-{}.sqlite",
        setup_login.state.session_key
    ));
    let jobs_service = RustJobsAdminServiceProcess::start(
        trellis_url,
        &jobs_service_seed,
        JobsAdminServiceMode::Owner,
        &jobs_db_path,
    )?;
    let jobs_runtime_client =
        connect_jobs_service_client_with_retry(trellis_url, &jobs_service_seed).await?;
    let jobs_nats = jobs_runtime_client.nats().clone();
    let local_jobs_services =
        setup_service_local_jobs(trellis_url, &auth_client, &admin_client).await?;

    let owner_service_seed = jobs_service_seed.clone();
    let call_jobs_db_path = jobs_db_path.clone();
    let call_result = async move {
        let caller_login = reauth_contract(
            &setup_login.state,
            &jobs_caller_contract_json(true, true)?,
            trellis_url,
            browser,
        )
        .await?;
        let caller_client = connect_admin_client_async(&caller_login.state)
            .await
            .into_diagnostic()?;
        let jobs_client = JobsClient::new(&caller_client);
        await_jobs_health(&jobs_client).await?;

        run_service_local_jobs_fixture(&jobs_client, local_jobs_services).await?;

        seed_jobs_projection(&jobs_nats).await?;
        assert_janitor_expiry(&jobs_client, &jobs_nats).await?;
        assert_owner_rpc_only_coexist(
            trellis_url,
            &owner_service_seed,
            &jobs_client,
            &jobs_nats,
            &call_jobs_db_path,
        )
        .await?;
        let worker = await_worker_presence(&jobs_client).await?;
        if worker.job_type != HARNESS_JOBS_QUEUE {
            return Err(miette!(
                "Jobs.ListServices returned unexpected worker `{}`",
                worker.job_type
            ));
        }

        let pending = await_job_state(&jobs_client, "job-cancel-1", "pending").await?;
        if pending.service != HARNESS_JOBS_SERVICE {
            return Err(miette!(
                "Jobs.Get returned unexpected service `{}`",
                pending.service
            ));
        }

        let list = jobs_client
            .rpc()
            .jobs()
            .list(&JobsListRequest {
                limit: 20,
                offset: None,
                service: Some(HARNESS_JOBS_SERVICE.to_string()),
                since: None,
                state: None,
                r#type: Some(HARNESS_JOBS_QUEUE.to_string()),
            })
            .await
            .into_diagnostic()?;
        if !list.entries.iter().any(|job| job.id == "job-cancel-1") {
            return Err(miette!("Jobs.List did not include seeded pending job"));
        }
        assert_jobs_list_filters(&jobs_client).await?;

        let cancelled = jobs_client
            .rpc()
            .jobs()
            .cancel(&JobsCancelRequest {
                id: "job-cancel-1".to_string(),
            })
            .await
            .into_diagnostic()?;
        assert_state(&cancelled.job.state, "cancelled", "Jobs.Cancel")?;

        let retried = jobs_client
            .rpc()
            .jobs()
            .retry(&JobsRetryRequest {
                id: "job-failed-1".to_string(),
            })
            .await
            .into_diagnostic()?;
        assert_state(&retried.job.state, "pending", "Jobs.Retry")?;

        let dlq = jobs_client
            .rpc()
            .jobs()
            .list_dlq(&JobsListDLQRequest {
                limit: 20,
                offset: None,
                service: Some(HARNESS_JOBS_SERVICE.to_string()),
                since: None,
                r#type: Some(HARNESS_JOBS_QUEUE.to_string()),
            })
            .await
            .into_diagnostic()?;
        if !dlq.entries.iter().any(|job| job.id == "job-dead-replay-1")
            || !dlq.entries.iter().any(|job| job.id == "job-dead-dismiss-1")
        {
            return Err(miette!("Jobs.ListDLQ did not include seeded dead jobs"));
        }

        let replayed = jobs_client
            .rpc()
            .jobs()
            .replay_dlq(&JobsReplayDLQRequest {
                id: "job-dead-replay-1".to_string(),
            })
            .await
            .into_diagnostic()?;
        assert_state(&replayed.job.state, "pending", "Jobs.ReplayDLQ")?;

        let dismissed = jobs_client
            .rpc()
            .jobs()
            .dismiss_dlq(&JobsDismissDLQRequest {
                id: "job-dead-dismiss-1".to_string(),
            })
            .await
            .into_diagnostic()?;
        assert_state(&dismissed.job.state, "dismissed", "Jobs.DismissDLQ")?;
        let dismissed_get =
            await_job_state(&jobs_client, "job-dead-dismiss-1", "dismissed").await?;
        assert_state(
            &dismissed_get.state,
            "dismissed",
            "Jobs.Get dismissed DLQ job",
        )?;
        let dlq_after_mutations = jobs_client
            .rpc()
            .jobs()
            .list_dlq(&JobsListDLQRequest {
                limit: 20,
                offset: None,
                service: Some(HARNESS_JOBS_SERVICE.to_string()),
                since: None,
                r#type: Some(HARNESS_JOBS_QUEUE.to_string()),
            })
            .await
            .into_diagnostic()?;
        if dlq_after_mutations
            .entries
            .iter()
            .any(|job| job.id == "job-dead-replay-1" || job.id == "job-dead-dismiss-1")
        {
            return Err(miette!(
                "Jobs.ListDLQ still included replayed or dismissed jobs"
            ));
        }

        if jobs_client
            .rpc()
            .jobs()
            .retry(&JobsRetryRequest {
                id: "job-dead-dismiss-1".to_string(),
            })
            .await
            .is_ok()
        {
            return Err(miette!("Jobs.Retry unexpectedly accepted dismissed job"));
        }
        assert_invalid_jobs_mutations(&jobs_client).await?;

        Ok(caller_login.state.clone())
    }
    .await;

    let caller_state = match call_result {
        Ok(caller_state) => caller_state,
        Err(error) => {
            drop(jobs_service);
            return Err(error);
        }
    };

    drop(jobs_service);
    assert_owner_restart_rpc_only(
        trellis_url,
        &jobs_service_seed,
        &caller_state,
        browser,
        &jobs_db_path,
    )
    .await?;
    Ok(PASSING_CASES)
}

fn jobs_caller_contract_json(read: bool, mutate: bool) -> Result<String> {
    let mut calls = Vec::new();
    if read {
        calls.extend([
            "Jobs.Health",
            "Jobs.ListServices",
            "Jobs.List",
            "Jobs.Get",
            "Jobs.ListDLQ",
        ]);
    }
    if mutate {
        calls.extend([
            "Jobs.Cancel",
            "Jobs.Retry",
            "Jobs.ReplayDLQ",
            "Jobs.DismissDLQ",
        ]);
    }

    let manifest = ContractManifestBuilder::new(
        "trellis.integration-jobs-agent@v1",
        "Trellis Integration Jobs Agent",
        "Verify delegated Rust agent access to the generated Jobs SDK.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Me"]),
    )
    .use_ref(
        "jobs",
        use_contract(trellis::sdk::jobs::CONTRACT_ID).with_rpc_call(calls),
    )
    .build()
    .map_err(|error| miette!("failed to build Jobs caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize Jobs caller contract: {error}"))
}

struct LocalJobsServices {
    rust_client: TrellisClient,
    ts_process: TsLocalJobsServiceProcess,
}

async fn setup_service_local_jobs(
    trellis_url: &str,
    auth_client: &trellis::auth::AuthClient<'_>,
    admin_client: &TrellisClient,
) -> Result<LocalJobsServices> {
    auth_client
        .create_service_deployment(LOCAL_JOBS_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let contract_json = local_jobs_service_contract_json()?;
    let contract_digest = digest_contract_json(&contract_json).into_diagnostic()?;
    SdkAuthClient::new(admin_client)
        .rpc()
        .auth()
        .envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&contract_json)?,
            deployment_id: LOCAL_JOBS_DEPLOYMENT_ID.to_string(),
            expected_digest: contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;

    let (rust_service_seed, rust_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: LOCAL_JOBS_DEPLOYMENT_ID.to_string(),
            instance_key: rust_service_key,
        })
        .await
        .into_diagnostic()?;
    let (ts_service_seed, ts_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: LOCAL_JOBS_DEPLOYMENT_ID.to_string(),
            instance_key: ts_service_key,
        })
        .await
        .into_diagnostic()?;

    let rust_client =
        connect_local_jobs_service_with_retry(trellis_url, &contract_digest, &rust_service_seed)
            .await?;
    let ts_process =
        TsLocalJobsServiceProcess::start(trellis_url, &contract_digest, &ts_service_seed)?;
    ts_process.wait_ready().await?;

    Ok(LocalJobsServices {
        rust_client,
        ts_process,
    })
}

async fn run_service_local_jobs_fixture(
    jobs_client: &JobsClient<'_>,
    services: LocalJobsServices,
) -> Result<()> {
    let (rust_job_id, rust_cancelled_job_id) =
        run_rust_service_local_jobs(jobs_client, &services.rust_client).await?;
    let rust_job = await_job_state(jobs_client, &rust_job_id, "completed").await?;
    assert_job_result(&rust_job, "rust-service-local", "rust", "Rust JobManager")?;
    assert_job_result_echoed_context(&rust_job, "Rust JobManager")?;
    let rust_cancelled = await_job_state(jobs_client, &rust_cancelled_job_id, "cancelled").await?;
    assert_state(
        &rust_cancelled.state,
        "cancelled",
        "Rust JobManager active cancel",
    )?;

    let ts_job_id = services.ts_process.wait_completed().await?;
    let ts_job = await_job_state(jobs_client, &ts_job_id, "completed").await?;
    assert_job_result(&ts_job, "ts-service-local", "ts", "TS service.jobs")?;
    assert_job_result_echoed_context(&ts_job, "TS service.jobs")?;

    let ts_created_rust_job_id = services.ts_process.wait_ts_created_rust_created().await?;
    process_ts_created_rust_job(jobs_client, &services.rust_client, &ts_created_rust_job_id)
        .await?;
    services.ts_process.wait_ts_created_rust_completed().await?;
    let ts_created_rust_job =
        await_job_state(jobs_client, &ts_created_rust_job_id, "completed").await?;
    assert_job_result(
        &ts_created_rust_job,
        "ts-created-rust-worker",
        "rust-cross",
        "TS-created Rust-handled job",
    )?;
    assert_job_result_echoed_context(&ts_created_rust_job, "TS-created Rust-handled job")?;

    let rust_created_ts_job_id = create_rust_created_ts_job(&services.rust_client).await?;
    let rust_created_ts_job =
        await_job_state(jobs_client, &rust_created_ts_job_id, "completed").await?;
    assert_job_result(
        &rust_created_ts_job,
        "rust-created-ts-worker",
        "ts",
        "Rust-created TS-handled job",
    )?;
    assert_job_result_echoed_context(&rust_created_ts_job, "Rust-created TS-handled job")?;

    let ts_cancelled_job_id = services.ts_process.wait_cancelled().await?;
    let ts_cancelled = await_job_state(jobs_client, &ts_cancelled_job_id, "cancelled").await?;
    assert_state(
        &ts_cancelled.state,
        "cancelled",
        "TS service.jobs active cancel",
    )?;
    assert_cancelled_before_worker_start(jobs_client, &services.rust_client).await?;
    assert_queue_concurrency(jobs_client, &services.rust_client).await?;
    assert_worker_shutdown_requeues(jobs_client, &services.rust_client).await?;
    assert_natural_max_deliveries_dead(jobs_client, &services.rust_client).await?;
    Ok(())
}

async fn run_rust_service_local_jobs(
    jobs_client: &JobsClient<'_>,
    rust_client: &TrellisClient,
) -> Result<(String, String)> {
    let binding_value = rust_client
        .service_bootstrap_binding()
        .ok_or_else(|| miette!("Rust service-local Jobs client is missing bootstrap binding"))?
        .clone();
    let binding: TrellisBindingsGetResponseBinding = serde_json::from_value(binding_value)
        .map_err(|error| miette!("failed to decode service-local Jobs binding: {error}"))?;
    let runtime_binding = JobsRuntimeBinding::try_from(&binding)
        .map_err(|error| miette!("failed to decode service-local Jobs runtime binding: {error}"))?;
    let complete_manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        runtime_binding.jobs.clone(),
        FixedJobMetaSource::new(
            "job-rust-service-local-1",
            vec![
                "2026-03-28T13:00:00.000Z",
                "2026-03-28T13:00:01.000Z",
                "2026-03-28T13:00:02.000Z",
                "2026-03-28T13:00:03.000Z",
            ],
        ),
    );
    let job = complete_manager
        .create(
            LOCAL_RUST_QUEUE,
            json!({ "documentId": "rust-service-local" }),
        )
        .await
        .map_err(|error| miette!("Rust JobManager create failed: {error}"))?;
    let job_id = job.id.clone();
    let outcome = complete_manager
        .process(job, JobCancellationToken::new(), |active| async move {
            let context = active.context().clone();
            active
                .update_progress(1, 1, Some("rust processing".to_string()))
                .await
                .map_err(|error| JobProcessError::failed(error.to_string()))?;
            active
                .log(JobLogLevel::Info, "rust processed")
                .await
                .map_err(|error| JobProcessError::failed(error.to_string()))?;
            Ok::<Value, JobProcessError<String>>(json!({
                "documentId": "rust-service-local",
                "processedBy": "rust",
                "requestId": context.request_id,
                "traceId": context.trace_id,
                "traceparent": context.traceparent
            }))
        })
        .await
        .map_err(|error| miette!("Rust JobManager process failed: {error}"))?;
    if !matches!(outcome, JobProcessOutcome::Completed { .. }) {
        return Err(miette!(
            "Rust JobManager process returned unexpected outcome: {:?}",
            outcome
        ));
    }

    let cancel_create_manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        runtime_binding.jobs.clone(),
        FixedJobMetaSource::new(
            "job-rust-service-local-cancel-1",
            vec!["2026-03-28T13:01:00.000Z"],
        ),
    );
    let cancel_job = cancel_create_manager
        .create(
            LOCAL_RUST_QUEUE,
            json!({ "documentId": "rust-active-cancel" }),
        )
        .await
        .map_err(|error| miette!("Rust JobManager cancellable create failed: {error}"))?;
    let cancel_job_id = cancel_job.id.clone();
    let mut cancel_job_for_cancel = cancel_job.clone();
    cancel_job_for_cancel.state = trellis::jobs::JobState::Active;
    cancel_job_for_cancel.tries = 1;
    let cancellation = JobCancellationToken::new();
    let process_cancellation = cancellation.clone();
    let process_manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        runtime_binding.jobs.clone(),
        FixedJobMetaSource::new(
            "ignored-rust-cancel-process",
            vec!["2026-03-28T13:01:01.000Z", "2026-03-28T13:01:02.000Z"],
        ),
    );
    let process_task = tokio::spawn(async move {
        process_manager
            .process(cancel_job, process_cancellation, |active| async move {
                while !active.is_cancelled() {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                Ok::<Value, JobProcessError<String>>(json!({
                    "documentId": "rust-active-cancel",
                    "processedBy": "rust-cancelled"
                }))
            })
            .await
    });

    if let Err(error) = await_job_state(jobs_client, &cancel_job_id, "active").await {
        cancellation.cancel();
        process_task.abort();
        let _ = process_task.await;
        return Err(error);
    }
    let cancel_manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        runtime_binding.jobs,
        FixedJobMetaSource::new(
            "ignored-rust-cancel-event",
            vec!["2026-03-28T13:01:03.000Z"],
        ),
    );
    cancel_manager
        .cancel(&cancel_job_for_cancel)
        .await
        .map_err(|error| miette!("Rust JobManager active cancel failed: {error}"))?;
    cancellation.cancel();
    let cancel_outcome = tokio::time::timeout(Duration::from_secs(5), process_task)
        .await
        .map_err(|_| miette!("Rust JobManager cancel process did not stop after cancellation"))?
        .map_err(|error| miette!("Rust JobManager cancel process task failed: {error}"))?
        .map_err(|error| miette!("Rust JobManager cancel process failed: {error}"))?;
    if !matches!(cancel_outcome, JobProcessOutcome::Cancelled { .. }) {
        return Err(miette!(
            "Rust JobManager active cancel returned unexpected outcome: {:?}",
            cancel_outcome
        ));
    }

    Ok((job_id, cancel_job_id))
}

async fn process_ts_created_rust_job(
    jobs_client: &JobsClient<'_>,
    rust_client: &TrellisClient,
    job_id: &str,
) -> Result<()> {
    let projected = await_job_state(jobs_client, job_id, "pending").await?;
    let job: Job = serde_json::from_value(
        serde_json::to_value(projected)
            .map_err(|error| miette!("failed to encode TS-created Rust job: {error}"))?,
    )
    .map_err(|error| miette!("failed to decode TS-created Rust job: {error}"))?;
    let binding = service_local_runtime_binding(rust_client)?;
    let manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        binding.jobs,
        FixedJobMetaSource::new(
            "ignored-ts-created-rust-process",
            vec!["2026-03-28T13:02:00.000Z", "2026-03-28T13:02:01.000Z"],
        ),
    );
    let outcome = manager
        .process(job, JobCancellationToken::new(), |active| async move {
            let context = active.context().clone();
            let document_id = active
                .job()
                .payload
                .get("documentId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            Ok::<Value, JobProcessError<String>>(json!({
                "documentId": document_id,
                "processedBy": "rust-cross",
                "requestId": context.request_id,
                "traceId": context.trace_id,
                "traceparent": context.traceparent
            }))
        })
        .await
        .map_err(|error| miette!("failed to process TS-created Rust job: {error}"))?;
    if !matches!(outcome, JobProcessOutcome::Completed { .. }) {
        return Err(miette!(
            "TS-created Rust job returned unexpected outcome: {:?}",
            outcome
        ));
    }
    Ok(())
}

async fn create_rust_created_ts_job(rust_client: &TrellisClient) -> Result<String> {
    let binding = service_local_runtime_binding(rust_client)?;
    let manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        binding.jobs,
        FixedJobMetaSource::new(
            "job-rust-created-ts-worker-1",
            vec!["2026-03-28T13:03:00.000Z"],
        ),
    );
    let job = manager
        .create(
            LOCAL_TS_QUEUE,
            json!({ "documentId": "rust-created-ts-worker" }),
        )
        .await
        .map_err(|error| miette!("failed to create Rust-created TS job: {error}"))?;
    Ok(job.id)
}

fn assert_job_result(
    job: &trellis::sdk::jobs::types::JobsGetResponseJob,
    document_id: &str,
    processed_by: &str,
    context: &str,
) -> Result<()> {
    let result = job
        .result
        .as_ref()
        .ok_or_else(|| miette!("{context} completed job without result"))?;
    if result.get("documentId").and_then(Value::as_str) != Some(document_id)
        || result.get("processedBy").and_then(Value::as_str) != Some(processed_by)
    {
        return Err(miette!(
            "{context} completed job with unexpected result `{}`",
            result
        ));
    }
    Ok(())
}

fn assert_job_result_echoed_context(
    job: &trellis::sdk::jobs::types::JobsGetResponseJob,
    context: &str,
) -> Result<()> {
    let result = job
        .result
        .as_ref()
        .ok_or_else(|| miette!("{context} completed job without result"))?;
    if result.get("requestId").and_then(Value::as_str) != Some(job.context.request_id.as_str())
        || result.get("traceId").and_then(Value::as_str) != Some(job.context.trace_id.as_str())
        || result.get("traceparent").and_then(Value::as_str)
            != Some(job.context.traceparent.as_str())
    {
        return Err(miette!(
            "{context} did not echo job context in result `{}` for context {:?}",
            result,
            job.context
        ));
    }
    Ok(())
}

async fn assert_jobs_list_filters(jobs_client: &JobsClient<'_>) -> Result<()> {
    let filtered = jobs_client
        .rpc()
        .jobs()
        .list(&JobsListRequest {
            limit: 10,
            offset: None,
            service: Some(HARNESS_JOBS_SERVICE.to_string()),
            since: Some("2026-03-28T12:00:11.500Z".to_string()),
            state: Some(vec!["failed".to_string(), "dead".to_string()]),
            r#type: Some(HARNESS_JOBS_QUEUE.to_string()),
        })
        .await
        .into_diagnostic()?;
    let ids = filtered
        .entries
        .iter()
        .map(|job| job.id.as_str())
        .collect::<Vec<_>>();
    if ids != ["job-dead-dismiss-1", "job-dead-replay-1"] {
        return Err(miette!(
            "Jobs.List state+since filters returned unexpected ids: {:?}",
            ids
        ));
    }
    Ok(())
}

async fn connect_local_jobs_service_with_retry(
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<TrellisClient> {
    let mut last_error = None;
    for _ in 0..10 {
        match TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url,
            contract_id: LOCAL_JOBS_CONTRACT_ID,
            contract_digest,
            session_key_seed_base64url: service_seed,
            timeout_ms: 5_000,
        })
        .await
        {
            Ok(service) => return Ok(service),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }

    Err(miette!(
        "failed to connect service-local Jobs Rust service: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "no connection attempt recorded".to_string())
    ))
}

async fn connect_jobs_service_client_with_retry(
    trellis_url: &str,
    service_seed: &str,
) -> Result<TrellisClient> {
    let mut last_error = None;
    for _ in 0..10 {
        match TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url,
            contract_id: trellis::sdk::jobs::CONTRACT_ID,
            contract_digest: trellis::sdk::jobs::CONTRACT_DIGEST,
            session_key_seed_base64url: service_seed,
            timeout_ms: 5_000,
        })
        .await
        {
            Ok(service) => return Ok(service),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }

    Err(miette!(
        "failed to connect Jobs service runtime client: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "no connection attempt recorded".to_string())
    ))
}

async fn assert_owner_restart_rpc_only(
    trellis_url: &str,
    service_seed: &str,
    caller_state: &trellis::auth::AdminSessionState,
    browser: &BrowserContainer,
    jobs_db_path: &Path,
) -> Result<()> {
    let rpc_only_service = RustJobsAdminServiceProcess::start(
        trellis_url,
        service_seed,
        JobsAdminServiceMode::RpcOnly,
        jobs_db_path,
    )?;

    let result = async {
        let caller_client = connect_admin_client_async(caller_state)
            .await
            .into_diagnostic()?;
        let jobs_client = JobsClient::new(&caller_client);
        await_jobs_health(&jobs_client).await?;
        let worker = await_worker_presence(&jobs_client).await?;
        if worker.job_type != HARNESS_JOBS_QUEUE {
            return Err(miette!(
                "Jobs RPC-only ListServices returned unexpected worker `{}`",
                worker.job_type
            ));
        }
        await_job_state(&jobs_client, "job-janitor-expired-1", "expired").await?;
        assert_jobs_read_denied(trellis_url, caller_state, browser).await?;
        Ok(())
    }
    .await;

    drop(rpc_only_service);
    result
}

async fn assert_owner_rpc_only_coexist(
    trellis_url: &str,
    service_seed: &str,
    jobs_client: &JobsClient<'_>,
    nats: &async_nats::Client,
    jobs_db_path: &Path,
) -> Result<()> {
    let rpc_only_service = RustJobsAdminServiceProcess::start(
        trellis_url,
        service_seed,
        JobsAdminServiceMode::RpcOnly,
        jobs_db_path,
    )?;

    let result = async {
        await_jobs_health(jobs_client).await?;
        publish_created_job_event(
            nats,
            "job-owner-rpc-only-1",
            json!({ "documentId": "owner-rpc-only" }),
            "2026-03-28T12:03:00.000Z",
        )
        .await?;
        let projected = await_job_state(jobs_client, "job-owner-rpc-only-1", "pending").await?;
        if projected.service != HARNESS_JOBS_SERVICE {
            return Err(miette!(
                "owner/RPC-only coexist projected unexpected service `{}`",
                projected.service
            ));
        }
        Ok(())
    }
    .await;

    drop(rpc_only_service);
    result
}

async fn assert_jobs_read_denied(
    trellis_url: &str,
    caller_state: &trellis::auth::AdminSessionState,
    browser: &BrowserContainer,
) -> Result<()> {
    let read_denied_login = reauth_contract(
        caller_state,
        &jobs_caller_contract_json(false, true)?,
        trellis_url,
        browser,
    )
    .await?;
    let read_denied_client = connect_admin_client_async(&read_denied_login.state)
        .await
        .into_diagnostic()?;
    if JobsClient::new(&read_denied_client)
        .rpc()
        .jobs()
        .list(&JobsListRequest {
            limit: 1,
            offset: None,
            service: None,
            since: None,
            state: None,
            r#type: None,
        })
        .await
        .is_ok()
    {
        return Err(miette!(
            "Jobs.List unexpectedly succeeded without read capability"
        ));
    }
    Ok(())
}

async fn assert_invalid_jobs_mutations(jobs_client: &JobsClient<'_>) -> Result<()> {
    if jobs_client
        .rpc()
        .jobs()
        .cancel(&JobsCancelRequest {
            id: "job-completed-invalid-1".to_string(),
        })
        .await
        .is_ok()
    {
        return Err(miette!("Jobs.Cancel unexpectedly accepted completed job"));
    }
    if jobs_client
        .rpc()
        .jobs()
        .retry(&JobsRetryRequest {
            id: "job-failed-1".to_string(),
        })
        .await
        .is_ok()
    {
        return Err(miette!("Jobs.Retry unexpectedly accepted pending job"));
    }
    if jobs_client
        .rpc()
        .jobs()
        .dismiss_dlq(&JobsDismissDLQRequest {
            id: "job-janitor-future-1".to_string(),
        })
        .await
        .is_ok()
    {
        return Err(miette!("Jobs.DismissDLQ unexpectedly accepted active job"));
    }
    Ok(())
}

async fn seed_jobs_projection(nats: &async_nats::Client) -> Result<()> {
    publish_fresh_worker_heartbeat(nats).await?;
    publish_created_job_event(
        nats,
        "job-cancel-1",
        json!({ "documentId": "cancel" }),
        "2026-03-28T12:00:00.000Z",
    )
    .await?;
    publish_created_job_event(
        nats,
        "job-failed-1",
        json!({ "documentId": "failed" }),
        "2026-03-28T12:00:01.000Z",
    )
    .await?;
    publish_started_job_event(nats, "job-failed-1", "2026-03-28T12:00:10.000Z").await?;
    publish_job_event(
        nats,
        failed_event(
            HARNESS_JOBS_SERVICE,
            HARNESS_JOBS_QUEUE,
            "job-failed-1",
            &job_context("job-failed-1"),
            trellis::jobs::JobState::Active,
            1,
            "2026-03-28T12:00:11.000Z",
            "integration failure",
        ),
    )
    .await?;
    publish_created_job_event(
        nats,
        "job-completed-invalid-1",
        json!({ "documentId": "completed-invalid" }),
        "2026-03-28T12:00:14.000Z",
    )
    .await?;
    publish_started_job_event(nats, "job-completed-invalid-1", "2026-03-28T12:00:15.000Z").await?;
    publish_job_event(
        nats,
        completed_event(
            HARNESS_JOBS_SERVICE,
            HARNESS_JOBS_QUEUE,
            "job-completed-invalid-1",
            &job_context("job-completed-invalid-1"),
            1,
            "2026-03-28T12:00:16.000Z",
            json!({ "documentId": "completed-invalid" }),
        ),
    )
    .await?;

    for (document_id, failed_at) in [
        ("dead-replay", "2026-03-28T12:00:12.000Z"),
        ("dead-dismiss", "2026-03-28T12:00:13.000Z"),
    ] {
        let job_id = format!("job-{document_id}-1");
        publish_created_job_event(
            nats,
            &job_id,
            json!({ "documentId": document_id }),
            "2026-03-28T12:00:02.000Z",
        )
        .await?;
        publish_started_job_event(nats, &job_id, "2026-03-28T12:00:10.000Z").await?;
        publish_job_event(
            nats,
            dead_event(
                HARNESS_JOBS_SERVICE,
                HARNESS_JOBS_QUEUE,
                &job_id,
                &job_context(&job_id),
                trellis::jobs::JobState::Active,
                5,
                failed_at,
                "integration dead letter",
            ),
        )
        .await?;
    }
    Ok(())
}

async fn assert_janitor_expiry(
    jobs_client: &JobsClient<'_>,
    nats: &async_nats::Client,
) -> Result<()> {
    publish_created_job_event_with_deadline(
        nats,
        "job-janitor-expired-1",
        json!({ "documentId": "janitor-expired" }),
        "2026-03-28T12:01:00.000Z",
        Some("2026-03-28T12:01:30.000Z"),
    )
    .await?;
    publish_started_job_event(nats, "job-janitor-expired-1", "2026-03-28T12:01:05.000Z").await?;
    publish_created_job_event_with_deadline(
        nats,
        "job-janitor-future-1",
        json!({ "documentId": "janitor-future" }),
        "2026-03-28T12:01:00.000Z",
        Some("2030-03-28T12:10:00.000Z"),
    )
    .await?;
    publish_started_job_event(nats, "job-janitor-future-1", "2026-03-28T12:01:05.000Z").await?;

    let expired = await_job_state(jobs_client, "job-janitor-expired-1", "expired").await?;
    if expired.last_error.as_deref() != Some("job exceeded deadline") {
        return Err(miette!(
            "Jobs janitor projected unexpected lastError for expired job: {:?}",
            expired.last_error
        ));
    }
    await_job_state(jobs_client, "job-janitor-future-1", "active").await?;
    Ok(())
}

async fn assert_natural_max_deliveries_dead(
    jobs_client: &JobsClient<'_>,
    rust_client: &TrellisClient,
) -> Result<()> {
    let mut binding = service_local_runtime_binding(rust_client)?;
    let queue = binding
        .jobs
        .queues
        .get_mut(LOCAL_RUST_QUEUE)
        .ok_or_else(|| miette!("service-local Rust queue binding is missing"))?;
    queue.consumer_name = LOCAL_RUST_WORKER_CONSUMER.to_string();
    queue.max_deliver = 2;
    queue.backoff_ms = vec![100];
    queue.ack_wait_ms = 100;

    let manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        binding.jobs.clone(),
        FixedJobMetaSource::new("job-local-natural-dead-1", vec!["2026-03-28T12:04:00.000Z"]),
    );
    let job = manager
        .create(LOCAL_RUST_QUEUE, json!({ "documentId": "natural-dead" }))
        .await
        .map_err(|error| miette!("failed to create natural max-deliveries job: {error}"))?;

    await_job_state(jobs_client, &job.id, "pending").await?;
    let worker = start_worker_host_from_binding(
        rust_client.nats().clone(),
        binding,
        "harness-jobs-natural-dead-worker".to_string(),
        {
            let nats = rust_client.nats().clone();
            move || NatsJobEventPublisher::new(nats.clone())
        },
        |_queue_type, worker_index| {
            FixedJobMetaSource::new(
                format!("ignored-natural-dead-worker-{worker_index}"),
                vec![
                    "2026-03-28T12:04:01.000Z",
                    "2026-03-28T12:04:02.000Z",
                    "2026-03-28T12:04:03.000Z",
                    "2026-03-28T12:04:04.000Z",
                ],
            )
        },
        |_active| async {
            Err::<Value, JobProcessError<String>>(JobProcessError::retryable(
                "natural max-deliveries failure".to_string(),
            ))
        },
        WorkerHostOptions {
            queue_types: Some(vec![LOCAL_RUST_QUEUE.to_string()]),
            heartbeat_interval: Duration::from_secs(30),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        },
    )
    .await
    .map_err(|error| miette!("failed to start natural max-deliveries worker: {error}"))?;

    let dead = await_job_state(jobs_client, &job.id, "dead").await;
    let stop_result = worker.stop().await;
    if let Err(error) = stop_result {
        return Err(miette!(
            "failed to stop natural max-deliveries worker: {error}"
        ));
    }
    let dead = dead?;
    if dead.tries != 2 {
        return Err(miette!(
            "natural max-deliveries job projected tries {}, expected 2",
            dead.tries
        ));
    }
    let last_error = dead.last_error.as_deref().unwrap_or_default();
    if !last_error.contains("max deliveries exceeded") {
        return Err(miette!(
            "natural max-deliveries job projected unexpected lastError `{last_error}`"
        ));
    }
    Ok(())
}

async fn assert_cancelled_before_worker_start(
    jobs_client: &JobsClient<'_>,
    rust_client: &TrellisClient,
) -> Result<()> {
    let mut binding = service_local_runtime_binding(rust_client)?;
    binding
        .jobs
        .queues
        .get_mut(LOCAL_RUST_QUEUE)
        .ok_or_else(|| miette!("service-local Rust queue binding is missing"))?
        .consumer_name = LOCAL_RUST_WORKER_CONSUMER.to_string();
    let manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        binding.jobs.clone(),
        FixedJobMetaSource::new(
            "job-local-cancel-before-worker-1",
            vec!["2026-03-28T12:05:00.000Z"],
        ),
    );
    let job = manager
        .create(
            LOCAL_RUST_QUEUE,
            json!({ "documentId": "cancel-before-worker" }),
        )
        .await
        .map_err(|error| miette!("failed to create pre-start cancellation job: {error}"))?;
    await_job_state(jobs_client, &job.id, "pending").await?;

    let cancelled = jobs_client
        .rpc()
        .jobs()
        .cancel(&JobsCancelRequest { id: job.id.clone() })
        .await
        .into_diagnostic()?;
    assert_state(
        &cancelled.job.state,
        "cancelled",
        "Jobs.Cancel before worker start",
    )?;

    let handler_calls = Arc::new(AtomicUsize::new(0));
    let cancelled_job_id = job.id.clone();
    let worker = start_worker_host_from_binding(
        rust_client.nats().clone(),
        binding,
        "harness-jobs-cancel-before-worker".to_string(),
        {
            let nats = rust_client.nats().clone();
            move || NatsJobEventPublisher::new(nats.clone())
        },
        |_queue_type, worker_index| {
            FixedJobMetaSource::new(
                format!("ignored-cancel-before-worker-{worker_index}"),
                vec!["2026-03-28T12:05:01.000Z", "2026-03-28T12:05:02.000Z"],
            )
        },
        {
            let handler_calls = Arc::clone(&handler_calls);
            let cancelled_job_id = cancelled_job_id.clone();
            move |active| {
                let handler_calls = Arc::clone(&handler_calls);
                let cancelled_job_id = cancelled_job_id.clone();
                async move {
                    if active.job().id == cancelled_job_id {
                        handler_calls.fetch_add(1, Ordering::SeqCst);
                    }
                    Ok::<Value, JobProcessError<String>>(json!({ "processed": true }))
                }
            }
        },
        WorkerHostOptions {
            queue_types: Some(vec![LOCAL_RUST_QUEUE.to_string()]),
            heartbeat_interval: Duration::from_secs(30),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        },
    )
    .await
    .map_err(|error| miette!("failed to start pre-cancel worker: {error}"))?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    let calls = handler_calls.load(Ordering::SeqCst);
    let stop_result = worker.stop().await;
    if let Err(error) = stop_result {
        return Err(miette!("failed to stop pre-cancel worker: {error}"));
    }
    if calls != 0 {
        return Err(miette!(
            "pre-start cancelled job handler ran {calls} time(s), expected 0"
        ));
    }
    await_job_state(jobs_client, &job.id, "cancelled").await?;
    Ok(())
}

async fn assert_queue_concurrency(
    jobs_client: &JobsClient<'_>,
    rust_client: &TrellisClient,
) -> Result<()> {
    let mut binding = service_local_runtime_binding(rust_client)?;
    let queue = binding
        .jobs
        .queues
        .get_mut(LOCAL_RUST_QUEUE)
        .ok_or_else(|| miette!("service-local Rust queue binding is missing"))?;
    queue.consumer_name = LOCAL_RUST_WORKER_CONSUMER.to_string();
    queue.concurrency = 2;

    let worker = start_worker_host_from_binding(
        rust_client.nats().clone(),
        binding.clone(),
        "harness-jobs-concurrency-worker".to_string(),
        {
            let nats = rust_client.nats().clone();
            move || NatsJobEventPublisher::new(nats.clone())
        },
        |_queue_type, worker_index| {
            FixedJobMetaSource::new(
                format!("ignored-concurrency-worker-{worker_index}"),
                vec![
                    "2026-03-28T12:06:01.000Z",
                    "2026-03-28T12:06:02.000Z",
                    "2026-03-28T12:06:03.000Z",
                    "2026-03-28T12:06:04.000Z",
                ],
            )
        },
        |_active| async { Ok::<Value, JobProcessError<String>>(json!({ "processed": true })) },
        WorkerHostOptions {
            queue_types: Some(vec![LOCAL_RUST_QUEUE.to_string()]),
            heartbeat_interval: Duration::from_millis(250),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        },
    )
    .await
    .map_err(|error| miette!("failed to start concurrency worker host: {error}"))?;
    if worker.worker_count() != 2 {
        return Err(miette!(
            "concurrency worker host started {} worker(s), expected 2",
            worker.worker_count()
        ));
    }
    let presence =
        await_worker_presence_by_instance(jobs_client, "harness-jobs-concurrency-worker").await?;
    if presence.concurrency != Some(2) {
        return Err(miette!(
            "Jobs.ListServices projected concurrency {:?}, expected 2",
            presence.concurrency
        ));
    }

    let manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        binding.jobs.clone(),
        FixedJobMetaSource::new("job-local-concurrency-a", vec!["2026-03-28T12:06:00.000Z"]),
    );
    let job_a = manager
        .create(LOCAL_RUST_QUEUE, json!({ "documentId": "concurrency-a" }))
        .await
        .map_err(|error| miette!("failed to create concurrency job A: {error}"))?;
    let manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        binding.jobs.clone(),
        FixedJobMetaSource::new("job-local-concurrency-b", vec!["2026-03-28T12:06:00.100Z"]),
    );
    let job_b = manager
        .create(LOCAL_RUST_QUEUE, json!({ "documentId": "concurrency-b" }))
        .await
        .map_err(|error| miette!("failed to create concurrency job B: {error}"))?;

    let completed_a = await_job_state(jobs_client, &job_a.id, "completed").await;
    let completed_b = await_job_state(jobs_client, &job_b.id, "completed").await;
    let stop_result = worker.stop().await;
    if let Err(error) = stop_result {
        return Err(miette!("failed to stop concurrency worker host: {error}"));
    }
    completed_a?;
    completed_b?;
    Ok(())
}

async fn assert_worker_shutdown_requeues(
    jobs_client: &JobsClient<'_>,
    rust_client: &TrellisClient,
) -> Result<()> {
    const SHUTDOWN_REQUEUE_CONSUMER: &str = "harness-local-jobs-rust-shutdown-worker";

    let mut binding = service_local_runtime_binding(rust_client)?;
    let queue = binding
        .jobs
        .queues
        .get_mut(LOCAL_RUST_SHUTDOWN_QUEUE)
        .ok_or_else(|| miette!("service-local Rust shutdown queue binding is missing"))?;
    queue.consumer_name = SHUTDOWN_REQUEUE_CONSUMER.to_string();
    queue.ack_wait_ms = 100;
    queue.backoff_ms = vec![100];
    queue.max_deliver = 5;

    let manager = JobManager::new(
        NatsJobEventPublisher::new(rust_client.nats().clone()),
        binding.jobs.clone(),
        FixedJobMetaSource::new(
            "job-local-shutdown-requeue-1",
            vec!["2026-03-28T12:07:00.000Z"],
        ),
    );
    let job = manager
        .create(
            LOCAL_RUST_SHUTDOWN_QUEUE,
            json!({ "documentId": "shutdown-requeue" }),
        )
        .await
        .map_err(|error| miette!("failed to create shutdown requeue job: {error}"))?;

    let worker_a = start_worker_host_from_binding(
        rust_client.nats().clone(),
        binding,
        "harness-jobs-shutdown-worker-a".to_string(),
        {
            let nats = rust_client.nats().clone();
            move || NatsJobEventPublisher::new(nats.clone())
        },
        |_queue_type, worker_index| {
            FixedJobMetaSource::new(
                format!("ignored-shutdown-worker-a-{worker_index}"),
                vec!["2026-03-28T12:07:01.000Z", "2026-03-28T12:07:02.000Z"],
            )
        },
        |active| async move {
            active
                .heartbeat()
                .await
                .map_err(|error| JobProcessError::failed(error.to_string()))?;
            while !active.is_cancelled() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            Ok::<Value, JobProcessError<String>>(json!({
                "documentId": "shutdown-requeue",
                "processedBy": "worker-a"
            }))
        },
        WorkerHostOptions {
            queue_types: Some(vec![LOCAL_RUST_SHUTDOWN_QUEUE.to_string()]),
            heartbeat_interval: Duration::from_secs(30),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        },
    )
    .await
    .map_err(|error| miette!("failed to start shutdown worker A: {error}"))?;

    await_job_state(jobs_client, &job.id, "active").await?;
    worker_a
        .stop()
        .await
        .map_err(|error| miette!("failed to stop shutdown worker A: {error}"))?;

    let mut binding = service_local_runtime_binding(rust_client)?;
    let queue = binding
        .jobs
        .queues
        .get_mut(LOCAL_RUST_SHUTDOWN_QUEUE)
        .ok_or_else(|| miette!("service-local Rust shutdown queue binding is missing"))?;
    queue.consumer_name = SHUTDOWN_REQUEUE_CONSUMER.to_string();
    queue.ack_wait_ms = 100;
    queue.backoff_ms = vec![100];
    queue.max_deliver = 5;
    let worker_b = start_worker_host_from_binding(
        rust_client.nats().clone(),
        binding,
        "harness-jobs-shutdown-worker-b".to_string(),
        {
            let nats = rust_client.nats().clone();
            move || NatsJobEventPublisher::new(nats.clone())
        },
        |_queue_type, worker_index| {
            FixedJobMetaSource::new(
                format!("ignored-shutdown-worker-b-{worker_index}"),
                vec!["2026-03-28T12:07:03.000Z", "2026-03-28T12:07:04.000Z"],
            )
        },
        |_active| async move {
            Ok::<Value, JobProcessError<String>>(json!({
                "documentId": "shutdown-requeue",
                "processedBy": "worker-b"
            }))
        },
        WorkerHostOptions {
            queue_types: Some(vec![LOCAL_RUST_SHUTDOWN_QUEUE.to_string()]),
            heartbeat_interval: Duration::from_secs(30),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        },
    )
    .await
    .map_err(|error| miette!("failed to start shutdown worker B: {error}"))?;

    let completed = await_job_state(jobs_client, &job.id, "completed").await;
    let stop_result = worker_b.stop().await;
    if let Err(error) = stop_result {
        return Err(miette!("failed to stop shutdown worker B: {error}"));
    }
    let completed = completed?;
    assert_job_result(
        &completed,
        "shutdown-requeue",
        "worker-b",
        "shutdown requeue",
    )?;
    Ok(())
}

fn service_local_runtime_binding(rust_client: &TrellisClient) -> Result<JobsRuntimeBinding> {
    let binding_value = rust_client
        .service_bootstrap_binding()
        .ok_or_else(|| miette!("Rust service-local Jobs client is missing bootstrap binding"))?
        .clone();
    let binding: TrellisBindingsGetResponseBinding = serde_json::from_value(binding_value)
        .map_err(|error| miette!("failed to decode service-local Jobs binding: {error}"))?;
    JobsRuntimeBinding::try_from(&binding)
        .map_err(|error| miette!("failed to decode service-local Jobs runtime binding: {error}"))
}

async fn publish_started_job_event(
    nats: &async_nats::Client,
    job_id: &str,
    timestamp: &str,
) -> Result<()> {
    publish_job_event(
        nats,
        started_event(
            HARNESS_JOBS_SERVICE,
            HARNESS_JOBS_QUEUE,
            job_id,
            &job_context(job_id),
            trellis::jobs::JobState::Pending,
            1,
            timestamp,
        ),
    )
    .await
}

async fn publish_created_job_event(
    nats: &async_nats::Client,
    job_id: &str,
    payload: Value,
    timestamp: &str,
) -> Result<()> {
    publish_created_job_event_with_deadline(nats, job_id, payload, timestamp, None).await
}

async fn publish_created_job_event_with_deadline(
    nats: &async_nats::Client,
    job_id: &str,
    payload: Value,
    timestamp: &str,
    deadline: Option<&str>,
) -> Result<()> {
    publish_job_event(
        nats,
        created_event(
            HARNESS_JOBS_SERVICE,
            HARNESS_JOBS_QUEUE,
            job_id,
            &job_context(job_id),
            payload,
            5,
            timestamp,
            deadline,
        ),
    )
    .await
}

async fn publish_job_event(nats: &async_nats::Client, event: JobEvent) -> Result<()> {
    let jetstream = async_nats::jetstream::new(nats.clone());
    let mut headers = async_nats::header::HeaderMap::new();
    headers.insert("request-id", event.context.request_id.as_str());
    headers.insert("traceparent", event.context.traceparent.as_str());
    if let Some(tracestate) = event.context.tracestate.as_deref() {
        headers.insert("tracestate", tracestate);
    }
    let ack = jetstream
        .publish_with_headers(
            job_event_subject(
                &event.service,
                &event.job_type,
                &event.job_id,
                event.event_type,
            ),
            headers,
            serde_json::to_vec(&event)
                .map_err(|error| miette!("failed to serialize job event: {error}"))?
                .into(),
        )
        .await
        .map_err(|error| miette!("failed to publish job event: {error}"))?;
    ack.await
        .map_err(|error| miette!("failed to ack job event publish: {error}"))?;
    Ok(())
}

fn job_context(job_id: &str) -> JobContext {
    let suffix = job_id.bytes().fold(0_u64, |accumulator, byte| {
        accumulator.wrapping_mul(31).wrapping_add(u64::from(byte))
    });
    let trace_id = format!("0123456789abcdef{suffix:016x}");
    JobContext {
        request_id: format!("request-{job_id}"),
        trace_id: trace_id.clone(),
        traceparent: format!("00-{trace_id}-0123456789abcdef-01"),
        tracestate: None,
    }
}

async fn publish_fresh_worker_heartbeat(nats: &async_nats::Client) -> Result<()> {
    let heartbeat = WorkerHeartbeat {
        service: HARNESS_JOBS_SERVICE.to_string(),
        job_type: HARNESS_JOBS_QUEUE.to_string(),
        instance_id: JOBS_SERVICE_INSTANCE_ID.to_string(),
        concurrency: Some(1),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        timestamp: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .map_err(|error| miette!("failed to format worker heartbeat timestamp: {error}"))?,
    };
    let jetstream = async_nats::jetstream::new(nats.clone());
    let ack = jetstream
        .publish(
            worker_heartbeat_subject(
                HARNESS_JOBS_SERVICE,
                HARNESS_JOBS_QUEUE,
                JOBS_SERVICE_INSTANCE_ID,
            ),
            serde_json::to_vec(&heartbeat)
                .map_err(|error| miette!("failed to serialize worker heartbeat: {error}"))?
                .into(),
        )
        .await
        .map_err(|error| miette!("failed to publish worker heartbeat: {error}"))?;
    ack.await
        .map_err(|error| miette!("failed to ack worker heartbeat publish: {error}"))?;
    Ok(())
}

async fn await_jobs_health(jobs_client: &JobsClient<'_>) -> Result<()> {
    let mut last_error = None;
    for _ in 0..1_200 {
        match jobs_client.rpc().jobs().health().await {
            Ok(_) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(miette!(
        "Jobs.Health did not become ready: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "no request attempt recorded".to_string())
    ))
}

async fn await_worker_presence(
    jobs_client: &JobsClient<'_>,
) -> Result<JobsListServicesResponseEntriesItemWorkersItem> {
    for _ in 0..60 {
        let response = jobs_client
            .rpc()
            .jobs()
            .list_services(&JobsListServicesRequest {
                limit: 50,
                offset: None,
            })
            .await
            .into_diagnostic()?;
        if let Some(worker) = response
            .entries
            .into_iter()
            .find(|service| service.name == HARNESS_JOBS_SERVICE)
            .and_then(|service| {
                service
                    .workers
                    .into_iter()
                    .find(|worker| worker.instance_id == JOBS_SERVICE_INSTANCE_ID)
            })
        {
            return Ok(worker);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(miette!("Jobs.ListServices did not project worker presence"))
}

async fn await_worker_presence_by_instance(
    jobs_client: &JobsClient<'_>,
    instance_id: &str,
) -> Result<JobsListServicesResponseEntriesItemWorkersItem> {
    for _ in 0..80 {
        let response = jobs_client
            .rpc()
            .jobs()
            .list_services(&JobsListServicesRequest {
                limit: 50,
                offset: None,
            })
            .await
            .into_diagnostic()?;
        if let Some(worker) = response
            .entries
            .into_iter()
            .flat_map(|service| service.workers)
            .find(|worker| worker.instance_id == instance_id)
        {
            return Ok(worker);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(miette!(
        "Jobs.ListServices did not project worker instance `{instance_id}`"
    ))
}

async fn await_job_state(
    jobs_client: &JobsClient<'_>,
    id: &str,
    expected_state: &str,
) -> Result<trellis::sdk::jobs::types::JobsGetResponseJob> {
    for _ in 0..400 {
        let response = jobs_client
            .rpc()
            .jobs()
            .get(&JobsGetRequest { id: id.to_string() })
            .await
            .into_diagnostic()?;
        let job = response.job;
        if state_is(&job.state, expected_state) {
            return Ok(job);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(miette!(
        "Jobs.Get did not project job `{id}` in state `{expected_state}`"
    ))
}

fn assert_state(state: &str, expected: &str, context: &str) -> Result<()> {
    if state_is(state, expected) {
        return Ok(());
    }
    Err(miette!("{context} returned unexpected state `{state}`"))
}

fn state_is(state: &str, expected: &str) -> bool {
    state == expected
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    reauth_contract(
        &admin_login.state,
        &contract_json,
        &admin_login.state.trellis_url,
        browser,
    )
    .await
}

async fn reauth_contract(
    state: &trellis::auth::AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis::auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis::auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge.complete(trellis_url).await.into_diagnostic()
        }
    }
}

fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse Jobs contract JSON: {error}"))
}

#[derive(Debug)]
struct RustJobsAdminServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl RustJobsAdminServiceProcess {
    fn start(
        trellis_url: &str,
        service_seed: &str,
        mode: JobsAdminServiceMode,
        db_path: impl AsRef<Path>,
    ) -> Result<Self> {
        let repo = repo_root()?;
        let suffix = match mode {
            JobsAdminServiceMode::Owner => "jobs-admin-service-owner",
            JobsAdminServiceMode::RpcOnly => "jobs-admin-service-rpc-only",
        };
        let (stdout_log, stderr_log) = deno_fixture_log_paths(suffix)?;
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create Rust Jobs service stdout log: {error}"))?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create Rust Jobs service stderr log: {error}"))?;
        let mode_value = match mode {
            JobsAdminServiceMode::Owner => "owner",
            JobsAdminServiceMode::RpcOnly => "rpc-only",
        };
        let child = std::process::Command::new("cargo")
            .arg("run")
            .arg("--manifest-path")
            .arg(repo.join("rust/Cargo.toml"))
            .arg("-p")
            .arg("trellis-service-jobs")
            .arg("--bin")
            .arg("trellis-service-jobs")
            .current_dir(&repo)
            .env("TRELLIS_URL", trellis_url)
            .env("SESSION_KEY_SEED_BASE64URL", service_seed)
            .env("TRELLIS_JOBS_MODE", mode_value)
            .env("TRELLIS_JOBS_DB_PATH", db_path.as_ref())
            .env("TRELLIS_JOBS_JANITOR_INTERVAL_MS", "100")
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .map_err(|error| miette!("failed to start Rust Jobs admin service: {error}"))?;

        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }
}

impl Drop for RustJobsAdminServiceProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect Rust Jobs service child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!(
                "warning: failed to kill Rust Jobs service child: {error}; stdout: {}; stderr: {}",
                self.stdout_log.display(),
                self.stderr_log.display()
            );
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for Rust Jobs service child: {error}");
        }
    }
}

#[derive(Debug)]
struct TsLocalJobsServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsLocalJobsServiceProcess {
    fn start(trellis_url: &str, contract_digest: &str, service_seed: &str) -> Result<Self> {
        let repo = repo_root()?;
        let script_path = deno_fixture_path("jobs/local-service.ts")?;
        let (stdout_log, stderr_log) = deno_fixture_log_paths("local-jobs-service")?;
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create TS local Jobs stdout log: {error}"))?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create TS local Jobs stderr log: {error}"))?;
        let child = std::process::Command::new("deno")
            .arg("run")
            .arg("-c")
            .arg(repo.join("js/deno.json"))
            .arg("--allow-env")
            .arg("--allow-sys")
            .arg("--allow-net")
            .arg("--allow-read")
            .arg(&script_path)
            .current_dir(repo.join("js"))
            .env("TRELLIS_URL", trellis_url)
            .env("HARNESS_CONTRACT_DIGEST", contract_digest)
            .env("HARNESS_TS_SERVICE_SEED", service_seed)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .map_err(|error| miette!("failed to start TS local Jobs fixture: {error}"))?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    async fn wait_ready(&self) -> Result<()> {
        self.wait_for_stdout("TS_LOCAL_JOBS_SERVICE_READY", "readiness")
            .await
            .map(|_| ())
    }

    async fn wait_completed(&self) -> Result<String> {
        let stdout = self
            .wait_for_stdout("TS_LOCAL_JOBS_COMPLETED ", "completion")
            .await?;
        stdout
            .lines()
            .find_map(|line| line.strip_prefix("TS_LOCAL_JOBS_COMPLETED "))
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| miette!("TS local Jobs fixture did not print completed job id"))
    }

    async fn wait_ts_created_rust_created(&self) -> Result<String> {
        let stdout = self
            .wait_for_stdout(
                "TS_CREATED_RUST_JOBS_CREATED ",
                "TS-created Rust job creation",
            )
            .await?;
        stdout
            .lines()
            .find_map(|line| line.strip_prefix("TS_CREATED_RUST_JOBS_CREATED "))
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| {
                miette!("TS local Jobs fixture did not print TS-created Rust created job id")
            })
    }

    async fn wait_ts_created_rust_completed(&self) -> Result<String> {
        let stdout = self
            .wait_for_stdout(
                "TS_CREATED_RUST_JOBS_COMPLETED ",
                "TS-created Rust-handled completion",
            )
            .await?;
        stdout
            .lines()
            .find_map(|line| line.strip_prefix("TS_CREATED_RUST_JOBS_COMPLETED "))
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| miette!("TS local Jobs fixture did not print TS-created Rust job id"))
    }

    async fn wait_cancelled(&self) -> Result<String> {
        let stdout = self
            .wait_for_stdout("TS_LOCAL_JOBS_CANCELLED ", "active cancellation")
            .await?;
        stdout
            .lines()
            .find_map(|line| line.strip_prefix("TS_LOCAL_JOBS_CANCELLED "))
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| miette!("TS local Jobs fixture did not print cancelled job id"))
    }

    async fn wait_for_stdout(&self, marker: &str, context: &str) -> Result<String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
            if stdout.contains(marker) {
                return Ok(stdout);
            }
            if tokio::time::Instant::now() >= deadline {
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS local Jobs fixture {context}; stdout: {}; stderr: {}",
                    stdout,
                    stderr
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

impl Drop for TsLocalJobsServiceProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect TS local Jobs child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS local Jobs child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS local Jobs child: {error}");
        }
    }
}

struct FixedJobMetaSource {
    next_id: String,
    timestamps: Arc<Mutex<VecDeque<String>>>,
}

impl FixedJobMetaSource {
    fn new(next_id: impl Into<String>, timestamps: Vec<&str>) -> Self {
        Self {
            next_id: next_id.into(),
            timestamps: Arc::new(Mutex::new(
                timestamps.into_iter().map(ToString::to_string).collect(),
            )),
        }
    }
}

impl JobMetaSource for FixedJobMetaSource {
    fn next_job_id(&self) -> String {
        self.next_id.clone()
    }

    fn now_iso(&self) -> String {
        self.timestamps
            .lock()
            .expect("lock fixed job timestamps")
            .pop_front()
            .unwrap_or_else(|| {
                OffsetDateTime::now_utc()
                    .format(&Rfc3339)
                    .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
            })
    }
}
