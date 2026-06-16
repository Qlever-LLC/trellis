use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tokio::task::JoinHandle;
use trellis_rs::sdk::health::events::HealthHeartbeatEventDescriptor;
use trellis_rs::service::GeneratedServiceContract;

use crate::support::assertions::assert_case_registered;

const HEALTH_SERVICE_ID: &str = "trellis.integration.health-service@v1";
const HEALTH_OBSERVER_ID: &str = "trellis.integration.health-observer@v1";

const HEALTH_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.health-service@v1",
  "displayName": "Trellis Integration Health Service",
  "description": "Exercises service health heartbeat publishing through the Rust SDK.",
  "kind": "service",
  "uses": {
    "required": {
      "health": {
        "contract": "trellis.health@v1",
        "events": { "publish": ["Health.Heartbeat"] }
      }
    }
  }
}"#;

struct HealthServiceContract;

impl GeneratedServiceContract for HealthServiceContract {
    const CONTRACT_ID: &'static str = HEALTH_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "b4dLoNYLLrY4j-FhFGcMBbNG-mYw4xf3dQUBYDgGU34";
    const CONTRACT_JSON: &'static str = HEALTH_SERVICE_CONTRACT_JSON;
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

#[tokio::test]
#[ignore]
async fn health_client_observes_service_heartbeat() {
    assert_case_registered(
        "health.client-observes-service-heartbeat",
        "health",
        "health",
    );

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
        trellis_test::TrellisTestContract::from_manifest_json(HEALTH_SERVICE_CONTRACT_JSON)
            .expect("build health service test contract");
    assert_eq!(
        service_contract.digest(),
        HealthServiceContract::CONTRACT_DIGEST
    );

    let observer_contract =
        observer_client_contract().expect("build health observer test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live health service instance");

    let client = admin
        .connect_client(&bootstrap_url, &observer_contract)
        .await
        .expect("connect live Rust health observer client");

    let mut heartbeat_stream = client
        .subscribe::<HealthHeartbeatEventDescriptor>()
        .await
        .expect("subscribe to Health.Heartbeat events");

    let service = trellis_rs::service::ConnectedServiceRuntime::<HealthServiceContract>::connect(
        runtime.service_connect_options("health-fixture-service", &service_key),
    )
    .await
    .expect("connect live Rust health service");

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let deadline = Instant::now() + Duration::from_secs(10);
    let heartbeat = loop {
        match tokio::time::timeout(Duration::from_millis(500), heartbeat_stream.next()).await {
            Ok(Some(Ok(event))) => {
                if event.service.name == HEALTH_SERVICE_ID {
                    break event;
                }
            }
            Ok(Some(Err(error))) => {
                panic!("heartbeat stream error: {error}");
            }
            Ok(None) => {
                panic!("heartbeat stream ended");
            }
            Err(_timeout) => {
                if Instant::now() >= deadline {
                    panic!("timed out waiting for health service heartbeat");
                }
            }
        }
    };

    assert_eq!(heartbeat.status, "healthy");
    assert_eq!(heartbeat.service.name, HEALTH_SERVICE_ID);
    assert_eq!(heartbeat.service.kind, "service");
    assert_eq!(heartbeat.service.runtime, "rust");
    assert!(heartbeat.service.instance_id.len() > 0);
    assert!(!heartbeat.service.started_at.is_empty());
    assert!(heartbeat
        .checks
        .iter()
        .any(|check| check.name == "nats" && check.status == "ok"));

    service_task.abort_and_wait().await;
}

fn observer_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        HEALTH_OBSERVER_ID,
        "Trellis Integration Health Observer",
        "App/client participant that observes service heartbeats.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "health",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::health::CONTRACT_ID)
            .with_event_subscribe(["Health.Heartbeat"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
