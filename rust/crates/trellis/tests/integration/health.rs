use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tokio::task::JoinHandle;
use trellis_rs::client::EventDescriptor;
use trellis_rs::contracts::{ContractKind, ContractManifestBuilder};
use trellis_rs::sdk::health::{events::HealthHeartbeatEventDescriptor, HealthHeartbeatEvent};
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

fn service_contract() -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = ContractManifestBuilder::new(
        HEALTH_SERVICE_ID,
        "Trellis Integration Health Service",
        "Exercises service health heartbeat publishing through the Rust SDK.",
        ContractKind::Service,
    )
    .use_ref(
        "health",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::health::CONTRACT_ID)
            .with_event_publish(["Health.Heartbeat"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn observer_contract() -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError>
{
    let manifest = ContractManifestBuilder::new(
        HEALTH_OBSERVER_ID,
        "Trellis Integration Health Observer",
        "App/client participant that observes service heartbeats.",
        ContractKind::App,
    )
    .use_ref(
        "health",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::health::CONTRACT_ID)
            .with_event_subscribe(["Health.Heartbeat"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

type ServiceTask = AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>>;

async fn setup_health_fixture() -> Result<
    (
        trellis_test::TrellisTestRuntime,
        tokio::sync::mpsc::Receiver<HealthHeartbeatEvent>,
        ServiceTask,
    ),
    Box<dyn std::error::Error>,
> {
    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await?;
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await?;
    let mut admin = runtime.admin();

    let svc_contract = service_contract()?;
    let obs_contract = observer_contract()?;

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &svc_contract, None, None)
        .await?;

    let client = admin.connect_client(&bootstrap_url, &obs_contract).await?;

    let (tx, rx) = tokio::sync::mpsc::channel(16);

    let mut heartbeat_stream = {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match client.subscribe::<HealthHeartbeatEventDescriptor>().await {
                Ok(stream) => break stream,
                Err(error) if Instant::now() < deadline => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    let _ = error;
                }
                Err(error) => return Err(Box::new(error)),
            }
        }
    };

    tokio::spawn(async move {
        while let Some(event) = heartbeat_stream.next().await {
            match event {
                Ok(evt) => {
                    let _ = tx.send(evt).await;
                }
                Err(_) => break,
            }
        }
    });

    let service = trellis_rs::service::ConnectedServiceRuntime::<HealthServiceContract>::connect(
        runtime.service_connect_options("health-fixture-service", &service_key),
    )
    .await?;

    let service_task = ServiceTask::new(tokio::spawn(async move { service.run().await }));

    Ok((runtime, rx, service_task))
}

async fn wait_for_heartbeat(
    rx: &mut tokio::sync::mpsc::Receiver<HealthHeartbeatEvent>,
) -> HealthHeartbeatEvent {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
            Ok(Some(event)) => {
                if event.service.name == HEALTH_SERVICE_ID {
                    return event;
                }
            }
            Ok(None) => {
                panic!("heartbeat channel closed");
            }
            Err(_timeout) => {
                if Instant::now() >= deadline {
                    panic!("timed out waiting for health service heartbeat");
                }
            }
        }
    }
}

async fn setup_health_fixture_with_envelope() -> Result<
    (
        trellis_test::TrellisTestRuntime,
        tokio::sync::mpsc::Receiver<async_nats::Message>,
        ServiceTask,
    ),
    Box<dyn std::error::Error>,
> {
    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await?;
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await?;
    let mut admin = runtime.admin();

    let svc_contract = service_contract()?;
    let obs_contract = observer_contract()?;

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &svc_contract, None, None)
        .await?;

    let (tx, rx) = tokio::sync::mpsc::channel(16);

    let client = admin.connect_client(&bootstrap_url, &obs_contract).await?;
    let mut subscriber = client
        .internal_nats()
        .subscribe(HealthHeartbeatEventDescriptor::SUBJECT.to_string())
        .await?;

    tokio::spawn(async move {
        while let Some(msg) = subscriber.next().await {
            let _ = tx.send(msg).await;
        }
    });

    let service = trellis_rs::service::ConnectedServiceRuntime::<HealthServiceContract>::connect(
        runtime.service_connect_options("health-fixture-service", &service_key),
    )
    .await?;

    let service_task = ServiceTask::new(tokio::spawn(async move { service.run().await }));

    Ok((runtime, rx, service_task))
}

async fn wait_for_heartbeat_msg(
    rx: &mut tokio::sync::mpsc::Receiver<async_nats::Message>,
) -> async_nats::Message {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
            Ok(Some(msg)) => {
                let event: HealthHeartbeatEvent =
                    serde_json::from_slice(msg.payload.as_ref()).unwrap();
                if event.service.name == HEALTH_SERVICE_ID {
                    return msg;
                }
            }
            Ok(None) => {
                panic!("heartbeat channel closed");
            }
            Err(_timeout) => {
                if Instant::now() >= deadline {
                    panic!("timed out waiting for health service heartbeat message");
                }
            }
        }
    }
}

#[tokio::test]
async fn health_client_subscribes_to_heartbeats() {
    assert_case_registered("health.client-subscribes-to-heartbeats", "health", "health");

    let (_runtime, mut rx, service_task) = setup_health_fixture().await.unwrap();
    let heartbeat = wait_for_heartbeat(&mut rx).await;

    assert_eq!(heartbeat.status, "healthy");
    assert!(heartbeat.service.instance_id.len() > 0);

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn health_heartbeat_includes_service_metadata() {
    assert_case_registered(
        "health.heartbeat-includes-service-metadata",
        "health",
        "health",
    );

    let (_runtime, mut rx, service_task) = setup_health_fixture().await.unwrap();
    let heartbeat = wait_for_heartbeat(&mut rx).await;

    assert_eq!(heartbeat.status, "healthy");
    assert_eq!(heartbeat.service.kind, "service");
    assert_eq!(heartbeat.service.contract_id, HEALTH_SERVICE_ID);
    assert!(heartbeat.service.contract_digest.len() > 0);
    assert_eq!(heartbeat.service.runtime, "rust");
    assert!(heartbeat.service.instance_id.len() > 0);
    assert!(!heartbeat.service.started_at.is_empty());

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn health_heartbeat_includes_custom_checks() {
    assert_case_registered(
        "health.heartbeat-includes-custom-checks",
        "health",
        "health",
    );

    let (_runtime, mut rx, service_task) = setup_health_fixture().await.unwrap();
    let heartbeat = wait_for_heartbeat(&mut rx).await;

    assert!(heartbeat
        .checks
        .iter()
        .any(|check| check.name == "nats" && check.status == "ok"));

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn health_heartbeat_event_context_is_populated() {
    assert_case_registered(
        "health.heartbeat-event-context-is-populated",
        "health",
        "health",
    );

    let (_runtime, mut rx, service_task) = setup_health_fixture_with_envelope().await.unwrap();
    let msg = wait_for_heartbeat_msg(&mut rx).await;

    assert_eq!(
        HealthHeartbeatEventDescriptor::SUBJECT,
        "events.v1.Health.Heartbeat"
    );
    let headers = msg.headers.as_ref().expect("heartbeat should have headers");
    let event_id = headers.get("Nats-Msg-Id").map(|value| value.as_str());
    assert!(event_id.is_some());
    assert!(!event_id.unwrap().is_empty());
    let event_time = headers
        .get("Trellis-Event-Time")
        .map(|value| value.as_str());
    assert!(event_time.is_some());
    assert!(!event_time.unwrap().is_empty());

    service_task.abort_and_wait().await;
}
