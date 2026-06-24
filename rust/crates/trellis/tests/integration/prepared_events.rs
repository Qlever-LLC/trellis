use std::sync::Arc;
use std::time::{Duration, Instant};

use async_nats::HeaderMap;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use trellis_rs::client::{EventDescriptor, ServiceConnectWithContractOptions, TrellisClient};
use trellis_rs::service::{
    ConnectedServiceRuntime, ServerError, ServiceEventListenOptions, ServiceEventListenerContext,
    ServiceEventListenerMode, ServiceRuntimeError,
};

use crate::support::assertions::assert_service_case_registered;

const CASE_ID: &str =
    "prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error";
const TRACEPARENT: &str = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
const STATUS: &str = "prepared-status";

const PREPARED_EVENTS_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.prepared-events-rust@v1",
  "displayName": "Trellis Rust Prepared Events",
  "description": "Publishes and consumes prepared events for Rust integration parity.",
  "kind": "service",
  "capabilities": {
    "publishEvents": {
      "displayName": "Publish prepared events",
      "description": "Publish prepared event fixture records."
    },
    "readEvents": {
      "displayName": "Read prepared events",
      "description": "Subscribe to prepared event fixture records."
    }
  },
  "schemas": {
    "EntityChanged": {
      "type": "object",
      "required": ["id", "value"],
      "properties": {
        "id": { "type": "string" },
        "value": { "type": "string" },
        "header": { "type": "string" }
      }
    }
  },
  "events": {
    "Entity.Changed": {
      "version": "v1",
      "subject": "events.v1.integration.prepared-events.rust.entity.changed",
      "event": { "schema": "EntityChanged" },
      "capabilities": {
        "publish": ["publishEvents"],
        "subscribe": ["readEvents"]
      }
    }
  }
}"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityChangedEvent {
    id: String,
    value: String,
    header: String,
}

struct EntityChanged;

impl EventDescriptor for EntityChanged {
    type Event = EntityChangedEvent;

    const KEY: &'static str = "Entity.Changed";
    const SUBJECT: &'static str = "events.v1.integration.prepared-events.rust.entity.changed";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["publishEvents"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readEvents"];
}

#[tokio::test]
async fn prepared_events_prepared_publish_preserves_custom_headers_and_annotates_handler_error() {
    assert_service_case_registered(CASE_ID, "prepared-events", "prepared_events");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let contract =
        trellis_test::TrellisTestContract::from_manifest_json(PREPARED_EVENTS_CONTRACT_JSON)
            .expect("build prepared-events contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &contract, None, None)
        .await
        .expect("provision prepared-events service instance");
    let client = TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url: runtime.trellis_url(),
        contract_id: contract_id(&contract),
        contract_digest: contract.digest(),
        contract_json: PREPARED_EVENTS_CONTRACT_JSON,
        session_key_seed_base64url: &service_key.seed,
        timeout_ms: 5_000,
        retry_delay_ms: 100,
        authority_pending_timeout_ms: 30_000,
    })
    .await
    .expect("connect prepared-events service");
    let service = ConnectedServiceRuntime::<()>::from_connected_client(
        "prepared-events-rust-service",
        Arc::new(client),
    )
    .expect("build connected prepared-events runtime");

    let mut raw_observer = service
        .client()
        .internal_nats()
        .subscribe(EntityChanged::SUBJECT.to_string())
        .await
        .expect("subscribe raw observer");
    let observed = Arc::new(Mutex::new(
        None::<(EntityChangedEvent, ServiceEventListenerContext)>,
    ));
    let handler_observed = Arc::clone(&observed);
    let listener = service
        .listen_event::<EntityChanged, _, _>(
            move |event, context| {
                let handler_observed = Arc::clone(&handler_observed);
                async move {
                    *handler_observed.lock().await = Some((event, context));
                    Err(ServerError::Nats("prepared handler denied".to_string()))
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Ephemeral,
                group: None,
                durable_name: None,
            },
        )
        .await
        .expect("start prepared-events listener");

    let payload = EntityChangedEvent {
        id: "entity-prepared-rust-1".to_string(),
        value: "prepared".to_string(),
        header: "payload-header-value".to_string(),
    };
    let mut headers = HeaderMap::new();
    headers.insert("status", STATUS);
    headers.insert("traceparent", TRACEPARENT);
    let prepared = service
        .client()
        .prepare_event::<EntityChanged>(&payload)
        .expect("prepare event")
        .with_headers(headers);

    service
        .client()
        .publish_prepared(&prepared)
        .await
        .expect("publish prepared event");

    let listener_error = tokio::time::timeout(Duration::from_secs(5), listener)
        .await
        .expect("listener returns handler error")
        .expect("listener task joins")
        .expect_err("handler error is surfaced");

    let raw = tokio::time::timeout(Duration::from_secs(5), raw_observer.next())
        .await
        .expect("raw observer receives event")
        .expect("raw observer message");
    let raw_headers = raw.headers.as_ref().expect("raw event headers");
    assert_eq!(
        raw_headers.get("status").map(|value| value.as_str()),
        Some(STATUS)
    );
    assert_eq!(
        raw_headers.get("traceparent").map(|value| value.as_str()),
        Some(TRACEPARENT)
    );
    assert_eq!(
        raw_headers.get("Nats-Msg-Id").map(|value| value.as_str()),
        Some(prepared.event_id())
    );
    assert_eq!(
        raw_headers
            .get("Trellis-Event-Time")
            .map(|value| value.as_str()),
        Some(prepared.event_time())
    );
    assert_eq!(raw.payload.as_ref(), prepared.payload());

    let (observed_event, observed_context) = wait_for_observed(&observed).await;
    assert_eq!(observed_event, payload);
    assert_eq!(observed_context.id.as_deref(), Some(prepared.event_id()));
    assert_eq!(
        observed_context.time.as_deref(),
        Some(prepared.event_time())
    );
    assert_eq!(observed_context.traceparent.as_deref(), Some(TRACEPARENT));
    assert_eq!(
        observed_context
            .headers
            .get("status")
            .map(|value| value.as_str()),
        Some(STATUS)
    );

    match listener_error {
        ServiceRuntimeError::EventHandler { source, context } => {
            assert!(
                matches!(source, ServerError::Nats(message) if message == "prepared handler denied")
            );
            assert_eq!(context.id.as_deref(), Some(prepared.event_id()));
            assert_eq!(context.time.as_deref(), Some(prepared.event_time()));
            assert_eq!(context.traceparent.as_deref(), Some(TRACEPARENT));
            assert_eq!(
                context.headers.get("status").map(|value| value.as_str()),
                Some(STATUS)
            );
        }
        other => panic!("expected annotated event handler error, got {other:?}"),
    }
}

fn contract_id(contract: &trellis_test::TrellisTestContract) -> &str {
    contract
        .manifest()
        .get("id")
        .and_then(serde_json::Value::as_str)
        .expect("contract manifest has string id")
}

async fn wait_for_observed(
    observed: &Arc<Mutex<Option<(EntityChangedEvent, ServiceEventListenerContext)>>>,
) -> (EntityChangedEvent, ServiceEventListenerContext) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(value) = observed.lock().await.clone() {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for observed event"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
