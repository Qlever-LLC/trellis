use std::{sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::json;
use trellis_rs::client::{ServiceConnectWithContractOptions, TrellisClient};
use trellis_rs::jobs::keys::NatsKeyCoordinator;
use trellis_rs::jobs::{
    runtime_ref::NatsJobWaiter, start_worker_host_from_client, JobManager, JobProcessError,
    JobsRuntimeBinding, NatsJobEventPublisher, TrellisJobMetaSource, WorkerActiveJob,
    WorkerHostOptions,
};
use trellis_rs::sdk::core::types::TrellisBindingsGetResponseBinding;
use trellis_rs::sdk::jobs::types::{
    JobsCancelRequest, JobsGetRequest, JobsListRequest, JobsListResponseEntriesItem,
    JobsListServicesRequest, JobsListServicesResponseEntriesItem,
};
use trellis_rs::service::ConnectedServiceRuntime;

use crate::support::assertions::assert_service_case_registered;

const CASE_ID: &str = "control-plane.jobs-admin-lists-and-cancels-job";
const SERVICE_CONTRACT_ID: &str =
    "trellis.integration.control-plane.jobs-admin-lists-and-cancels-job.service@v1";
const ADMIN_CLIENT_CONTRACT_ID: &str =
    "trellis.integration.control-plane.jobs-admin-lists-and-cancels-job.client@v1";
const SERVICE_NAME: &str = "jobs-admin-probe-service-rust";
const JOB_TYPE: &str = "holdOpen";
const MARKER: &str = "jobs-admin-probe-marker-rust";

const SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.jobs-admin-lists-and-cancels-job.service@v1",
  "displayName": "Trellis Control-Plane Jobs Admin Probe Service",
  "description": "Creates a long-running service-local job for Jobs admin integration coverage.",
  "kind": "service",
  "schemas": {
    "HoldPayload": {
      "type": "object",
      "required": ["marker"],
      "properties": { "marker": { "type": "string" } }
    },
    "HoldResult": {
      "type": "object",
      "required": ["cancelled"],
      "properties": { "cancelled": { "type": "boolean" } }
    }
  },
  "jobs": {
    "holdOpen": {
      "payload": { "schema": "HoldPayload" },
      "result": { "schema": "HoldResult" }
    }
  }
}"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HoldPayload {
    marker: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HoldResult {
    cancelled: bool,
}

#[tokio::test]
async fn control_plane_jobs_admin_lists_and_cancels_job() {
    assert_service_case_registered(CASE_ID, "control-plane", "control_plane_jobs_admin");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(SERVICE_CONTRACT_JSON)
            .expect("build jobs admin probe service contract");
    let admin_client_contract =
        jobs_admin_client_contract().expect("build jobs admin probe client contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live jobs admin probe service instance");

    let service_client =
        TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
            trellis_url: runtime.trellis_url(),
            contract_id: SERVICE_CONTRACT_ID,
            contract_digest: service_contract.digest(),
            contract_json: SERVICE_CONTRACT_JSON,
            session_key_seed_base64url: &service_key.seed,
            timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
            retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
            authority_pending_timeout_ms: trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
        })
        .await
        .expect("connect live Rust jobs admin probe service");
    let service = ConnectedServiceRuntime::<()>::from_connected_client(
        SERVICE_NAME,
        Arc::new(service_client),
    )
    .expect("build connected jobs admin probe service runtime");
    let nats = service.client().internal_nats().clone();
    let trellis_binding: &TrellisBindingsGetResponseBinding = service.binding().as_ref();
    let jobs_runtime = JobsRuntimeBinding::try_from(trellis_binding)
        .expect("parse jobs admin probe runtime binding");
    let queue_binding = jobs_runtime
        .jobs
        .queues
        .get(JOB_TYPE)
        .expect("holdOpen queue binding")
        .clone();
    let publisher = NatsJobEventPublisher::new(nats.clone());
    let key_coordinator =
        NatsKeyCoordinator::open_for_service(nats.clone(), jobs_runtime.jobs.namespace.as_str())
            .await
            .expect("open jobs admin probe key coordinator");
    let manager = JobManager::new_with_key_coordinator(
        publisher,
        jobs_runtime.jobs.clone(),
        TrellisJobMetaSource,
        Arc::new(key_coordinator),
    );
    let waiter = NatsJobWaiter::new(nats, queue_binding, Duration::from_secs(15));
    let started = Arc::new(tokio::sync::Notify::new());
    let worker_started = Arc::clone(&started);

    let worker_host = start_worker_host_from_client(
        &*service.client(),
        jobs_runtime,
        SERVICE_NAME.to_string(),
        |_, _| TrellisJobMetaSource,
        move |active_job: WorkerActiveJob<_, _>| {
            let worker_started = Arc::clone(&worker_started);
            async move {
                worker_started.notify_one();
                while !active_job.is_cancelled() {
                    active_job
                        .heartbeat()
                        .await
                        .map_err(|error| JobProcessError::failed(error.to_string()))?;
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                serde_json::to_value(HoldResult { cancelled: true })
                    .map_err(|error| JobProcessError::failed(error.to_string()))
            }
        },
        WorkerHostOptions::default(),
    )
    .await
    .expect("start jobs admin probe worker host");

    let admin_client = admin
        .connect_client(&bootstrap_url, &admin_client_contract)
        .await
        .expect("connect live Rust jobs admin probe client");
    let jobs_admin = trellis_rs::sdk::jobs::JobsClient::new(&admin_client);

    let job = manager
        .create(
            JOB_TYPE,
            HoldPayload {
                marker: MARKER.to_string(),
            },
        )
        .await
        .expect("create service-local holdOpen job");
    tokio::time::timeout(Duration::from_secs(15), started.notified())
        .await
        .expect("worker should start the holdOpen job");

    let health = jobs_admin
        .rpc()
        .jobs()
        .health()
        .await
        .expect("call generated Jobs.Health");
    assert_eq!(health.service, "trellis.jobs");
    assert_eq!(health.status, json!("healthy"));

    let listed_job = wait_for_listed_job(&jobs_admin, &job.service, &job.job_type, &job.id).await;
    assert_eq!(listed_job.service, job.service);
    assert_eq!(listed_job.r#type, job.job_type);

    let listed_service = wait_for_listed_service(&jobs_admin, &job.service, &job.job_type).await;
    assert!(
        listed_service
            .workers
            .iter()
            .any(|worker| worker.job_type == job.job_type),
        "expected Jobs.ListServices to include a worker for {}",
        job.job_type
    );

    let detail = jobs_admin
        .rpc()
        .jobs()
        .get(&JobsGetRequest { id: job.id.clone() })
        .await
        .expect("call generated Jobs.Get");
    assert_eq!(detail.job.id, job.id);
    assert_eq!(detail.job.service, job.service);
    assert_eq!(detail.job.r#type, job.job_type);
    assert_eq!(detail.job.payload, json!({ "marker": MARKER }));

    let cancelled = jobs_admin
        .rpc()
        .jobs()
        .cancel(&JobsCancelRequest { id: job.id.clone() })
        .await
        .expect("call generated Jobs.Cancel");
    assert_eq!(cancelled.job.id, job.id);

    let terminal = wait_for_cancelled_job(&jobs_admin, &job.id).await;
    assert_eq!(terminal.state, "cancelled");
    let local_terminal = waiter
        .wait_for_terminal(job)
        .await
        .expect("service-local wait observes terminal cancelled");
    assert_eq!(local_terminal.state, trellis_rs::jobs::JobState::Cancelled);

    worker_host
        .stop()
        .await
        .expect("stop jobs admin probe worker host");
}

fn jobs_admin_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        ADMIN_CLIENT_CONTRACT_ID,
        "Trellis Control-Plane Jobs Admin Probe Client",
        "Uses the generated Jobs admin SDK surface.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "jobs",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::jobs::CONTRACT_ID).with_rpc_call([
            "Jobs.Health",
            "Jobs.List",
            "Jobs.Get",
            "Jobs.Cancel",
            "Jobs.ListServices",
        ]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

async fn wait_for_listed_job(
    jobs_admin: &trellis_rs::sdk::jobs::JobsClient<'_>,
    service: &str,
    job_type: &str,
    job_id: &str,
) -> JobsListResponseEntriesItem {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let page = jobs_admin
            .rpc()
            .jobs()
            .list(&JobsListRequest {
                service: Some(service.to_string()),
                r#type: Some(job_type.to_string()),
                state: None,
                since: None,
                offset: None,
                limit: 20,
            })
            .await
            .expect("call generated Jobs.List");
        if let Some(entry) = page.entries.into_iter().find(|entry| entry.id == job_id) {
            return entry;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Jobs.List did not return job before timeout"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_listed_service(
    jobs_admin: &trellis_rs::sdk::jobs::JobsClient<'_>,
    service: &str,
    job_type: &str,
) -> JobsListServicesResponseEntriesItem {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let page = jobs_admin
            .rpc()
            .jobs()
            .list_services(&JobsListServicesRequest {
                offset: None,
                limit: 20,
            })
            .await
            .expect("call generated Jobs.ListServices");
        if let Some(entry) = page.entries.into_iter().find(|entry| {
            entry.name == service
                && entry
                    .workers
                    .iter()
                    .any(|worker| worker.job_type == job_type)
        }) {
            return entry;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Jobs.ListServices did not return service worker before timeout"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_cancelled_job(
    jobs_admin: &trellis_rs::sdk::jobs::JobsClient<'_>,
    job_id: &str,
) -> trellis_rs::sdk::jobs::types::JobsGetResponseJob {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let current = jobs_admin
            .rpc()
            .jobs()
            .get(&JobsGetRequest {
                id: job_id.to_string(),
            })
            .await
            .expect("call generated Jobs.Get while polling cancellation");
        if current.job.state == "cancelled" {
            return current.job;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Jobs.Get did not reach cancelled before timeout"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
