use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use trellis_rs::client::{OperationDescriptor, OperationEvent};
use trellis_rs::service::{
    AcceptedOperation, GeneratedServiceContract, OperationRefData, OperationSnapshot,
    OperationState, ServerError,
};

use crate::support::assertions::assert_case_registered;

const OP_SERVICE_ID: &str = "trellis.integration.operations-service@v1";
const OP_CLIENT_ID: &str = "trellis.integration.operations-client@v1";
const OP_UNAUTHORIZED_CLIENT_ID: &str = "trellis.integration.operations-unauthorized-client@v1";

const OP_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.operations-service@v1",
  "displayName": "Trellis Integration Operations Service",
  "description": "Exercises client-to-service operation start and watch through generated surfaces.",
  "kind": "service",
  "capabilities": {
    "process": {
      "displayName": "Process entities",
      "description": "Start and observe entity processing operations."
    }
  },
  "schemas": {
    "OperationInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "OperationProgress": {
      "type": "object",
      "required": ["message", "step"],
      "properties": {
        "message": { "type": "string" },
        "step": { "type": "integer" }
      }
    },
    "OperationOutput": {
      "type": "object",
      "required": ["message", "done"],
      "properties": {
        "message": { "type": "string" },
        "done": { "type": "boolean" }
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
  "operations": {
    "Entity.Process": {
      "version": "v1",
      "subject": "operations.v1.Entity.Process",
      "input": { "schema": "OperationInput" },
      "progress": { "schema": "OperationProgress" },
      "output": { "schema": "OperationOutput" },
      "capabilities": { "call": ["process"], "observe": ["process"] },
      "cancel": false
    }
  }
}"#;

struct OperationsServiceContract;

impl trellis_rs::service::GeneratedServiceContract for OperationsServiceContract {
    const CONTRACT_ID: &'static str = OP_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "nPkUGX7OXMfvxT18C6WxCa51Vq032moLu08QxUREyK0";
    const CONTRACT_JSON: &'static str = OP_SERVICE_CONTRACT_JSON;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityProcessInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityProcessProgress {
    message: String,
    step: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityProcessOutput {
    message: String,
    done: bool,
}

struct EntityProcessOp;

impl trellis_rs::client::OperationDescriptor for EntityProcessOp {
    type Input = EntityProcessInput;
    type Progress = EntityProcessProgress;
    type Output = EntityProcessOutput;

    const KEY: &'static str = "Entity.Process";
    const SUBJECT: &'static str = "operations.v1.Entity.Process";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["process"];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &["process"];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
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

struct SharedOperationState {
    snapshots: tokio::sync::Mutex<
        HashMap<String, OperationSnapshot<EntityProcessProgress, EntityProcessOutput>>,
    >,
    watchers: Mutex<
        HashMap<
            String,
            watch::Sender<OperationSnapshot<EntityProcessProgress, EntityProcessOutput>>,
        >,
    >,
}

impl SharedOperationState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshots: tokio::sync::Mutex::new(HashMap::new()),
            watchers: Mutex::new(HashMap::new()),
        })
    }
}

fn setup_operation_service(
    shared: &Arc<SharedOperationState>,
    service: &mut trellis_rs::service::ConnectedServiceRuntime<OperationsServiceContract>,
    spawn_completion: bool,
) {
    let shared_clone = Arc::clone(shared);
    let shared_for_getter = Arc::clone(shared);
    let shared_for_watcher = Arc::clone(shared);

    service.register_operation_with_watch::<EntityProcessOp, _, _, _, _, _, _, _>(
        {
            let shared = shared_clone;
            move |_context: trellis_rs::service::ServiceHandlerContext,
                  input: EntityProcessInput| {
                let shared = Arc::clone(&shared);
                async move {
                    let operation_id = format!("op-{}", input.message);
                    let (tx, _rx) = watch::channel(OperationSnapshot {
                        revision: 1,
                        state: OperationState::Pending,
                        ..Default::default()
                    });
                    let snapshot = OperationSnapshot {
                        revision: 1,
                        state: OperationState::Pending,
                        ..Default::default()
                    };
                    shared
                        .snapshots
                        .lock()
                        .await
                        .insert(operation_id.clone(), snapshot);
                    shared
                        .watchers
                        .lock()
                        .unwrap()
                        .insert(operation_id.clone(), tx);

                    if spawn_completion {
                        let op_id = operation_id.clone();
                        let shared = Arc::clone(&shared);
                        tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(50)).await;
                            let progress_snapshot = OperationSnapshot {
                                revision: 2,
                                state: OperationState::Running,
                                progress: Some(EntityProcessProgress {
                                    message: input.message.clone(),
                                    step: 1,
                                }),
                                ..Default::default()
                            };
                            if let Some(tx) = shared.watchers.lock().unwrap().get(&op_id) {
                                let _ = tx.send(progress_snapshot);
                            }

                            tokio::time::sleep(Duration::from_millis(50)).await;
                            let complete_snapshot = OperationSnapshot {
                                revision: 3,
                                state: OperationState::Completed,
                                output: Some(EntityProcessOutput {
                                    message: input.message,
                                    done: true,
                                }),
                                ..Default::default()
                            };
                            if let Some(tx) = shared.watchers.lock().unwrap().get(&op_id) {
                                let _ = tx.send(complete_snapshot);
                            }
                        });
                    }

                    Ok(AcceptedOperation {
                        kind: "accepted".to_string(),
                        operation_ref: OperationRefData {
                            id: operation_id,
                            service: "operations-fixture-service".to_string(),
                            operation: EntityProcessOp::KEY.to_string(),
                        },
                        snapshot: OperationSnapshot {
                            revision: 1,
                            state: OperationState::Pending,
                            ..Default::default()
                        },
                        transfer: None,
                    })
                }
            }
        },
        {
            let shared = shared_for_getter;
            move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
                let shared = Arc::clone(&shared);
                async move {
                    let snapshots = shared.snapshots.lock().await;
                    snapshots
                        .get(&operation_id)
                        .cloned()
                        .ok_or_else(|| ServerError::OperationNotFound { operation_id })
                }
            }
        },
        {
            let shared = shared_for_watcher;
            move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
                let shared = Arc::clone(&shared);
                let initial = OperationSnapshot {
                    revision: 1,
                    state: OperationState::Pending,
                    ..Default::default()
                };
                let rx: Option<
                    watch::Receiver<OperationSnapshot<EntityProcessProgress, EntityProcessOutput>>,
                > = {
                    let watchers = shared.watchers.lock().unwrap();
                    watchers.get(&operation_id).map(|tx| tx.subscribe())
                };
                let stream: BoxStream<
                    'static,
                    Result<
                        OperationSnapshot<EntityProcessProgress, EntityProcessOutput>,
                        ServerError,
                    >,
                > = match rx {
                    Some(rx) => Box::pin(stream::once(async move { Ok(initial) }).chain(
                        stream::unfold(
                            rx,
                            |mut rx: watch::Receiver<
                                OperationSnapshot<EntityProcessProgress, EntityProcessOutput>,
                            >| async move {
                                rx.changed().await.ok()?;
                                let snapshot = rx.borrow().clone();
                                let _terminal = snapshot.state.is_terminal();
                                Some((Ok(snapshot), rx))
                            },
                        ),
                    )),
                    None => Box::pin(stream::once(async move { Ok(initial) })),
                };
                stream
            }
        },
        |_context: trellis_rs::service::ServiceHandlerContext, _operation_id: String| async move {
            Err(ServerError::OperationUnsupportedControl {
                operation: EntityProcessOp::KEY.to_string(),
                action: "cancel".to_string(),
            })
        },
    );
}

#[tokio::test]
async fn operations_client_starts_operation() {
    assert_case_registered(
        "operations.client-starts-operation",
        "operations",
        "operations",
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
        trellis_test::TrellisTestContract::from_manifest_json(OP_SERVICE_CONTRACT_JSON)
            .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract = operations_client_contract().expect("build operations client contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live operations service instance");
    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<OperationsServiceContract>::connect(
            runtime.service_connect_options("operations-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust operations service");

    let shared = SharedOperationState::new();
    setup_operation_service(&shared, &mut service, false);

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "operation-1").await;

    assert!(
        !operation_ref.id().is_empty(),
        "operation ref id should be non-empty"
    );
    assert_eq!(operation_ref.id(), "op-operation-1");

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_client_watches_progress() {
    assert_case_registered(
        "operations.client-watches-progress",
        "operations",
        "operations",
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
        trellis_test::TrellisTestContract::from_manifest_json(OP_SERVICE_CONTRACT_JSON)
            .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract = operations_client_contract().expect("build operations client contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live operations service instance");
    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<OperationsServiceContract>::connect(
            runtime.service_connect_options("operations-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust operations service");

    let shared = SharedOperationState::new();
    setup_operation_service(&shared, &mut service, true);

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "operation-1").await;

    let events: Vec<
        Result<
            OperationEvent<EntityProcessProgress, EntityProcessOutput>,
            trellis_rs::client::TrellisClientError,
        >,
    > = operation_ref
        .watch()
        .await
        .expect("watch operation")
        .collect()
        .await;

    let mut saw_progress = false;
    for event in &events {
        let event = event.as_ref().expect("operation watch event");
        if let trellis_rs::client::OperationEvent::Progress { snapshot } = event {
            saw_progress = true;
            assert_eq!(
                snapshot.progress,
                Some(EntityProcessProgress {
                    message: "operation-1".to_string(),
                    step: 1,
                })
            );
            break;
        }
    }

    assert!(saw_progress, "operation watch should observe progress");

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_client_waits_for_completion() {
    assert_case_registered(
        "operations.client-waits-for-completion",
        "operations",
        "operations",
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
        trellis_test::TrellisTestContract::from_manifest_json(OP_SERVICE_CONTRACT_JSON)
            .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract = operations_client_contract().expect("build operations client contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live operations service instance");
    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<OperationsServiceContract>::connect(
            runtime.service_connect_options("operations-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust operations service");

    let shared = SharedOperationState::new();
    setup_operation_service(&shared, &mut service, true);

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "operation-1").await;

    let events: Vec<
        Result<
            OperationEvent<EntityProcessProgress, EntityProcessOutput>,
            trellis_rs::client::TrellisClientError,
        >,
    > = operation_ref
        .watch()
        .await
        .expect("watch operation")
        .collect()
        .await;

    let mut saw_completed = false;
    for event in &events {
        let event = event.as_ref().expect("operation watch event");
        if let trellis_rs::client::OperationEvent::Completed { snapshot } = event {
            saw_completed = true;
            assert_eq!(
                snapshot.output,
                Some(EntityProcessOutput {
                    message: "operation-1".to_string(),
                    done: true,
                })
            );
            break;
        }
    }

    assert!(saw_completed, "operation watch should observe completion");

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_denies_start_without_call_authority() {
    assert_case_registered(
        "operations.denies-start-without-call-authority",
        "operations",
        "operations",
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
        trellis_test::TrellisTestContract::from_manifest_json(OP_SERVICE_CONTRACT_JSON)
            .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract = operations_unauthorized_client_contract()
        .expect("build unauthorized operations client contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live operations service instance");
    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<OperationsServiceContract>::connect(
            runtime.service_connect_options("operations-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust operations service");

    let shared = SharedOperationState::new();
    setup_operation_service(&shared, &mut service, false);

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust unauthorized operations client");

    let result = client
        .operation::<EntityProcessOp>()
        .start(&EntityProcessInput {
            message: "operation-1".to_string(),
        })
        .await;

    assert!(
        result.is_err(),
        "expected unauthorized client to receive error"
    );

    service_task.abort_and_wait().await;
}

async fn start_operation_with_retry<'a>(
    client: &'a trellis_rs::client::TrellisClient,
    message: &str,
) -> trellis_rs::client::OperationRef<'a, trellis_rs::client::TrellisClient, EntityProcessOp> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .operation::<EntityProcessOp>()
            .start(&EntityProcessInput {
                message: message.to_string(),
            })
            .await
        {
            Ok(op_ref) => return op_ref,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("start live Entity.Process operation: {error}"),
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

fn operations_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        OP_CLIENT_ID,
        "Trellis Integration Operations Client",
        "App/client participant for the operations integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "operationsService",
        trellis_rs::contracts::use_contract(OP_SERVICE_ID).with_operation_call(["Entity.Process"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn operations_unauthorized_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        OP_UNAUTHORIZED_CLIENT_ID,
        "Trellis Integration Unauthorized Operations Client",
        "App/client without operation call authority for Entity.Process.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "operationsService",
        trellis_rs::contracts::use_contract(OP_SERVICE_ID),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
