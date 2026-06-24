use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};
use trellis_rs::client::{EventDescriptor, ServiceConnectWithContractOptions, TrellisClient};
use trellis_rs::service::{
    ConnectedServiceRuntime, ServiceEventListenOptions, ServiceEventListenerContext,
    ServiceEventListenerMode, ServiceRuntimeError,
};

use crate::support::assertions::assert_service_case_registered;

const SOURCE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.event-consumers-source-rust@v1",
  "displayName": "Trellis Rust Event Consumers Source",
  "description": "Publishes source events for Rust durable consumer integration tests.",
  "kind": "service",
  "capabilities": {
    "publishEvents": {
      "displayName": "Publish event-consumer fixture events",
      "description": "Publish source events for durable consumer tests."
    },
    "readEvents": {
      "displayName": "Read event-consumer fixture events",
      "description": "Subscribe to source events for durable consumer tests."
    }
  },
  "schemas": {
    "EventRecord": {
      "type": "object",
      "required": ["id", "value"],
      "properties": {
        "id": { "type": "string" },
        "value": { "type": "string" }
      }
    }
  },
    "events": {
    "Source.Pinged": {
      "version": "v1",
      "subject": "events.v1.integration.event-consumers.rust.source.pinged",
      "event": { "schema": "EventRecord" },
      "capabilities": {
        "publish": ["publishEvents"],
        "subscribe": ["readEvents"]
      }
    },
    "Source.Ponged": {
      "version": "v1",
      "subject": "events.v1.integration.event-consumers.rust.source.ponged",
      "event": { "schema": "EventRecord" },
      "capabilities": {
        "publish": ["publishEvents"],
        "subscribe": ["readEvents"]
      }
    }
  }
}"#;

const MISSING_GROUP_CONSUMER_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.event-consumers-missing-group-rust@v1",
  "displayName": "Trellis Rust Event Consumers Missing Group",
  "description": "Uses source events but intentionally declares no durable event consumer group.",
  "kind": "service",
  "schemas": {
    "EventRecord": {
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
      "source": {
        "contract": "trellis.integration.event-consumers-source-rust@v1",
        "events": { "subscribe": ["Source.Pinged"] }
      }
    }
  }
}"#;

const AMBIGUOUS_GROUP_CONSUMER_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.event-consumers-ambiguous-group-rust@v1",
  "displayName": "Trellis Rust Event Consumers Ambiguous Group",
  "description": "Declares two durable groups for one source event to require an explicit group.",
  "kind": "service",
  "schemas": {
    "EventRecord": {
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
      "source": {
        "contract": "trellis.integration.event-consumers-source-rust@v1",
        "events": { "subscribe": ["Source.Pinged"] }
      }
    }
  },
  "eventConsumers": {
    "primary": {
      "uses": { "source": ["Source.Pinged"] },
      "ackWaitMs": 1000,
      "maxDeliver": 2
    },
    "secondary": {
      "uses": { "source": ["Source.Pinged"] },
      "ackWaitMs": 1000,
      "maxDeliver": 2
    }
  }
}"#;

const DEPENDENCY_CONSUMER_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.event-consumers-dependency-rust@v1",
  "displayName": "Trellis Rust Event Consumers Dependency",
  "description": "Consumes source events through one Trellis-provisioned durable group.",
  "kind": "service",
  "schemas": {
    "EventRecord": {
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
      "source": {
        "contract": "trellis.integration.event-consumers-source-rust@v1",
        "events": { "subscribe": ["Source.Pinged"] }
      }
    }
  },
  "eventConsumers": {
    "ingest": {
      "uses": { "source": ["Source.Pinged"] },
      "ackWaitMs": 1000,
      "maxDeliver": 2
    }
  }
}"#;

const GROUPED_DEPENDENCY_CONSUMER_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.event-consumers-grouped-dependency-rust@v1",
  "displayName": "Trellis Rust Event Consumers Grouped Dependency",
  "description": "Consumes two source events through one Trellis-provisioned durable group.",
  "kind": "service",
  "schemas": {
    "EventRecord": {
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
      "source": {
        "contract": "trellis.integration.event-consumers-source-rust@v1",
        "events": { "subscribe": ["Source.Pinged", "Source.Ponged"] }
      }
    }
  },
  "eventConsumers": {
    "paired": {
      "uses": { "source": ["Source.Pinged", "Source.Ponged"] },
      "ackWaitMs": 1000,
      "maxDeliver": 2
    }
  }
}"#;

const SELF_CONSUMER_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.event-consumers-self-rust@v1",
  "displayName": "Trellis Rust Event Consumers Self",
  "description": "Publishes and consumes self-owned events through durable groups.",
  "kind": "service",
  "schemas": {
    "EventRecord": {
      "type": "object",
      "required": ["id", "value"],
      "properties": {
        "id": { "type": "string" },
        "value": { "type": "string" }
      }
    }
  },
  "events": {
    "Self.Pinged": {
      "version": "v1",
      "subject": "events.v1.integration.event-consumers.rust.self.pinged",
      "event": { "schema": "EventRecord" }
    },
    "Self.Ponged": {
      "version": "v1",
      "subject": "events.v1.integration.event-consumers.rust.self.ponged",
      "event": { "schema": "EventRecord" }
    }
  },
  "eventConsumers": {
    "ingest": {
      "self": ["Self.Pinged"],
      "ackWaitMs": 1000,
      "maxDeliver": 2
    },
    "paired": {
      "self": ["Self.Pinged", "Self.Ponged"],
      "ackWaitMs": 1000,
      "maxDeliver": 2
    }
  }
}"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EventRecord {
    id: String,
    value: String,
}

struct SourcePingedEvent;

impl trellis_rs::client::EventDescriptor for SourcePingedEvent {
    type Event = EventRecord;

    const KEY: &'static str = "Source.Pinged";
    const SUBJECT: &'static str = "events.v1.integration.event-consumers.rust.source.pinged";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["publishEvents"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readEvents"];
}

struct SelfPingedEvent;

impl trellis_rs::client::EventDescriptor for SelfPingedEvent {
    type Event = EventRecord;

    const KEY: &'static str = "Self.Pinged";
    const SUBJECT: &'static str = "events.v1.integration.event-consumers.rust.self.pinged";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}

struct SourcePongedEvent;

impl trellis_rs::client::EventDescriptor for SourcePongedEvent {
    type Event = EventRecord;

    const KEY: &'static str = "Source.Ponged";
    const SUBJECT: &'static str = "events.v1.integration.event-consumers.rust.source.ponged";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["publishEvents"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readEvents"];
}

struct SelfPongedEvent;

impl trellis_rs::client::EventDescriptor for SelfPongedEvent {
    type Event = EventRecord;

    const KEY: &'static str = "Self.Ponged";
    const SUBJECT: &'static str = "events.v1.integration.event-consumers.rust.self.ponged";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}

#[tokio::test]
async fn event_consumers_durable_listen_without_declared_group_returns_err() {
    assert_service_case_registered(
        "event-consumers.durable-listen-without-declared-group-returns-err",
        "event-consumers",
        "event_consumers",
    );

    let (_runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        _runtime.trellis_url(),
        &bootstrap_url,
        MISSING_GROUP_CONSUMER_JSON,
        "event-consumers-missing-group-rust",
    )
    .await;

    let result = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            |_event, _context| async { Ok(()) },
            ServiceEventListenOptions::default(),
        )
        .await;

    assert!(
        matches!(
            result,
            Err(ServiceRuntimeError::MissingEventConsumerGroup { ref subject })
                if subject == SourcePingedEvent::SUBJECT
        ),
        "expected missing group error, got {result:?}"
    );
}

#[tokio::test]
async fn event_consumers_ambiguous_group_without_opts_group_returns_err_and_specifying_group_works()
{
    assert_service_case_registered(
        "event-consumers.ambiguous-group-without-opts-group-returns-err-and-specifying-group-works",
        "event-consumers",
        "event_consumers",
    );

    let (_runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        _runtime.trellis_url(),
        &bootstrap_url,
        AMBIGUOUS_GROUP_CONSUMER_JSON,
        "event-consumers-ambiguous-group-rust",
    )
    .await;

    let ambiguous = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            |_event, _context| async { Ok(()) },
            ServiceEventListenOptions::default(),
        )
        .await;
    assert!(
        matches!(
            ambiguous,
            Err(ServiceRuntimeError::AmbiguousEventConsumerGroup { ref subject, ref groups })
                if subject == SourcePingedEvent::SUBJECT
                    && groups.as_slice() == ["primary", "secondary"]
        ),
        "expected ambiguous group error, got {ambiguous:?}"
    );

    let observed = Arc::new(Mutex::new(
        None::<(EventRecord, ServiceEventListenerContext)>,
    ));
    let handler_observed = Arc::clone(&observed);
    let listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let handler_observed = Arc::clone(&handler_observed);
                async move {
                    *handler_observed.lock().await = Some((event, context));
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("primary".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start explicit primary listener");

    let publisher_contract = publisher_contract();
    let publisher = admin
        .connect_client(&bootstrap_url, &publisher_contract)
        .await
        .expect("connect event publisher client");
    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-primary".to_string(),
            value: "primary".to_string(),
        })
        .await
        .expect("publish source event");

    wait_for_observed(&observed, "rust-event-consumers-primary", Some("primary")).await;
    listener.abort();
    let _ = listener.await;
}

#[tokio::test]
async fn event_consumers_caller_provided_durable_name_returns_err() {
    assert_service_case_registered(
        "event-consumers.caller-provided-durable-name-returns-err",
        "event-consumers",
        "event_consumers",
    );

    let (_runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        _runtime.trellis_url(),
        &bootstrap_url,
        DEPENDENCY_CONSUMER_JSON,
        "event-consumers-dependency-rust",
    )
    .await;

    let result = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            |_event, _context| async { Ok(()) },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: None,
                durable_name: Some("caller-name".to_string()),
            },
        )
        .await;

    assert!(
        matches!(
            result,
            Err(ServiceRuntimeError::CallerDurableName { ref durable_name })
                if durable_name == "caller-name"
        ),
        "expected caller durable name error, got {result:?}"
    );
}

#[tokio::test]
async fn event_consumers_bound_dependency_consumer_uses_trellis_provisioned_consumer_only() {
    assert_service_case_registered(
        "event-consumers.bound-dependency-consumer-uses-trellis-provisioned-consumer-only",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        DEPENDENCY_CONSUMER_JSON,
        "event-consumers-dependency-rust",
    )
    .await;
    let binding = consumer
        .resources()
        .event_consumers
        .get("ingest")
        .expect("ingest event consumer binding");
    let before = matching_consumers(&runtime, SourcePingedEvent::SUBJECT).await;
    assert_eq!(before.len(), 1);
    assert_eq!(consumer_name(&before[0]), binding.consumer_name);

    let observed = Arc::new(Mutex::new(
        None::<(EventRecord, ServiceEventListenerContext)>,
    ));
    let handler_observed = Arc::clone(&observed);
    let listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let handler_observed = Arc::clone(&handler_observed);
                async move {
                    *handler_observed.lock().await = Some((event, context));
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("ingest".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start bound dependency listener");
    let after = matching_consumers(&runtime, SourcePingedEvent::SUBJECT).await;
    assert_eq!(after.len(), 1);
    assert_eq!(consumer_name(&after[0]), consumer_name(&before[0]));

    let publisher_contract = publisher_contract();
    let publisher = admin
        .connect_client(&bootstrap_url, &publisher_contract)
        .await
        .expect("connect event publisher client");
    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-bound".to_string(),
            value: "bound".to_string(),
        })
        .await
        .expect("publish source event");

    wait_for_observed(&observed, "rust-event-consumers-bound", Some("ingest")).await;
    listener.abort();
    let _ = listener.await;
}

#[tokio::test]
async fn event_consumers_transient_missing_consumer_retries_after_reconcile() {
    assert_service_case_registered(
        "event-consumers.transient-missing-consumer-retries-after-reconcile",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        DEPENDENCY_CONSUMER_JSON,
        "event-consumers-dependency-rust",
    )
    .await;
    let before = matching_consumers(&runtime, SourcePingedEvent::SUBJECT).await;
    assert_eq!(before.len(), 1);
    assert!(
        runtime
            .delete_trellis_jetstream_consumer(consumer_name(&before[0]))
            .await
            .expect("delete Trellis JetStream consumer"),
        "expected provisioned consumer to be deleted"
    );
    wait_for_matching_consumer_count(&runtime, SourcePingedEvent::SUBJECT, 0).await;

    let observed = Arc::new(Mutex::new(
        None::<(EventRecord, ServiceEventListenerContext)>,
    ));
    let handler_observed = Arc::clone(&observed);
    let listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let handler_observed = Arc::clone(&handler_observed);
                async move {
                    *handler_observed.lock().await = Some((event, context));
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("ingest".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start missing durable listener");

    admin
        .reconcile(&bootstrap_url, "test")
        .await
        .expect("reconcile test deployment");
    admin
        .wait_ready(&bootstrap_url, "test")
        .await
        .expect("wait for test deployment ready");
    wait_for_matching_consumer_count(&runtime, SourcePingedEvent::SUBJECT, 1).await;

    let publisher_contract = publisher_contract();
    let publisher = admin
        .connect_client(&bootstrap_url, &publisher_contract)
        .await
        .expect("connect event publisher client");
    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-transient-missing".to_string(),
            value: "recovered".to_string(),
        })
        .await
        .expect("publish recovered source event");

    wait_for_observed(
        &observed,
        "rust-event-consumers-transient-missing",
        Some("ingest"),
    )
    .await;
    listener.abort();
    let _ = listener.await;
}

#[tokio::test]
async fn event_consumers_readiness_lost_does_not_nak_delivered_group_message() {
    assert_service_case_registered(
        "event-consumers.readiness-lost-does-not-nak-delivered-group-message",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        GROUPED_DEPENDENCY_CONSUMER_JSON,
        "event-consumers-grouped-dependency-rust",
    )
    .await;
    let ack_observer = runtime
        .start_jetstream_ack_observer()
        .await
        .expect("start JetStream ACK observer");

    let observed_ping = Arc::new(Mutex::new(None::<String>));
    let handler_observed_ping = Arc::clone(&observed_ping);
    let ping_listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let handler_observed_ping = Arc::clone(&handler_observed_ping);
                async move {
                    assert_eq!(context.group.as_deref(), Some("paired"));
                    *handler_observed_ping.lock().await = Some(event.id);
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("paired".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start grouped ping listener");

    let observed_pong = Arc::new(Mutex::new(None::<String>));
    let handler_observed_pong = Arc::clone(&observed_pong);
    let (handler_started_tx, handler_started_rx) = oneshot::channel::<()>();
    let handler_started_tx = Arc::new(Mutex::new(Some(handler_started_tx)));
    let (release_handler_tx, release_handler_rx) = oneshot::channel::<()>();
    let release_handler_rx = Arc::new(Mutex::new(Some(release_handler_rx)));
    let pong_listener = consumer
        .listen_event::<SourcePongedEvent, _, _>(
            move |event, context| {
                let handler_observed_pong = Arc::clone(&handler_observed_pong);
                let handler_started_tx = Arc::clone(&handler_started_tx);
                let release_handler_rx = Arc::clone(&release_handler_rx);
                async move {
                    assert_eq!(context.group.as_deref(), Some("paired"));
                    if let Some(sender) = handler_started_tx.lock().await.take() {
                        let _ = sender.send(());
                    }
                    if let Some(receiver) = release_handler_rx.lock().await.take() {
                        let _ = receiver.await;
                    }
                    *handler_observed_pong.lock().await = Some(event.id);
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("paired".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start grouped pong listener");
    wait_for_matching_grouped_waiting_count(
        &runtime,
        SourcePingedEvent::SUBJECT,
        SourcePongedEvent::SUBJECT,
        1,
    )
    .await;
    let grouped_consumers = matching_grouped_consumers(
        &runtime,
        SourcePingedEvent::SUBJECT,
        SourcePongedEvent::SUBJECT,
    )
    .await;
    let durable_name = consumer_name(&grouped_consumers[0]).to_string();

    let publisher_contract = publisher_contract();
    let publisher = admin
        .connect_client(&bootstrap_url, &publisher_contract)
        .await
        .expect("connect event publisher client");
    publisher
        .publish::<SourcePongedEvent>(&EventRecord {
            id: "rust-event-consumers-readiness-lost".to_string(),
            value: "readiness-lost".to_string(),
        })
        .await
        .expect("publish grouped source event");
    tokio::time::timeout(Duration::from_secs(5), handler_started_rx)
        .await
        .expect("timed out waiting for grouped handler to start")
        .expect("grouped handler started");

    ping_listener.abort();
    let _ = ping_listener.await;
    let _ = release_handler_tx.send(());
    wait_for_matching_grouped_ack_pending_and_waiting_count(
        &runtime,
        SourcePingedEvent::SUBJECT,
        SourcePongedEvent::SUBJECT,
        1,
        0,
    )
    .await;

    let ack_frames = ack_observer
        .frames()
        .into_iter()
        .filter(|frame| frame.subject.contains(&durable_name))
        .collect::<Vec<_>>();
    assert_eq!(ack_observer.errors(), Vec::<String>::new());
    assert!(
        !ack_frames.iter().any(|frame| frame.payload == "-NAK"),
        "readiness-loss cleanup NAKed delivered message: {ack_frames:?}"
    );
    assert_eq!(*observed_ping.lock().await, None);
    assert_eq!(
        observed_pong.lock().await.as_deref(),
        Some("rust-event-consumers-readiness-lost")
    );

    pong_listener.abort();
    let _ = pong_listener.await;
    ack_observer.stop().await;
}

#[tokio::test]
async fn event_consumers_ephemeral_listener_avoids_durable_metadata_and_jetstream_consumer() {
    assert_service_case_registered(
        "event-consumers.ephemeral-listener-avoids-durable-metadata-and-jetstream-consumer",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        MISSING_GROUP_CONSUMER_JSON,
        "event-consumers-missing-group-rust",
    )
    .await;
    assert!(matching_consumers(&runtime, SourcePingedEvent::SUBJECT)
        .await
        .is_empty());

    let observed = Arc::new(Mutex::new(Vec::<String>::new()));
    let handler_observed = Arc::clone(&observed);
    let listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let handler_observed = Arc::clone(&handler_observed);
                async move {
                    assert_eq!(context.mode, ServiceEventListenerMode::Ephemeral);
                    assert_eq!(context.group, None);
                    handler_observed.lock().await.push(event.id);
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Ephemeral,
                group: None,
                durable_name: None,
            },
        )
        .await
        .expect("start ephemeral listener");
    assert!(matching_consumers(&runtime, SourcePingedEvent::SUBJECT)
        .await
        .is_empty());

    let publisher_contract = publisher_contract();
    let publisher = admin
        .connect_client(&bootstrap_url, &publisher_contract)
        .await
        .expect("connect event publisher client");
    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-ephemeral".to_string(),
            value: "ephemeral".to_string(),
        })
        .await
        .expect("publish source event");

    wait_for_observed_entry(&observed, "rust-event-consumers-ephemeral").await;
    assert!(matching_consumers(&runtime, SourcePingedEvent::SUBJECT)
        .await
        .is_empty());
    drop(listener);

    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-ephemeral-after-drop".to_string(),
            value: "ephemeral-after-drop".to_string(),
        })
        .await
        .expect("publish source event after listener drop");

    assert_no_observed_entry(&observed, "rust-event-consumers-ephemeral-after-drop").await;
}

#[tokio::test]
async fn event_consumers_duplicate_handlers_share_single_group_waiter() {
    assert_service_case_registered(
        "event-consumers.duplicate-handlers-share-single-group-waiter",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        DEPENDENCY_CONSUMER_JSON,
        "event-consumers-dependency-rust",
    )
    .await;

    let observed = Arc::new(Mutex::new(Vec::<String>::new()));
    let first_observed = Arc::clone(&observed);
    let first_listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let first_observed = Arc::clone(&first_observed);
                async move {
                    assert_eq!(context.group.as_deref(), Some("ingest"));
                    first_observed
                        .lock()
                        .await
                        .push(format!("first:{}", event.id));
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("ingest".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start first duplicate listener");
    let second_observed = Arc::clone(&observed);
    let second_listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let second_observed = Arc::clone(&second_observed);
                async move {
                    assert_eq!(context.group.as_deref(), Some("ingest"));
                    second_observed
                        .lock()
                        .await
                        .push(format!("second:{}", event.id));
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("ingest".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start second duplicate listener");

    wait_for_waiting_count(&runtime, SourcePingedEvent::SUBJECT, 1).await;

    let publisher_contract = publisher_contract();
    let publisher = admin
        .connect_client(&bootstrap_url, &publisher_contract)
        .await
        .expect("connect event publisher client");
    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-duplicate".to_string(),
            value: "duplicate".to_string(),
        })
        .await
        .expect("publish source event");

    wait_for_duplicate_observed(&observed, "rust-event-consumers-duplicate").await;
    first_listener.abort();
    second_listener.abort();
    let _ = first_listener.await;
    let _ = second_listener.await;
}

#[tokio::test]
async fn event_consumers_self_owned_durable_consumer_receives_self_published_event() {
    assert_service_case_registered(
        "event-consumers.self-owned-durable-consumer-receives-self-published-event",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let service = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        SELF_CONSUMER_JSON,
        "event-consumers-self-rust",
    )
    .await;
    let binding = service
        .resources()
        .event_consumers
        .get("ingest")
        .expect("ingest self event consumer binding");
    let before = matching_consumers(&runtime, SelfPingedEvent::SUBJECT).await;
    assert!(before
        .iter()
        .any(|consumer| consumer_name(consumer) == binding.consumer_name));

    let observed = Arc::new(Mutex::new(
        None::<(EventRecord, ServiceEventListenerContext)>,
    ));
    let handler_observed = Arc::clone(&observed);
    let listener = service
        .listen_event::<SelfPingedEvent, _, _>(
            move |event, context| {
                let handler_observed = Arc::clone(&handler_observed);
                async move {
                    *handler_observed.lock().await = Some((event, context));
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("ingest".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start self-owned durable listener");
    let after = matching_consumers(&runtime, SelfPingedEvent::SUBJECT).await;
    assert_eq!(after.len(), before.len());
    assert!(after
        .iter()
        .any(|consumer| consumer_name(consumer) == binding.consumer_name));

    let event = EventRecord {
        id: "rust-event-consumers-self".to_string(),
        value: "self".to_string(),
    };
    service
        .event_publisher()
        .publish::<SelfPingedEvent>(&event)
        .await
        .expect("publish self-owned event");

    wait_for_observed(&observed, "rust-event-consumers-self", Some("ingest")).await;
    listener.abort();
    let _ = listener.await;
}

#[tokio::test]
async fn event_consumers_abort_re_register_restarts_delivery() {
    assert_service_case_registered(
        "event-consumers.abort-re-register-restarts-delivery",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let service = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        SELF_CONSUMER_JSON,
        "event-consumers-self-rust",
    )
    .await;
    let binding = service
        .resources()
        .event_consumers
        .get("ingest")
        .expect("ingest self event consumer binding");
    let before = matching_consumers(&runtime, SelfPingedEvent::SUBJECT).await;
    assert!(before
        .iter()
        .any(|consumer| consumer_name(consumer) == binding.consumer_name));

    let observed = Arc::new(Mutex::new(Vec::<String>::new()));
    let first_observed = Arc::clone(&observed);
    let first_listener = service
        .listen_event::<SelfPingedEvent, _, _>(
            move |event, context| {
                let first_observed = Arc::clone(&first_observed);
                async move {
                    assert_eq!(context.group.as_deref(), Some("ingest"));
                    first_observed
                        .lock()
                        .await
                        .push(format!("first:{}", event.id));
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("ingest".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start first self-owned durable listener");
    wait_for_single_subject_waiting_count(
        &runtime,
        SelfPingedEvent::SUBJECT,
        SelfPongedEvent::SUBJECT,
        1,
    )
    .await;

    service
        .event_publisher()
        .publish::<SelfPingedEvent>(&EventRecord {
            id: "rust-event-consumers-abort-first".to_string(),
            value: "first".to_string(),
        })
        .await
        .expect("publish first self-owned event");
    wait_for_observed_entry(&observed, "first:rust-event-consumers-abort-first").await;

    first_listener.abort();
    let _ = first_listener.await;
    wait_for_single_subject_waiting_count(
        &runtime,
        SelfPingedEvent::SUBJECT,
        SelfPongedEvent::SUBJECT,
        0,
    )
    .await;

    service
        .event_publisher()
        .publish::<SelfPingedEvent>(&EventRecord {
            id: "rust-event-consumers-abort-second".to_string(),
            value: "second".to_string(),
        })
        .await
        .expect("publish queued self-owned event");
    wait_for_single_subject_pending_count(
        &runtime,
        SelfPingedEvent::SUBJECT,
        SelfPongedEvent::SUBJECT,
        1,
    )
    .await;
    assert!(!observed
        .lock()
        .await
        .contains(&"first:rust-event-consumers-abort-second".to_string()));

    let second_observed = Arc::clone(&observed);
    let second_listener = service
        .listen_event::<SelfPingedEvent, _, _>(
            move |event, context| {
                let second_observed = Arc::clone(&second_observed);
                async move {
                    assert_eq!(context.group.as_deref(), Some("ingest"));
                    second_observed
                        .lock()
                        .await
                        .push(format!("second:{}", event.id));
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("ingest".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("re-register self-owned durable listener");

    wait_for_observed_entry(&observed, "second:rust-event-consumers-abort-second").await;
    assert!(!observed
        .lock()
        .await
        .contains(&"first:rust-event-consumers-abort-second".to_string()));
    let after = matching_consumers(&runtime, SelfPingedEvent::SUBJECT).await;
    assert!(after
        .iter()
        .any(|consumer| consumer_name(consumer) == binding.consumer_name));
    drop(second_listener);
    wait_for_single_subject_waiting_count(
        &runtime,
        SelfPingedEvent::SUBJECT,
        SelfPongedEvent::SUBJECT,
        0,
    )
    .await;

    service
        .event_publisher()
        .publish::<SelfPingedEvent>(&EventRecord {
            id: "rust-event-consumers-drop-third".to_string(),
            value: "third".to_string(),
        })
        .await
        .expect("publish queued self-owned event after drop");
    wait_for_single_subject_pending_count(
        &runtime,
        SelfPingedEvent::SUBJECT,
        SelfPongedEvent::SUBJECT,
        1,
    )
    .await;
    assert_no_observed_entry(&observed, "second:rust-event-consumers-drop-third").await;
}

#[tokio::test]
async fn event_consumers_stop_teardown_stops_durable_delivery() {
    assert_service_case_registered(
        "event-consumers.stop-teardown-stops-durable-delivery",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        DEPENDENCY_CONSUMER_JSON,
        "event-consumers-dependency-rust",
    )
    .await;

    let observed = Arc::new(Mutex::new(Vec::<String>::new()));
    let handler_observed = Arc::clone(&observed);
    let listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let handler_observed = Arc::clone(&handler_observed);
                async move {
                    assert_eq!(context.group.as_deref(), Some("ingest"));
                    handler_observed.lock().await.push(event.id);
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("ingest".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start dependency durable listener");
    wait_for_waiting_count(&runtime, SourcePingedEvent::SUBJECT, 1).await;

    let publisher_contract = publisher_contract();
    let publisher = admin
        .connect_client(&bootstrap_url, &publisher_contract)
        .await
        .expect("connect event publisher client");
    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-stop-before".to_string(),
            value: "before-stop".to_string(),
        })
        .await
        .expect("publish event before service stop");
    wait_for_observed_entry(&observed, "rust-event-consumers-stop-before").await;

    drop(consumer);
    wait_for_waiting_count(&runtime, SourcePingedEvent::SUBJECT, 0).await;
    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-stop-after".to_string(),
            value: "after-stop".to_string(),
        })
        .await
        .expect("publish event after service stop");
    wait_for_pending_count(&runtime, SourcePingedEvent::SUBJECT, 1).await;
    assert_no_observed_entry(&observed, "rust-event-consumers-stop-after").await;

    listener.abort();
    let _ = listener.await;
}

#[tokio::test]
async fn event_consumers_grouped_consumer_waits_for_all_handlers_before_consuming_queued_event() {
    assert_service_case_registered(
        "event-consumers.grouped-consumer-waits-for-all-handlers-before-consuming-queued-event",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let source_contract = test_contract(SOURCE_CONTRACT_JSON);
    admin
        .approve_contract(&bootstrap_url, &source_contract, None, &[])
        .await
        .expect("approve source contract");
    let consumer = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        GROUPED_DEPENDENCY_CONSUMER_JSON,
        "event-consumers-grouped-dependency-rust",
    )
    .await;

    let observed_ping = Arc::new(Mutex::new(None::<String>));
    let handler_observed_ping = Arc::clone(&observed_ping);
    let ping_listener = consumer
        .listen_event::<SourcePingedEvent, _, _>(
            move |event, context| {
                let handler_observed_ping = Arc::clone(&handler_observed_ping);
                async move {
                    assert_eq!(context.group.as_deref(), Some("paired"));
                    *handler_observed_ping.lock().await = Some(event.id);
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("paired".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start grouped ping listener");

    let publisher_contract = publisher_contract();
    let publisher = admin
        .connect_client(&bootstrap_url, &publisher_contract)
        .await
        .expect("connect event publisher client");
    publisher
        .publish::<SourcePingedEvent>(&EventRecord {
            id: "rust-event-consumers-grouped".to_string(),
            value: "queued".to_string(),
        })
        .await
        .expect("publish queued source event");

    wait_for_grouped_pending_count(&runtime, 1).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(*observed_ping.lock().await, None);

    let pong_listener = consumer
        .listen_event::<SourcePongedEvent, _, _>(
            |_event, context| async move {
                assert_eq!(context.group.as_deref(), Some("paired"));
                Ok(())
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("paired".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start grouped pong listener");

    wait_for_observed_id(&observed_ping, "rust-event-consumers-grouped").await;
    ping_listener.abort();
    pong_listener.abort();
    let _ = ping_listener.await;
    let _ = pong_listener.await;
}

#[tokio::test]
async fn event_consumers_self_owned_grouped_consumer_waits_for_all_handlers_before_consuming_queued_event(
) {
    assert_service_case_registered(
        "event-consumers.self-owned-grouped-consumer-waits-for-all-handlers-before-consuming-queued-event",
        "event-consumers",
        "event_consumers",
    );

    let (runtime, bootstrap_url, mut admin) = start_runtime().await;
    let service = connect_consumer(
        &mut admin,
        runtime.trellis_url(),
        &bootstrap_url,
        SELF_CONSUMER_JSON,
        "event-consumers-self-rust",
    )
    .await;

    let observed_ping = Arc::new(Mutex::new(None::<String>));
    let handler_observed_ping = Arc::clone(&observed_ping);
    let ping_listener = service
        .listen_event::<SelfPingedEvent, _, _>(
            move |event, context| {
                let handler_observed_ping = Arc::clone(&handler_observed_ping);
                async move {
                    assert_eq!(context.group.as_deref(), Some("paired"));
                    *handler_observed_ping.lock().await = Some(event.id);
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("paired".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start self-owned grouped ping listener");

    service
        .event_publisher()
        .publish::<SelfPingedEvent>(&EventRecord {
            id: "rust-event-consumers-self-grouped".to_string(),
            value: "queued".to_string(),
        })
        .await
        .expect("publish queued self-owned event");

    wait_for_matching_grouped_pending_count(
        &runtime,
        SelfPingedEvent::SUBJECT,
        SelfPongedEvent::SUBJECT,
        1,
    )
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(*observed_ping.lock().await, None);

    let pong_listener = service
        .listen_event::<SelfPongedEvent, _, _>(
            |_event, context| async move {
                assert_eq!(context.group.as_deref(), Some("paired"));
                Ok(())
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Durable,
                group: Some("paired".to_string()),
                durable_name: None,
            },
        )
        .await
        .expect("start self-owned grouped pong listener");

    wait_for_observed_id(&observed_ping, "rust-event-consumers-self-grouped").await;
    ping_listener.abort();
    pong_listener.abort();
    let _ = ping_listener.await;
    let _ = pong_listener.await;
}

async fn wait_for_duplicate_observed(observed: &Arc<Mutex<Vec<String>>>, event_id: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    let expected = [format!("first:{event_id}"), format!("second:{event_id}")];
    loop {
        let mut actual = observed.lock().await.clone();
        actual.sort();
        if actual == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for both duplicate handlers"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_observed_entry(observed: &Arc<Mutex<Vec<String>>>, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if observed.lock().await.iter().any(|entry| entry == expected) {
            return;
        }
        assert!(Instant::now() < deadline, "timed out waiting for event");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn assert_no_observed_entry(observed: &Arc<Mutex<Vec<String>>>, unexpected: &str) {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        assert!(
            !observed
                .lock()
                .await
                .iter()
                .any(|entry| entry == unexpected),
            "stopped service received event {unexpected}"
        );
        if Instant::now() >= deadline {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_for_waiting_count(
    runtime: &trellis_test::TrellisTestRuntime,
    subject: &str,
    expected: usize,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let consumers = matching_consumers(runtime, subject).await;
        if consumers.len() == 1 && consumers[0].num_waiting == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for JetStream waiter count"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_pending_count(
    runtime: &trellis_test::TrellisTestRuntime,
    subject: &str,
    expected: usize,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let consumers = matching_consumers(runtime, subject).await;
        if consumers.len() == 1 && consumers[0].num_pending == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for JetStream pending count"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_matching_consumer_count(
    runtime: &trellis_test::TrellisTestRuntime,
    subject: &str,
    expected: usize,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if matching_consumers(runtime, subject).await.len() == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for JetStream consumer count"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_single_subject_waiting_count(
    runtime: &trellis_test::TrellisTestRuntime,
    subject: &str,
    excluded_subject: &str,
    expected: usize,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let consumers = matching_single_subject_consumers(runtime, subject, excluded_subject).await;
        if consumers.len() == 1 && consumers[0].num_waiting == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for JetStream waiter count"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_single_subject_pending_count(
    runtime: &trellis_test::TrellisTestRuntime,
    subject: &str,
    excluded_subject: &str,
    expected: usize,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let consumers = matching_single_subject_consumers(runtime, subject, excluded_subject).await;
        if consumers.len() == 1 && consumers[0].num_pending == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for JetStream pending count"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_grouped_pending_count(
    runtime: &trellis_test::TrellisTestRuntime,
    expected: usize,
) {
    wait_for_matching_grouped_pending_count(
        runtime,
        SourcePingedEvent::SUBJECT,
        SourcePongedEvent::SUBJECT,
        expected,
    )
    .await;
}

async fn wait_for_matching_grouped_pending_count(
    runtime: &trellis_test::TrellisTestRuntime,
    first_subject: &str,
    second_subject: &str,
    expected: usize,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let consumers = matching_grouped_consumers(runtime, first_subject, second_subject).await;
        if consumers.len() == 1 && consumers[0].num_pending == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for grouped JetStream pending count"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_matching_grouped_waiting_count(
    runtime: &trellis_test::TrellisTestRuntime,
    first_subject: &str,
    second_subject: &str,
    expected: usize,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let consumers = matching_grouped_consumers(runtime, first_subject, second_subject).await;
        if consumers.len() == 1 && consumers[0].num_waiting == expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for grouped JetStream waiting count"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_matching_grouped_ack_pending_and_waiting_count(
    runtime: &trellis_test::TrellisTestRuntime,
    first_subject: &str,
    second_subject: &str,
    expected_ack_pending: usize,
    expected_waiting: usize,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let consumers = matching_grouped_consumers(runtime, first_subject, second_subject).await;
        if consumers.len() == 1
            && consumers[0].num_ack_pending == expected_ack_pending
            && consumers[0].num_waiting == expected_waiting
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for grouped JetStream ack-pending and waiting counts"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn start_runtime() -> (
    trellis_test::TrellisTestRuntime,
    String,
    trellis_test::TrellisTestAdmin,
) {
    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let admin = runtime.admin();
    (runtime, bootstrap_url, admin)
}

async fn connect_consumer(
    admin: &mut trellis_test::TrellisTestAdmin,
    trellis_url: &str,
    bootstrap_url: &str,
    manifest_json: &str,
    service_name: &str,
) -> ConnectedServiceRuntime<()> {
    let contract = test_contract(manifest_json);
    let service_key = admin
        .provision_service_instance(bootstrap_url, &contract, None, None)
        .await
        .expect("provision event consumer service instance");
    let client = TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url,
        contract_id: contract_id(&contract),
        contract_digest: contract.digest(),
        contract_json: manifest_json,
        session_key_seed_base64url: &service_key.seed,
        timeout_ms: 5_000,
        retry_delay_ms: 100,
        authority_pending_timeout_ms: 30_000,
    })
    .await
    .expect("connect event consumer service");
    ConnectedServiceRuntime::<()>::from_connected_client(service_name, Arc::new(client))
        .expect("build connected event consumer runtime")
}

fn contract_id(contract: &trellis_test::TrellisTestContract) -> &str {
    contract
        .manifest()
        .get("id")
        .and_then(serde_json::Value::as_str)
        .expect("contract manifest has string id")
}

fn test_contract(manifest_json: &str) -> trellis_test::TrellisTestContract {
    trellis_test::TrellisTestContract::from_manifest_json(manifest_json)
        .expect("build event consumer test contract")
}

fn publisher_contract() -> trellis_test::TrellisTestContract {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.event-consumers-publisher-rust@v1",
        "Trellis Rust Event Consumers Publisher",
        "Publishes source events through a Rust app facade.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "source",
        trellis_rs::contracts::use_contract("trellis.integration.event-consumers-source-rust@v1")
            .with_event_publish(["Source.Pinged", "Source.Ponged"]),
    )
    .build()
    .expect("build publisher manifest");

    trellis_test::TrellisTestContract::from_manifest_value(
        serde_json::to_value(manifest).expect("serialize publisher manifest"),
    )
    .expect("build publisher test contract")
}

async fn wait_for_observed_id(observed: &Arc<Mutex<Option<String>>>, event_id: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if observed.lock().await.as_deref() == Some(event_id) {
            return;
        }
        assert!(Instant::now() < deadline, "timed out waiting for event");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_observed(
    observed: &Arc<Mutex<Option<(EventRecord, ServiceEventListenerContext)>>>,
    event_id: &str,
    group: Option<&str>,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some((event, context)) = observed.lock().await.clone() {
            assert_eq!(event.id, event_id);
            assert_eq!(context.group.as_deref(), group);
            assert_eq!(
                context.mode,
                if group.is_some() {
                    ServiceEventListenerMode::Durable
                } else {
                    ServiceEventListenerMode::Ephemeral
                }
            );
            return;
        }
        assert!(Instant::now() < deadline, "timed out waiting for event");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn matching_consumers(
    runtime: &trellis_test::TrellisTestRuntime,
    subject: &str,
) -> Vec<trellis_test::TrellisJetStreamConsumerInfo> {
    runtime
        .list_trellis_jetstream_consumers()
        .await
        .expect("list Trellis JetStream consumers")
        .into_iter()
        .filter(|consumer| {
            consumer
                .filter_subjects
                .iter()
                .any(|filter_subject| filter_subject == subject)
        })
        .collect()
}

async fn matching_single_subject_consumers(
    runtime: &trellis_test::TrellisTestRuntime,
    subject: &str,
    excluded_subject: &str,
) -> Vec<trellis_test::TrellisJetStreamConsumerInfo> {
    runtime
        .list_trellis_jetstream_consumers()
        .await
        .expect("list Trellis JetStream consumers")
        .into_iter()
        .filter(|consumer| {
            consumer
                .filter_subjects
                .iter()
                .any(|filter_subject| filter_subject == subject)
                && !consumer
                    .filter_subjects
                    .iter()
                    .any(|filter_subject| filter_subject == excluded_subject)
        })
        .collect()
}

fn consumer_name(consumer: &trellis_test::TrellisJetStreamConsumerInfo) -> &str {
    consumer.durable_name.as_deref().unwrap_or(&consumer.name)
}

async fn matching_grouped_consumers(
    runtime: &trellis_test::TrellisTestRuntime,
    first_subject: &str,
    second_subject: &str,
) -> Vec<trellis_test::TrellisJetStreamConsumerInfo> {
    runtime
        .list_trellis_jetstream_consumers()
        .await
        .expect("list Trellis JetStream consumers")
        .into_iter()
        .filter(|consumer| {
            consumer
                .filter_subjects
                .iter()
                .any(|filter_subject| filter_subject == first_subject)
                && consumer
                    .filter_subjects
                    .iter()
                    .any(|filter_subject| filter_subject == second_subject)
        })
        .collect()
}
