use std::collections::{BTreeMap, VecDeque};
use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use miette::{miette, IntoDiagnostic, Result};
use serde_json::{json, Value};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use trellis_auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis_client::{ServiceConnectOptions, TrellisClient};
use trellis_contracts::{
    digest_contract_json, job_queue, schema_ref, use_contract, ContractKind,
    ContractManifestBuilder,
};
use trellis_jobs::bindings::JobsRuntimeBinding;
use trellis_jobs::events::{created_event, dead_event, failed_event, started_event};
use trellis_jobs::manager::{JobManager, JobMetaSource, JobProcessError, JobProcessOutcome};
use trellis_jobs::runtime_worker::{JobCancellationToken, NatsJobEventPublisher};
use trellis_jobs::subjects::{job_event_subject, worker_heartbeat_subject};
use trellis_jobs::{JobEvent, JobLogLevel, WorkerHeartbeat};
use trellis_sdk_auth::client::AuthClient as SdkAuthClient;
use trellis_sdk_auth::types::AuthEnvelopesExpandRequest;
use trellis_sdk_core::types::TrellisBindingsGetResponseBinding;
use trellis_sdk_jobs::client::JobsClient;
use trellis_sdk_jobs::types::{
    JobsCancelRequest, JobsDismissDLQRequest, JobsGetRequest, JobsHealthRequest,
    JobsListDLQRequest, JobsListRequest, JobsListServicesRequest, JobsReplayDLQRequest,
    JobsRetryRequest,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::workspace::repo_root;

const JOBS_DEPLOYMENT_ID: &str = "harness.jobs-admin";
const JOBS_SERVICE_INSTANCE_ID: &str = "harness-jobs-rust";
const HARNESS_JOBS_SERVICE: &str = "harness-jobs-documents";
const HARNESS_JOBS_QUEUE: &str = "document-process";
const LOCAL_JOBS_DEPLOYMENT_ID: &str = "harness.jobs-local";
const LOCAL_JOBS_CONTRACT_ID: &str = "trellis.integration-harness.jobs-local@v1";
const LOCAL_RUST_QUEUE: &str = "rustProcess";
const LOCAL_TS_QUEUE: &str = "tsProcess";
const PASSING_CASES: usize = 18;

fn local_jobs_service_contract_json() -> Result<String> {
    let payload_schema = json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "documentId": { "type": "string" }
        },
        "required": ["documentId"]
    });
    let result_schema = json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "documentId": { "type": "string" },
            "processedBy": { "type": "string" }
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
        LOCAL_TS_QUEUE,
        job_queue(schema_ref("JobPayload"), Some(schema_ref("JobResult"))),
    )
    .build()
    .map_err(|error| miette!("failed to build service-local Jobs contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize service-local Jobs contract: {error}"))
}

const TS_LOCAL_JOBS_SERVICE_SCRIPT: &str = r#"import { defineServiceContract } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as health } from "@qlever-llc/trellis/sdk/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

const schemas = {
  JobPayload: Type.Object({ documentId: Type.String() }, { additionalProperties: false }),
  JobResult: Type.Object({ documentId: Type.String(), processedBy: Type.String() }, { additionalProperties: false }),
} as const;

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.jobs-local@v1",
  displayName: "Trellis Integration Harness Service-Local Jobs",
  description: "Harness-owned service contract for full-stack service-local Jobs verification.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
    health: health.use({ events: { publish: ["Health.Heartbeat"] } }),
  },
  jobs: {
    rustProcess: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
    },
    tsProcess: {
      payload: ref.schema("JobPayload"),
      result: ref.schema("JobResult"),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const service = await TrellisService.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  name: "harness-local-jobs-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: false },
}).orThrow();

service.jobs.tsProcess.handle(async ({ job }) => {
  if (job.payload.documentId === "ts-active-cancel") {
    await job.progress({ step: "process", current: 0, total: 1, message: "ts cancel waiting" }).orThrow();
    while (!job.cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return Result.ok({ documentId: job.payload.documentId, processedBy: "ts-cancelled" });
  }
  await job.progress({ step: "process", current: 1, total: 1, message: "ts processing" }).orThrow();
  await job.log({ timestamp: new Date().toISOString(), level: "info", message: "ts processed" }).orThrow();
  return Result.ok({ documentId: job.payload.documentId, processedBy: "ts" });
});

async function waitForState(
  ref: { id: string; get(): { orThrow(): Promise<{ state: string }> } },
  state: string,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await ref.get().orThrow();
    if (snapshot.state === state) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for TS local job ${ref.id} to reach ${state}`);
}

void service.wait().catch((error) => {
  console.error(error);
  Deno.exit(1);
});

console.log("TS_LOCAL_JOBS_SERVICE_READY");
await new Promise((resolve) => setTimeout(resolve, 500));

const ref = await service.jobs.tsProcess.create({ documentId: "ts-service-local" }).orThrow();
const terminal = await ref.wait().orThrow();
if (terminal.state !== "completed") {
  throw new Error(`expected TS service-local job to complete, got ${terminal.state}`);
}
if (terminal.result?.processedBy !== "ts" || terminal.result?.documentId !== "ts-service-local") {
  throw new Error(`unexpected TS service-local result ${JSON.stringify(terminal.result)}`);
}
console.log(`TS_LOCAL_JOBS_COMPLETED ${ref.id}`);

const cancelRef = await service.jobs.tsProcess.create({ documentId: "ts-active-cancel" }).orThrow();
await waitForState(cancelRef, "active");
const cancelled = await cancelRef.cancel().orThrow();
if (cancelled.state !== "cancelled") {
  throw new Error(`expected TS service-local cancel to return cancelled, got ${cancelled.state}`);
}
console.log(`TS_LOCAL_JOBS_CANCELLED ${cancelRef.id}`);

await new Promise<void>(() => {});
"#;

pub(crate) async fn run_jobs_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis_auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(JOBS_DEPLOYMENT_ID, vec!["trellis".to_string()])
        .await
        .into_diagnostic()?;

    let jobs_contract_json = trellis_sdk_jobs::contract::CONTRACT_JSON;
    let jobs_contract_digest = digest_contract_json(jobs_contract_json).into_diagnostic()?;
    SdkAuthClient::new(&admin_client)
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(jobs_contract_json)?,
            deployment_id: JOBS_DEPLOYMENT_ID.to_string(),
            expected_digest: jobs_contract_digest,
        })
        .await
        .into_diagnostic()?;

    let (jobs_service_seed, jobs_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis_sdk_auth::AuthServiceInstancesProvisionRequest {
            deployment_id: JOBS_DEPLOYMENT_ID.to_string(),
            instance_key: jobs_service_key,
        })
        .await
        .into_diagnostic()?;

    let jobs_db_path = std::env::temp_dir().join(format!(
        "trellis-integration-jobs-{}.sqlite",
        setup_login.state.session_key
    ));
    std::env::set_var("TRELLIS_JOBS_DB_PATH", &jobs_db_path);
    let jobs_service = connect_jobs_service_with_retry(trellis_url, &jobs_service_seed).await?;
    let jobs_nats = jobs_service.nats().clone();
    let jobs_service_task = tokio::spawn(async move {
        let result = jobs_service.run().await;
        if let Err(error) = &result {
            eprintln!("warning: Jobs service runtime exited before shutdown: {error}");
        }
        result
    });
    let local_jobs_services =
        setup_service_local_jobs(trellis_url, &auth_client, &admin_client).await?;

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
            .jobs_list(&JobsListRequest {
                cursor: None,
                limit: Some(20),
                service: Some(HARNESS_JOBS_SERVICE.to_string()),
                since: None,
                state: None,
                r#type: Some(HARNESS_JOBS_QUEUE.to_string()),
            })
            .await
            .into_diagnostic()?;
        if !list.jobs.iter().any(|job| job.id == "job-cancel-1") {
            return Err(miette!("Jobs.List did not include seeded pending job"));
        }
        assert_jobs_list_filters(&jobs_client).await?;

        let cancelled = jobs_client
            .jobs_cancel(&JobsCancelRequest {
                id: "job-cancel-1".to_string(),
            })
            .await
            .into_diagnostic()?;
        assert_state(&cancelled.job.state, "cancelled", "Jobs.Cancel")?;

        let retried = jobs_client
            .jobs_retry(&JobsRetryRequest {
                id: "job-failed-1".to_string(),
            })
            .await
            .into_diagnostic()?;
        assert_state(&retried.job.state, "pending", "Jobs.Retry")?;

        let dlq = jobs_client
            .jobs_list_dlq(&JobsListDLQRequest {
                cursor: None,
                limit: Some(20),
                service: Some(HARNESS_JOBS_SERVICE.to_string()),
                since: None,
                state: None,
                r#type: Some(HARNESS_JOBS_QUEUE.to_string()),
            })
            .await
            .into_diagnostic()?;
        if !dlq.jobs.iter().any(|job| job.id == "job-dead-replay-1")
            || !dlq.jobs.iter().any(|job| job.id == "job-dead-dismiss-1")
        {
            return Err(miette!("Jobs.ListDLQ did not include seeded dead jobs"));
        }

        let replayed = jobs_client
            .jobs_replay_dlq(&JobsReplayDLQRequest {
                id: "job-dead-replay-1".to_string(),
            })
            .await
            .into_diagnostic()?;
        assert_state(&replayed.job.state, "pending", "Jobs.ReplayDLQ")?;

        let dismissed = jobs_client
            .jobs_dismiss_dlq(&JobsDismissDLQRequest {
                id: "job-dead-dismiss-1".to_string(),
            })
            .await
            .into_diagnostic()?;
        assert_state(&dismissed.job.state, "dismissed", "Jobs.DismissDLQ")?;

        if jobs_client
            .jobs_retry(&JobsRetryRequest {
                id: "job-dead-dismiss-1".to_string(),
            })
            .await
            .is_ok()
        {
            return Err(miette!("Jobs.Retry unexpectedly accepted dismissed job"));
        }

        let read_denied_login = reauth_contract(
            &caller_login.state,
            &jobs_caller_contract_json(false, true)?,
            trellis_url,
            browser,
        )
        .await?;
        let read_denied_client = connect_admin_client_async(&read_denied_login.state)
            .await
            .into_diagnostic()?;
        if JobsClient::new(&read_denied_client)
            .jobs_list(&JobsListRequest {
                cursor: None,
                limit: Some(1),
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

        Ok(PASSING_CASES)
    }
    .await;

    jobs_service_task.abort();
    let _ = jobs_service_task.await;
    call_result
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
        use_contract(trellis_sdk_jobs::CONTRACT_ID).with_rpc_call(calls),
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
    auth_client: &trellis_auth::AuthClient<'_>,
    admin_client: &TrellisClient,
) -> Result<LocalJobsServices> {
    auth_client
        .create_service_deployment(LOCAL_JOBS_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let contract_json = local_jobs_service_contract_json()?;
    let contract_digest = digest_contract_json(&contract_json).into_diagnostic()?;
    SdkAuthClient::new(admin_client)
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&contract_json)?,
            deployment_id: LOCAL_JOBS_DEPLOYMENT_ID.to_string(),
            expected_digest: contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;

    let (rust_service_seed, rust_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis_sdk_auth::AuthServiceInstancesProvisionRequest {
            deployment_id: LOCAL_JOBS_DEPLOYMENT_ID.to_string(),
            instance_key: rust_service_key,
        })
        .await
        .into_diagnostic()?;
    let (ts_service_seed, ts_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis_sdk_auth::AuthServiceInstancesProvisionRequest {
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
    let rust_cancelled = await_job_state(jobs_client, &rust_cancelled_job_id, "cancelled").await?;
    assert_state(
        &rust_cancelled.state,
        "cancelled",
        "Rust JobManager active cancel",
    )?;

    let ts_job_id = services.ts_process.wait_completed().await?;
    let ts_job = await_job_state(jobs_client, &ts_job_id, "completed").await?;
    assert_job_result(&ts_job, "ts-service-local", "ts", "TS service.jobs")?;
    let ts_cancelled_job_id = services.ts_process.wait_cancelled().await?;
    let ts_cancelled = await_job_state(jobs_client, &ts_cancelled_job_id, "cancelled").await?;
    assert_state(
        &ts_cancelled.state,
        "cancelled",
        "TS service.jobs active cancel",
    )?;
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
                "processedBy": "rust"
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
    cancel_job_for_cancel.state = trellis_jobs::JobState::Active;
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

fn assert_job_result(
    job: &trellis_sdk_jobs::types::JobsGetResponseJob,
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

async fn assert_jobs_list_filters(jobs_client: &JobsClient<'_>) -> Result<()> {
    let filtered = jobs_client
        .jobs_list(&JobsListRequest {
            cursor: None,
            limit: Some(10),
            service: Some(HARNESS_JOBS_SERVICE.to_string()),
            since: Some("2026-03-28T12:00:11.500Z".to_string()),
            state: Some(json!(["failed", "dead"])),
            r#type: Some(HARNESS_JOBS_QUEUE.to_string()),
        })
        .await
        .into_diagnostic()?;
    let ids = filtered
        .jobs
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

async fn connect_jobs_service_with_retry(
    trellis_url: &str,
    service_seed: &str,
) -> Result<trellis_service_jobs::ConnectedJobsService> {
    let mut last_error = None;
    for _ in 0..10 {
        match trellis_service_jobs::connect_service(ServiceConnectOptions {
            trellis_url,
            contract_id: trellis_sdk_jobs::CONTRACT_ID,
            contract_digest: trellis_sdk_jobs::CONTRACT_DIGEST,
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
        "failed to connect Jobs service: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "no connection attempt recorded".to_string())
    ))
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
            trellis_jobs::JobState::Active,
            1,
            "2026-03-28T12:00:11.000Z",
            "integration failure",
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
                trellis_jobs::JobState::Active,
                5,
                failed_at,
                "integration dead letter",
            ),
        )
        .await?;
    }
    Ok(())
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
            trellis_jobs::JobState::Pending,
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
    publish_job_event(
        nats,
        created_event(
            HARNESS_JOBS_SERVICE,
            HARNESS_JOBS_QUEUE,
            job_id,
            payload,
            5,
            timestamp,
            None,
        ),
    )
    .await
}

async fn publish_job_event(nats: &async_nats::Client, event: JobEvent) -> Result<()> {
    let jetstream = async_nats::jetstream::new(nats.clone());
    let ack = jetstream
        .publish(
            job_event_subject(
                &event.service,
                &event.job_type,
                &event.job_id,
                event.event_type,
            ),
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
    for _ in 0..200 {
        match jobs_client
            .jobs_health(&JobsHealthRequest(BTreeMap::new()))
            .await
        {
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
) -> Result<trellis_sdk_jobs::types::JobsListServicesResponseServicesItemWorkersItem> {
    for _ in 0..60 {
        let response = jobs_client
            .jobs_list_services(&JobsListServicesRequest(BTreeMap::new()))
            .await
            .into_diagnostic()?;
        if let Some(worker) = response
            .services
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

async fn await_job_state(
    jobs_client: &JobsClient<'_>,
    id: &str,
    expected_state: &str,
) -> Result<trellis_sdk_jobs::types::JobsGetResponseJob> {
    for _ in 0..80 {
        let response = jobs_client
            .jobs_get(&JobsGetRequest { id: id.to_string() })
            .await
            .into_diagnostic()?;
        if let Some(job) = response.job {
            if state_is(&job.state, expected_state) {
                return Ok(job);
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(miette!(
        "Jobs.Get did not project job `{id}` in state `{expected_state}`"
    ))
}

fn assert_state(state: &Value, expected: &str, context: &str) -> Result<()> {
    if state_is(state, expected) {
        return Ok(());
    }
    Err(miette!("{context} returned unexpected state `{state}`"))
}

fn state_is(state: &Value, expected: &str) -> bool {
    state.as_str() == Some(expected)
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
    state: &trellis_auth::AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis_auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_auth::AdminReauthOutcome::Flow(challenge) => {
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
struct TsLocalJobsServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsLocalJobsServiceProcess {
    fn start(trellis_url: &str, contract_digest: &str, service_seed: &str) -> Result<Self> {
        let repo = repo_root()?;
        let script_path =
            write_ts_fixture_script("local-jobs-service", TS_LOCAL_JOBS_SERVICE_SCRIPT)?;
        let stdout_log = script_path.with_extension("stdout.log");
        let stderr_log = script_path.with_extension("stderr.log");
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

fn write_ts_fixture_script(name: &str, contents: &str) -> Result<PathBuf> {
    let path = std::env::temp_dir().join(format!(
        "trellis-integration-{name}-{}-{}.ts",
        std::process::id(),
        unique_suffix()
    ));
    std::fs::write(&path, contents)
        .into_diagnostic()
        .map_err(|error| {
            miette!(
                "failed to write TS fixture script {}: {error}",
                path.display()
            )
        })?;
    Ok(path)
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}
