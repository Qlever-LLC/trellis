use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;

use crate::support::assertions::assert_case_registered;

const EVENTS_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.events-service@v1",
  "displayName": "Trellis Integration Events Service",
  "description": "Exercises generated event publish and subscribe surfaces.",
  "kind": "service",
  "capabilities": {
    "publishRecords": {
      "displayName": "Publish records",
      "description": "Publish entity change records in the events fixture."
    },
    "readRecords": {
      "displayName": "Read records",
      "description": "Subscribe to entity change records in the events fixture."
    }
  },
  "schemas": {
    "EntityChanged": {
      "type": "object",
      "required": ["id", "value"],
      "properties": {
        "id": { "type": "string" },
        "value": { "type": "string" }
      }
    }
  },
  "uses": {
    "required": {
      "health": {
        "contract": "trellis.health@v1",
        "events": { "publish": ["Health.Heartbeat"] }
      }
    }
  },
  "events": {
    "Entity.Changed": {
      "version": "v1",
      "subject": "events.v1.Entity.Changed",
      "event": { "schema": "EntityChanged" },
      "capabilities": {
        "publish": ["publishRecords"],
        "subscribe": ["readRecords"]
      }
    }
  }
}"#;

const EVENTS_SERVICE_CONTRACT_DIGEST: &str = "EeWk_ywRCCDx7idAtZsh9pFQCLJvxv_f3adMgcxEJVs";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityChangedEvent {
    id: String,
    value: String,
}

struct EntityChangedEventDescriptor;

impl trellis_rs::client::EventDescriptor for EntityChangedEventDescriptor {
    type Event = EntityChangedEvent;

    const KEY: &'static str = "Entity.Changed";
    const SUBJECT: &'static str = "events.v1.Entity.Changed";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["publishRecords"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readRecords"];
}

struct EventsServiceContract;

impl trellis_rs::service::GeneratedServiceContract for EventsServiceContract {
    const CONTRACT_ID: &'static str = "trellis.integration.events-service@v1";
    const CONTRACT_DIGEST: &'static str = EVENTS_SERVICE_CONTRACT_DIGEST;
    const CONTRACT_JSON: &'static str = EVENTS_SERVICE_CONTRACT_JSON;
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
async fn events_client_publishes_and_subscribes() {
    assert_case_registered("events.client-publishes-and-subscribes", "events", "events");

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
        trellis_test::TrellisTestContract::from_manifest_json(EVENTS_SERVICE_CONTRACT_JSON)
            .expect("build events service test contract");
    assert_eq!(service_contract.digest(), EVENTS_SERVICE_CONTRACT_DIGEST);

    let pubsub_client_contract =
        events_pubsub_client_contract().expect("build events pubsub client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live events service instance");

    let service = trellis_rs::service::ConnectedServiceRuntime::<EventsServiceContract>::connect(
        runtime.service_connect_options("events-fixture-service", &service_key),
    )
    .await
    .expect("connect live Rust events service");

    let observed_events = Arc::new(tokio::sync::Mutex::new(Vec::<EntityChangedEvent>::new()));
    let handler_observed_events = Arc::clone(&observed_events);

    let service_client = Arc::clone(service.client());
    let event_stream = service_client
        .subscribe::<EntityChangedEventDescriptor>()
        .await
        .expect("subscribe to Entity.Changed events");

    let event_collection_task = tokio::spawn(async move {
        let mut stream = event_stream;
        while let Some(result) = stream.next().await {
            match result {
                Ok(event) => {
                    handler_observed_events.lock().await.push(event);
                }
                Err(error) => {
                    eprintln!("event subscription error: {error}");
                    break;
                }
            }
        }
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &pubsub_client_contract)
        .await
        .expect("connect live Rust events pubsub client");

    let event = EntityChangedEvent {
        id: "entity-events-1".to_string(),
        value: "published".to_string(),
    };
    client
        .publish::<EntityChangedEventDescriptor>(&event)
        .await
        .expect("publish Entity.Changed event");

    tokio::time::sleep(Duration::from_secs(3)).await;

    event_collection_task.abort();
    let _ = event_collection_task.await;
    service_task.abort_and_wait().await;

    {
        let events = observed_events.lock().await;
        assert_eq!(events.len(), 1, "expected one event, got: {events:?}");
        assert_eq!(events[0], event);
    }

    assert_eq!(
        <EntityChangedEventDescriptor as trellis_rs::client::EventDescriptor>::KEY,
        "Entity.Changed"
    );
    assert_eq!(
        <EntityChangedEventDescriptor as trellis_rs::client::EventDescriptor>::SUBJECT,
        "events.v1.Entity.Changed"
    );
    assert_eq!(
        <EntityChangedEventDescriptor as trellis_rs::client::EventDescriptor>::PUBLISH_CAPABILITIES,
        &["publishRecords"]
    );
    assert_eq!(
        <EntityChangedEventDescriptor as trellis_rs::client::EventDescriptor>::SUBSCRIBE_CAPABILITIES,
        &["readRecords"]
    );
}

#[tokio::test]
#[ignore]
async fn events_denied_publish() {
    assert_case_registered("events.denied-publish", "events", "events");

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
        trellis_test::TrellisTestContract::from_manifest_json(EVENTS_SERVICE_CONTRACT_JSON)
            .expect("build events service test contract");

    let subscribe_only_client_contract = events_subscribe_only_client_contract()
        .expect("build events subscribe-only client test contract");

    admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live events service instance");

    let client = admin
        .connect_client(&bootstrap_url, &subscribe_only_client_contract)
        .await
        .expect("connect live Rust events subscribe-only client");

    let result = client
        .publish::<EntityChangedEventDescriptor>(&EntityChangedEvent {
            id: "entity-denied-1".to_string(),
            value: "should-not-publish".to_string(),
        })
        .await;

    assert!(
        result.is_err(),
        "expected publish to be denied for subscribe-only client"
    );

    let error = result.unwrap_err();
    eprintln!("denied publish error (expected): {error}");
}

fn events_pubsub_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.events-pubsub-client@v1",
        "Trellis Integration Events PubSub Client",
        "App/client participant with event publish and subscribe authority.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "eventsService",
        trellis_rs::contracts::use_contract("trellis.integration.events-service@v1")
            .with_event_publish(["Entity.Changed"])
            .with_event_subscribe(["Entity.Changed"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn events_subscribe_only_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.events-subscribe-only-client@v1",
        "Trellis Integration Events Subscribe-Only Client",
        "App/client participant without event publish authority.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "eventsService",
        trellis_rs::contracts::use_contract("trellis.integration.events-service@v1")
            .with_event_subscribe(["Entity.Changed"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
