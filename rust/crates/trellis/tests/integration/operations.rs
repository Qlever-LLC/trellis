use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{watch, Notify};
use tokio::task::JoinHandle;
use trellis_rs::client::{
    OperationDescriptor, OperationEvent, OperationState as ClientOperationState,
};
use trellis_rs::service::{
    AcceptedOperation, GeneratedServiceContract, OperationRefData, OperationSignalAccepted,
    OperationSnapshot, OperationState as ServiceOperationState, ServerError,
};

use crate::support::assertions::assert_case_registered;

const OP_SERVICE_ID: &str = "trellis.integration.operations-service@v1";
const OP_CLIENT_ID: &str = "trellis.integration.operations-client@v1";
const OP_UNAUTHORIZED_CLIENT_ID: &str = "trellis.integration.operations-unauthorized-client@v1";
const OP_PROCESS_CAPABILITY: &str = "process";
const OP_CANCEL_CAPABILITY: &str = "cancelProcess";
const OP_CONTROL_CAPABILITY: &str = "process";

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
    },
    "cancelProcess": {
      "displayName": "Cancel entity processing",
      "description": "Cancel entity processing operations."
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
    "OperationSignalInput": {
      "type": "object",
      "required": ["suffix"],
      "properties": { "suffix": { "type": "string" } }
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
      "capabilities": { "call": ["process"], "observe": ["process"], "cancel": ["cancelProcess"], "control": ["process"] },
      "signals": {
        "updateMessage": { "input": { "schema": "OperationSignalInput" } },
        "appendMessage": { "input": { "schema": "OperationSignalInput" } }
      },
      "cancel": true
    },
    "Entity.Status": {
      "version": "v1",
      "subject": "operations.v1.Entity.Status",
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
    const CONTRACT_DIGEST: &'static str = "OE0YYjBgM1nLLX2WPs_eJdxKuVn4Z6f8sXMKgCMJEXM";
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
    type Error = trellis_rs::service::OperationFailure;

    const KEY: &'static str = "Entity.Process";
    const SUBJECT: &'static str = "operations.v1.Entity.Process";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[OP_PROCESS_CAPABILITY];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[OP_PROCESS_CAPABILITY];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[OP_CANCEL_CAPABILITY];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[OP_CONTROL_CAPABILITY];
    const CANCELABLE: bool = true;
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> = Some(
        r#"{"type":"object","required":["message","step"],"properties":{"message":{"type":"string"},"step":{"type":"integer"}}}"#,
    );
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","done"],"properties":{"message":{"type":"string"},"done":{"type":"boolean"}}}"#;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = r##"{"appendMessage":{"type":"object","required":["suffix"],"properties":{"suffix":{"type":"string"}}},"updateMessage":{"type":"object","required":["suffix"],"properties":{"suffix":{"type":"string"}}}}"##;
}

struct EntityStatusOp;

impl trellis_rs::client::OperationDescriptor for EntityStatusOp {
    type Input = EntityProcessInput;
    type Progress = EntityProcessProgress;
    type Output = EntityProcessOutput;
    type Error = trellis_rs::service::OperationFailure;

    const KEY: &'static str = "Entity.Status";
    const SUBJECT: &'static str = "operations.v1.Entity.Status";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[OP_PROCESS_CAPABILITY];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[OP_PROCESS_CAPABILITY];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> = Some(
        r#"{"type":"object","required":["message","step"],"properties":{"message":{"type":"string"},"step":{"type":"integer"}}}"#,
    );
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","done"],"properties":{"message":{"type":"string"},"done":{"type":"boolean"}}}"#;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = "{}";
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
    snapshots:
        Mutex<HashMap<String, OperationSnapshot<EntityProcessProgress, EntityProcessOutput>>>,
    watchers: Mutex<
        HashMap<
            String,
            watch::Sender<OperationSnapshot<EntityProcessProgress, EntityProcessOutput>>,
        >,
    >,
    cancelled: tokio::sync::Mutex<HashMap<String, bool>>,
    cancel_notify: Notify,
    fast_completion_watch_opened: Notify,
    signals: tokio::sync::Mutex<HashMap<String, Vec<String>>>,
    signal_notify: Notify,
}

#[derive(Debug)]
struct ObservedOperationRequest {
    caller: Option<Value>,
    session_key: Option<String>,
    request_id: Option<String>,
}

impl SharedOperationState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshots: Mutex::new(HashMap::new()),
            watchers: Mutex::new(HashMap::new()),
            cancelled: tokio::sync::Mutex::new(HashMap::new()),
            cancel_notify: Notify::new(),
            fast_completion_watch_opened: Notify::new(),
            signals: tokio::sync::Mutex::new(HashMap::new()),
            signal_notify: Notify::new(),
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
    let shared_for_cancel = Arc::clone(shared);
    let shared_for_signal = Arc::clone(shared);

    service.register_operation_with_watch_and_signal::<EntityProcessOp, _, _, _, _, _, _, _, _, _>(
        {
            let shared = shared_clone;
            move |_context: trellis_rs::service::ServiceHandlerContext,
                  input: EntityProcessInput| {
                let shared = Arc::clone(&shared);
                async move {
                    let operation_id = format!("op-{}", input.message);
                    let initial_state = if spawn_completion {
                        ServiceOperationState::Pending
                    } else {
                        ServiceOperationState::Running
                    };
                    let (tx, _rx) = watch::channel(OperationSnapshot {
                        revision: 1,
                        state: initial_state.clone(),
                        ..Default::default()
                    });
                    let snapshot = OperationSnapshot {
                        revision: 1,
                        state: initial_state.clone(),
                        ..Default::default()
                    };
                    shared
                        .snapshots
                        .lock()
                        .unwrap()
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
                            let fast_completion = input.message == "fast-completion";
                            if fast_completion {
                                shared.fast_completion_watch_opened.notified().await;
                            } else {
                                tokio::time::sleep(Duration::from_millis(50)).await;
                            }
                            let progress_snapshot = OperationSnapshot {
                                revision: 2,
                                state: ServiceOperationState::Running,
                                progress: Some(EntityProcessProgress {
                                    message: input.message.clone(),
                                    step: 1,
                                }),
                                ..Default::default()
                            };
                            shared
                                .snapshots
                                .lock()
                                .unwrap()
                                .insert(op_id.clone(), progress_snapshot.clone());
                            if let Some(tx) = shared.watchers.lock().unwrap().get(&op_id) {
                                let _ = tx.send(progress_snapshot);
                            }

                            if !fast_completion {
                                tokio::time::sleep(Duration::from_millis(50)).await;
                            }
                            let complete_snapshot = OperationSnapshot {
                                revision: 3,
                                state: ServiceOperationState::Completed,
                                output: Some(EntityProcessOutput {
                                    message: input.message,
                                    done: true,
                                }),
                                ..Default::default()
                            };
                            shared
                                .snapshots
                                .lock()
                                .unwrap()
                                .insert(op_id.clone(), complete_snapshot.clone());
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
                            state: initial_state,
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
                    let snapshots = shared.snapshots.lock().unwrap();
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
                let initial = shared
                    .snapshots
                    .lock()
                    .unwrap()
                    .get(&operation_id)
                    .cloned()
                    .unwrap_or_else(|| OperationSnapshot {
                        revision: 1,
                        state: ServiceOperationState::Pending,
                        ..Default::default()
                    });
                let rx: Option<
                    watch::Receiver<OperationSnapshot<EntityProcessProgress, EntityProcessOutput>>,
                > = {
                    let watchers = shared.watchers.lock().unwrap();
                    watchers.get(&operation_id).map(|tx| tx.subscribe())
                };
                if operation_id == "op-fast-completion" {
                    shared.fast_completion_watch_opened.notify_one();
                }
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
        {
            let shared = shared_for_cancel;
            move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
                let shared = Arc::clone(&shared);
                async move {
                    let snapshot = OperationSnapshot {
                        revision: 2,
                        state: ServiceOperationState::Cancelled,
                        ..Default::default()
                    };
                    shared
                        .snapshots
                        .lock()
                        .unwrap()
                        .insert(operation_id.clone(), snapshot.clone());
                    if let Some(tx) = shared.watchers.lock().unwrap().get(&operation_id) {
                        let _ = tx.send(snapshot.clone());
                    }
                    shared.cancelled.lock().await.insert(operation_id, true);
                    shared.cancel_notify.notify_waiters();
                    Ok(snapshot)
                }
            }
        },
        {
            let shared = shared_for_signal;
            move |_context: trellis_rs::service::ServiceHandlerContext,
                  operation_id: String,
                  signal_name: String,
                  input: Option<Value>| {
                let shared = Arc::clone(&shared);
                async move {
                    if let Some(state) = shared
                        .snapshots
                        .lock()
                        .unwrap()
                        .get(&operation_id)
                        .map(|snapshot| snapshot.state.clone())
                    {
                        if state.is_terminal() {
                            return Err(ServerError::OperationTerminal {
                                operation_id,
                                state: service_operation_state_name(&state).to_string(),
                            });
                        }
                    }

                    let suffix = input
                        .as_ref()
                        .and_then(|value| value.get("suffix"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| ServerError::Nats("missing signal suffix".to_string()))?
                        .to_string();
                    let operation_message = operation_id
                        .strip_prefix("op-")
                        .unwrap_or(&operation_id)
                        .to_string();
                    let signal_sequence = {
                        let mut signals = shared.signals.lock().await;
                        let entry = signals.entry(operation_id.clone()).or_default();
                        entry.push(suffix.clone());
                        entry.len() as u64
                    };
                    shared.signal_notify.notify_waiters();

                    let progress_snapshot = OperationSnapshot {
                        revision: 2,
                        state: ServiceOperationState::Running,
                        progress: Some(EntityProcessProgress {
                            message: format!("{operation_message}:{suffix}"),
                            step: 2,
                        }),
                        ..Default::default()
                    };
                    shared
                        .snapshots
                        .lock()
                        .unwrap()
                        .insert(operation_id.clone(), progress_snapshot.clone());
                    if let Some(tx) = shared.watchers.lock().unwrap().get(&operation_id) {
                        let _ = tx.send(progress_snapshot.clone());
                    }

                    let complete_shared = Arc::clone(&shared);
                    let complete_operation_id = operation_id.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        let complete_snapshot = OperationSnapshot {
                            revision: 3,
                            state: ServiceOperationState::Completed,
                            output: Some(EntityProcessOutput {
                                message: format!("{operation_message}:{suffix}"),
                                done: true,
                            }),
                            ..Default::default()
                        };
                        complete_shared
                            .snapshots
                            .lock()
                            .unwrap()
                            .insert(complete_operation_id.clone(), complete_snapshot.clone());
                        if let Some(tx) = complete_shared
                            .watchers
                            .lock()
                            .unwrap()
                            .get(&complete_operation_id)
                        {
                            let _ = tx.send(complete_snapshot);
                        }
                    });

                    Ok(OperationSignalAccepted {
                        kind: "signal-accepted".to_string(),
                        operation_id,
                        signal: signal_name,
                        signal_sequence,
                        accepted_at: "2026-01-01T00:00:00Z".to_string(),
                        snapshot: progress_snapshot,
                    })
                }
            }
        },
    );

    let shared_for_status_start = Arc::clone(shared);
    let shared_for_status_get = Arc::clone(shared);
    let shared_for_status_wait = Arc::clone(shared);

    service.register_operation::<EntityStatusOp, _, _, _, _, _, _, _, _>(
        move |_context: trellis_rs::service::ServiceHandlerContext, input: EntityProcessInput| {
            let shared = Arc::clone(&shared_for_status_start);
            async move {
                let operation_id = format!("status-{}", input.message);
                let snapshot = OperationSnapshot {
                    revision: 1,
                    state: ServiceOperationState::Running,
                    ..Default::default()
                };
                shared
                    .snapshots
                    .lock()
                    .unwrap()
                    .insert(operation_id.clone(), snapshot.clone());

                Ok(AcceptedOperation {
                    kind: "accepted".to_string(),
                    operation_ref: OperationRefData {
                        id: operation_id,
                        service: "operations-fixture-service".to_string(),
                        operation: EntityStatusOp::KEY.to_string(),
                    },
                    snapshot,
                    transfer: None,
                })
            }
        },
        move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
            let shared = Arc::clone(&shared_for_status_get);
            async move {
                let snapshots = shared.snapshots.lock().unwrap();
                snapshots
                    .get(&operation_id)
                    .cloned()
                    .ok_or_else(|| ServerError::OperationNotFound { operation_id })
            }
        },
        move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
            let shared = Arc::clone(&shared_for_status_wait);
            async move {
                let snapshots = shared.snapshots.lock().unwrap();
                snapshots
                    .get(&operation_id)
                    .cloned()
                    .ok_or_else(|| ServerError::OperationNotFound { operation_id })
            }
        },
        |_context: trellis_rs::service::ServiceHandlerContext, _operation_id: String| async move {
            Err(ServerError::InvalidOperationControlAction {
                subject: EntityStatusOp::SUBJECT.to_string(),
                action: "cancel".to_string(),
            })
        },
    );
}

fn setup_signal_consuming_operation_service(
    shared: &Arc<SharedOperationState>,
    service: &mut trellis_rs::service::ConnectedServiceRuntime<OperationsServiceContract>,
    release_signal_consumption: Option<watch::Receiver<bool>>,
) {
    let operations =
        trellis_rs::service::InMemoryOperationRuntime::new("operations-fixture-service")
            .operation::<EntityProcessOp>();
    let shared_for_start = Arc::clone(shared);
    let operations_for_start = operations.clone();
    let operations_for_get = operations.clone();
    let operations_for_watch = operations.clone();
    let operations_for_cancel = operations.clone();

    service.register_operation_with_watch_and_signal::<EntityProcessOp, _, _, _, _, _, _, _, _, _>(
        move |_context: trellis_rs::service::ServiceHandlerContext, input: EntityProcessInput| {
            let operations = operations_for_start.clone();
            let shared = Arc::clone(&shared_for_start);
            let release_signal_consumption = release_signal_consumption.clone();
            async move {
                let operation_message = input.message;
                let accepted = operations.accept(format!("op-{operation_message}")).await?;
                let operation_ref = accepted.operation_ref.clone();
                let running = operations
                    .control_ref(operation_ref.clone())
                    .await?
                    .started()
                    .await?;
                let mut signals = operations
                    .control_ref(operation_ref.clone())
                    .await?
                    .signals()
                    .await?;
                let operations_for_consumer = operations.clone();

                tokio::spawn(async move {
                    if let Some(mut release) = release_signal_consumption {
                        while !*release.borrow() {
                            if release.changed().await.is_err() {
                                return;
                            }
                        }
                    }

                    while let Some(signal) = signals.next().await {
                        let Ok(signal) = signal else {
                            return;
                        };
                        let suffix = signal
                            .input
                            .as_ref()
                            .and_then(|value| value.get("suffix"))
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        shared
                            .signals
                            .lock()
                            .await
                            .entry(signal.operation_id.clone())
                            .or_default()
                            .push(suffix.clone());
                        shared.signal_notify.notify_waiters();

                        if operation_message == "terminal-signal" {
                            if let Ok(control) = operations_for_consumer
                                .control(signal.operation_id.clone())
                                .await
                            {
                                let _ = control
                                    .complete(EntityProcessOutput {
                                        message: format!("{operation_message}:{suffix}"),
                                        done: true,
                                    })
                                    .await;
                            }
                            return;
                        }
                    }
                });

                Ok(AcceptedOperation {
                    snapshot: running,
                    ..accepted
                })
            }
        },
        move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
            let operations = operations_for_get.clone();
            async move { operations.get(operation_id).await }
        },
        move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
            let operations = operations_for_watch.clone();
            Box::pin(stream::once(
                async move { operations.get(operation_id).await },
            ))
        },
        move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
            let operations = operations_for_cancel.clone();
            async move { operations.cancel(operation_id).await }
        },
        move |_context: trellis_rs::service::ServiceHandlerContext,
              operation_id: String,
              signal_name: String,
              input: Option<Value>| {
            let operations = operations.clone();
            async move { operations.signal(operation_id, signal_name, input).await }
        },
    );
}

fn setup_control_operation_service(
    service: &mut trellis_rs::service::ConnectedServiceRuntime<OperationsServiceContract>,
    operations: trellis_rs::service::ServiceOperation<EntityProcessOp>,
    observed_requests: Option<Arc<tokio::sync::Mutex<Vec<ObservedOperationRequest>>>>,
) {
    service.register_operation::<EntityProcessOp, _, _, _, _, _, _, _, _>(
        {
            let operations = operations.clone();
            move |context: trellis_rs::service::ServiceHandlerContext, input: EntityProcessInput| {
                let operations = operations.clone();
                let observed_requests = observed_requests.clone();
                async move {
                    if let Some(observed_requests) = observed_requests {
                        let request = context.request();
                        observed_requests
                            .lock()
                            .await
                            .push(ObservedOperationRequest {
                                caller: request.caller.clone(),
                                session_key: request.session_key.clone(),
                                request_id: request.request_id.clone(),
                            });
                    }

                    let accepted = operations.accept(format!("op-{}", input.message)).await?;
                    let running = operations
                        .control_ref(accepted.operation_ref.clone())
                        .await?
                        .started()
                        .await?;
                    Ok(AcceptedOperation {
                        snapshot: running,
                        ..accepted
                    })
                }
            }
        },
        {
            let operations = operations.clone();
            move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
                let operations = operations.clone();
                async move { operations.get(operation_id).await }
            }
        },
        {
            let operations = operations.clone();
            move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
                let operations = operations.clone();
                async move { operations.wait(operation_id).await }
            }
        },
        move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
            let operations = operations.clone();
            async move { operations.cancel(operation_id).await }
        },
    );
}

struct ControlOperationFixture {
    runtime: trellis_test::TrellisTestRuntime,
    service_key: trellis_test::TrellisTestServiceKey,
    service_task: AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>>,
    client: trellis_rs::client::TrellisClient,
    operations: trellis_rs::service::ServiceOperation<EntityProcessOp>,
}

async fn start_control_operation_fixture(
    observed_requests: Option<Arc<tokio::sync::Mutex<Vec<ObservedOperationRequest>>>>,
) -> ControlOperationFixture {
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
    let operations =
        trellis_rs::service::InMemoryOperationRuntime::new("operations-fixture-service")
            .operation::<EntityProcessOp>();
    setup_control_operation_service(&mut service, operations.clone(), observed_requests);
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    ControlOperationFixture {
        runtime,
        service_key,
        service_task,
        client,
        operations,
    }
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
async fn operations_watch_callbacks_deliver_accepted_first_in_order() {
    assert_case_registered(
        "operations.watch-callbacks-deliver-accepted-first-in-order",
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

    let ordered_ref = start_operation_with_retry(&client, "ordered-completion").await;
    let ordered_events: Vec<_> = ordered_ref
        .watch()
        .await
        .expect("watch operation")
        .collect()
        .await;

    assert!(
        matches!(
            ordered_events.first(),
            Some(Ok(OperationEvent::Accepted { .. }))
        ),
        "operation watch should deliver accepted first: {ordered_events:?}"
    );
    assert!(
        matches!(
            ordered_events.get(1),
            Some(Ok(OperationEvent::Progress { .. }))
        ),
        "operation watch should deliver progress after accepted: {ordered_events:?}"
    );

    let Some(Ok(OperationEvent::Completed { snapshot })) = ordered_events.last() else {
        panic!("operation watch should finish with completion: {ordered_events:?}");
    };
    assert_eq!(snapshot.state, ClientOperationState::Completed);
    assert_eq!(
        snapshot.output,
        Some(EntityProcessOutput {
            message: "ordered-completion".to_string(),
            done: true,
        })
    );

    let fast_ref = start_operation_with_retry(&client, "fast-completion").await;
    let fast_events: Vec<_> = fast_ref
        .watch()
        .await
        .expect("watch fast operation")
        .collect()
        .await;
    assert!(
        matches!(
            fast_events.first(),
            Some(Ok(OperationEvent::Accepted { .. }))
        ),
        "fast operation watch should deliver accepted first: {fast_events:?}"
    );

    let Some(Ok(OperationEvent::Completed { snapshot })) = fast_events.last() else {
        panic!("fast operation watch should finish with completion: {fast_events:?}");
    };
    let expected_output = Some(EntityProcessOutput {
        message: "fast-completion".to_string(),
        done: true,
    });
    assert_eq!(snapshot.state, ClientOperationState::Completed);
    assert_eq!(snapshot.output, expected_output);

    let terminal = fast_ref
        .wait()
        .await
        .expect("wait fast operation completion");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    assert_eq!(terminal.output, expected_output);

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_client_cancels_operation() {
    assert_case_registered(
        "operations.client-cancels-operation",
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
    let mut events = operation_ref.watch().await.expect("watch operation");

    let cancelled = operation_ref.cancel().await.expect("cancel operation");
    assert_eq!(cancelled.state, ClientOperationState::Cancelled);

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if shared
                .cancelled
                .lock()
                .await
                .get(operation_ref.id())
                .copied()
                .unwrap_or(false)
            {
                break;
            }
            shared.cancel_notify.notified().await;
        }
    })
    .await
    .expect("service should observe operation cancellation");

    let waited = operation_ref
        .wait()
        .await
        .expect("wait cancelled operation");
    assert_eq!(waited.state, ClientOperationState::Cancelled);

    let mut saw_cancelled = false;
    while let Some(event) = tokio::time::timeout(Duration::from_secs(5), events.next())
        .await
        .expect("operation watch should produce a terminal event")
    {
        let event = event.expect("operation watch event");
        if let OperationEvent::Cancelled { snapshot } = event {
            assert_eq!(snapshot.state, ClientOperationState::Cancelled);
            saw_cancelled = true;
            break;
        }
    }
    assert!(saw_cancelled, "operation watch should observe cancellation");

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_cancel_uses_cancel_capability() {
    assert!(
        crate::support::cases::rust_case_by_id("operations.cancel-uses-cancel-capability")
            .is_some(),
        "Rust manifest is missing operations.cancel-uses-cancel-capability"
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
    let observer = runtime
        .start_nats_message_observer("rpc.v1.Auth.Requests.Validate")
        .await
        .expect("start auth validation NATS observer");

    let cancelled = operation_ref.cancel().await.expect("cancel operation");
    assert_eq!(cancelled.state, ClientOperationState::Cancelled);

    wait_for_observed_auth_capability(&observer, OP_CANCEL_CAPABILITY).await;
    let capability_sets = observed_auth_capability_sets(&observer);
    assert!(
        !capability_sets
            .iter()
            .any(|capabilities| capabilities == &[OP_CONTROL_CAPABILITY.to_string()]),
        "cancel auth should not use control capability: {capability_sets:?}"
    );

    observer.stop().await;
    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_rejects_cancel_for_noncancelable_operation() {
    assert!(
        crate::support::cases::rust_case_by_id(
            "operations.rejects-cancel-for-noncancelable-operation",
        )
        .is_some(),
        "Rust manifest is missing operations.rejects-cancel-for-noncancelable-operation"
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

    let operation_ref = start_status_operation_with_retry(&client, "operation-1").await;
    let running = operation_ref.get().await.expect("get status operation");
    assert_eq!(running.state, ClientOperationState::Running);

    let result = operation_ref.cancel().await;
    assert!(
        result.is_err(),
        "non-cancelable operation cancel should return an expected error"
    );

    let unchanged = operation_ref
        .get()
        .await
        .expect("get status operation after rejected cancel");
    assert_eq!(unchanged.revision, 1);
    assert_eq!(unchanged.state, ClientOperationState::Running);

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_client_signals_running_operation() {
    assert_case_registered(
        "operations.client-signals-running-operation",
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
    let running = operation_ref.get().await.expect("get running operation");
    assert_eq!(running.state, ClientOperationState::Running);
    let mut events = operation_ref.watch().await.expect("watch operation");

    let ack = operation_ref
        .signal("updateMessage", Some(json!({ "suffix": "from-signal" })))
        .await
        .expect("signal running operation");
    assert_eq!(ack.kind, "signal-accepted");
    assert_eq!(ack.signal, "updateMessage");
    assert_eq!(ack.signal_sequence, 1);
    assert_eq!(
        ack.snapshot.progress,
        Some(EntityProcessProgress {
            message: "operation-1:from-signal".to_string(),
            step: 2,
        })
    );

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if shared
                .signals
                .lock()
                .await
                .get(operation_ref.id())
                .is_some_and(|signals| signals.iter().any(|signal| signal == "from-signal"))
            {
                break;
            }
            shared.signal_notify.notified().await;
        }
    })
    .await
    .expect("service should observe operation signal");

    let mut saw_signal_progress = false;
    while let Some(event) = tokio::time::timeout(Duration::from_secs(5), events.next())
        .await
        .expect("operation watch should produce signal-derived events")
    {
        let event = event.expect("operation watch event");
        match event {
            OperationEvent::Progress { snapshot } => {
                assert_eq!(
                    snapshot.progress,
                    Some(EntityProcessProgress {
                        message: "operation-1:from-signal".to_string(),
                        step: 2,
                    })
                );
                saw_signal_progress = true;
            }
            OperationEvent::Completed { snapshot } => {
                assert_eq!(snapshot.state, ClientOperationState::Completed);
                assert_eq!(
                    snapshot.output,
                    Some(EntityProcessOutput {
                        message: "operation-1:from-signal".to_string(),
                        done: true,
                    })
                );
                break;
            }
            _ => {}
        }
    }
    assert!(
        saw_signal_progress,
        "operation watch should observe signal-derived progress"
    );

    let terminal = operation_ref
        .wait()
        .await
        .expect("wait signalled operation completion");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    assert_eq!(
        terminal.output,
        Some(EntityProcessOutput {
            message: "operation-1:from-signal".to_string(),
            done: true,
        })
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_signals_persist_and_consume_in_acceptance_order() {
    assert!(
        crate::support::cases::rust_case_by_id(
            "operations.signals-persist-and-consume-in-acceptance-order",
        )
        .is_some(),
        "Rust manifest is missing operations.signals-persist-and-consume-in-acceptance-order"
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
    setup_signal_consuming_operation_service(&shared, &mut service, None);

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "signal-order").await;
    let first = operation_ref
        .signal("updateMessage", Some(json!({ "suffix": "first" })))
        .await
        .expect("accept first operation signal");
    let second = operation_ref
        .signal("appendMessage", Some(json!({ "suffix": "second" })))
        .await
        .expect("accept second operation signal");

    assert_eq!(first.signal_sequence, 1);
    assert_eq!(second.signal_sequence, 2);
    assert_eq!(
        wait_for_recorded_signals(&shared, operation_ref.id(), 2).await,
        vec!["first".to_string(), "second".to_string()]
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_queued_signal_delivered_before_live_signal() {
    assert!(
        crate::support::cases::rust_case_by_id(
            "operations.queued-signal-delivered-before-live-signal",
        )
        .is_some(),
        "Rust manifest is missing operations.queued-signal-delivered-before-live-signal"
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
    let (release_signals, release_signals_rx) = watch::channel(false);
    setup_signal_consuming_operation_service(&shared, &mut service, Some(release_signals_rx));

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "queued-signal").await;
    let queued = operation_ref
        .signal("updateMessage", Some(json!({ "suffix": "queued" })))
        .await
        .expect("accept queued operation signal");
    assert_eq!(queued.signal_sequence, 1);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        shared
            .signals
            .lock()
            .await
            .get(operation_ref.id())
            .is_none(),
        "service should not consume signal before release"
    );

    release_signals.send(true).expect("release signal consumer");
    let live = operation_ref
        .signal("appendMessage", Some(json!({ "suffix": "live" })))
        .await
        .expect("accept live operation signal");
    assert_eq!(live.signal_sequence, 2);
    assert_eq!(
        wait_for_recorded_signals(&shared, operation_ref.id(), 2).await,
        vec!["queued".to_string(), "live".to_string()]
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_rejects_invalid_signal_payload() {
    assert!(
        crate::support::cases::rust_case_by_id("operations.rejects-invalid-signal-payload")
            .is_some(),
        "Rust manifest is missing operations.rejects-invalid-signal-payload"
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
    setup_signal_consuming_operation_service(&shared, &mut service, None);

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "invalid-signal").await;
    let result = operation_ref
        .signal("updateMessage", Some(json!({ "suffix": 123 })))
        .await;
    assert!(result.is_err(), "invalid signal payload should be rejected");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        shared
            .signals
            .lock()
            .await
            .get(operation_ref.id())
            .is_none(),
        "invalid signal payload should not be consumed"
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_rejects_signal_after_terminal_state() {
    assert!(
        crate::support::cases::rust_case_by_id("operations.rejects-signal-after-terminal-state")
            .is_some(),
        "Rust manifest is missing operations.rejects-signal-after-terminal-state"
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
    setup_signal_consuming_operation_service(&shared, &mut service, None);

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "terminal-signal").await;
    let accepted = operation_ref
        .signal("updateMessage", Some(json!({ "suffix": "finish" })))
        .await
        .expect("accept signal that completes operation");
    assert_eq!(accepted.signal_sequence, 1);
    assert_eq!(
        wait_for_recorded_signals(&shared, operation_ref.id(), 1).await,
        vec!["finish".to_string()]
    );

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = operation_ref
            .get()
            .await
            .expect("get terminal signal operation");
        if snapshot.state == ClientOperationState::Completed {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "operation should complete before terminal signal rejection"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let result = operation_ref
        .signal("updateMessage", Some(json!({ "suffix": "too-late" })))
        .await;
    assert!(
        result.is_err(),
        "terminal operation signal should be rejected"
    );
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(
        shared.signals.lock().await.get(operation_ref.id()).cloned(),
        Some(vec!["finish".to_string()])
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_service_attach_job_waits_for_completion() {
    assert_case_registered(
        "operations.service-attach-job-waits-for-completion",
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

    let operations =
        trellis_rs::service::InMemoryOperationRuntime::new("operations-fixture-service")
            .operation::<EntityProcessOp>();
    let (release_attached_task, release_attached_task_rx) = watch::channel(false);

    service.register_operation::<EntityProcessOp, _, _, _, _, _, _, _, _>(
        {
            let operations = operations.clone();
            let release_attached_task_rx = release_attached_task_rx.clone();
            move |_context: trellis_rs::service::ServiceHandlerContext,
                  input: EntityProcessInput| {
                let operations = operations.clone();
                let release_attached_task_rx = release_attached_task_rx.clone();
                async move {
                    let operation_id = format!("op-{}", input.message);
                    let accepted = operations.accept(operation_id).await?;
                    let operation_ref = accepted.operation_ref.clone();
                    let running = operations
                        .control_ref(operation_ref.clone())
                        .await?
                        .progress(EntityProcessProgress {
                            message: input.message.clone(),
                            step: 1,
                        })
                        .await?;

                    let operations_for_attach = operations.clone();
                    let operations_for_task = operations.clone();
                    tokio::spawn(async move {
                        let attach_control = operations_for_attach
                            .control_ref(operation_ref.clone())
                            .await?;
                        let task_control = operations_for_task.control_ref(operation_ref).await?;
                        attach_control
                            .attach(async move {
                                let mut release_attached_task_rx = release_attached_task_rx;
                                while !*release_attached_task_rx.borrow() {
                                    release_attached_task_rx.changed().await.map_err(|_| {
                                        ServerError::Nats(
                                            "attached operation release signal closed".to_string(),
                                        )
                                    })?;
                                }
                                task_control
                                    .complete(EntityProcessOutput {
                                        message: format!("{}:attached", input.message),
                                        done: true,
                                    })
                                    .await?;
                                Ok::<(), ServerError>(())
                            })
                            .await
                    });

                    Ok(AcceptedOperation {
                        snapshot: running,
                        ..accepted
                    })
                }
            }
        },
        {
            let operations = operations.clone();
            move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
                let operations = operations.clone();
                async move { operations.get(operation_id).await }
            }
        },
        {
            let operations = operations.clone();
            move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
                let operations = operations.clone();
                async move { operations.wait(operation_id).await }
            }
        },
        move |_context: trellis_rs::service::ServiceHandlerContext, operation_id: String| {
            let operations = operations.clone();
            async move { operations.cancel(operation_id).await }
        },
    );

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "operation-1").await;
    let running = operation_ref.get().await.expect("get running operation");
    assert_eq!(running.state, ClientOperationState::Running);
    assert_eq!(
        running.progress,
        Some(EntityProcessProgress {
            message: "operation-1".to_string(),
            step: 1,
        })
    );
    assert_eq!(running.output, None);

    release_attached_task
        .send(true)
        .expect("release attached operation task");

    let terminal = operation_ref
        .wait()
        .await
        .expect("wait attached operation completion");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    assert_eq!(
        terminal.output,
        Some(EntityProcessOutput {
            message: "operation-1:attached".to_string(),
            done: true,
        })
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_service_handler_receives_client_context() {
    assert!(
        crate::support::cases::rust_case_by_id(
            "operations.service-handler-receives-client-context",
        )
        .is_some(),
        "Rust manifest is missing operations.service-handler-receives-client-context"
    );

    let observed_requests = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let fixture = start_control_operation_fixture(Some(Arc::clone(&observed_requests))).await;

    let _operation_ref = start_operation_with_retry(&fixture.client, "context").await;

    let observed_requests = observed_requests.lock().await;
    assert_eq!(observed_requests.len(), 1);
    assert!(observed_requests[0].caller.is_some());
    assert!(observed_requests[0]
        .session_key
        .as_ref()
        .is_some_and(|session| !session.is_empty()));
    assert!(observed_requests[0]
        .request_id
        .as_ref()
        .is_some_and(|request_id| !request_id.is_empty()));

    fixture.service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_service_defer_keeps_operation_running() {
    assert!(
        crate::support::cases::rust_case_by_id("operations.service-defer-keeps-operation-running",)
            .is_some(),
        "Rust manifest is missing operations.service-defer-keeps-operation-running"
    );

    let fixture = start_control_operation_fixture(None).await;
    let operation_ref = start_operation_with_retry(&fixture.client, "deferred").await;

    let running = operation_ref.get().await.expect("get deferred operation");
    assert_eq!(running.state, ClientOperationState::Running);
    assert_eq!(running.output, None);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), operation_ref.wait())
            .await
            .is_err(),
        "deferred operation should remain non-terminal until service control resumes it"
    );

    fixture.service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_service_control_resumes_deferred_operation() {
    assert!(
        crate::support::cases::rust_case_by_id(
            "operations.service-control-resumes-deferred-operation",
        )
        .is_some(),
        "Rust manifest is missing operations.service-control-resumes-deferred-operation"
    );

    let fixture = start_control_operation_fixture(None).await;
    let operation_ref = start_operation_with_retry(&fixture.client, "control-resume").await;

    fixture
        .operations
        .control(operation_ref.id())
        .await
        .expect("load service operation control")
        .complete(EntityProcessOutput {
            message: "control-resume:resumed".to_string(),
            done: true,
        })
        .await
        .expect("complete deferred operation from service control");

    let terminal = operation_ref
        .wait()
        .await
        .expect("wait service-resumed operation");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    assert_eq!(
        terminal.output,
        Some(EntityProcessOutput {
            message: "control-resume:resumed".to_string(),
            done: true,
        })
    );

    fixture.service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_service_control_loads_durable_record_after_restart() {
    assert!(
        crate::support::cases::rust_case_by_id(
            "operations.service-control-loads-durable-record-after-restart",
        )
        .is_some(),
        "Rust manifest is missing operations.service-control-loads-durable-record-after-restart"
    );

    let fixture = start_control_operation_fixture(None).await;
    let operation_ref = start_operation_with_retry(&fixture.client, "restart-load").await;
    let durable_snapshot: OperationSnapshot<Value, Value> = serde_json::from_value(
        serde_json::to_value(
            fixture
                .operations
                .get(operation_ref.id())
                .await
                .expect("get durable operation before service restart"),
        )
        .expect("serialize durable snapshot"),
    )
    .expect("decode untyped durable snapshot");

    fixture.service_task.abort_and_wait().await;

    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<OperationsServiceContract>::connect(
            fixture
                .runtime
                .service_connect_options("operations-fixture-service", &fixture.service_key),
        )
        .await
        .expect("reconnect live Rust operations service");
    let restored_operations =
        trellis_rs::service::InMemoryOperationRuntime::new("operations-fixture-service")
            .operation::<EntityProcessOp>();
    restored_operations
        .restore_snapshot(durable_snapshot)
        .await
        .expect("restore durable operation snapshot after service restart");
    setup_control_operation_service(&mut service, restored_operations.clone(), None);
    let restarted_service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let resumed_ref = fixture
        .client
        .operation::<EntityProcessOp>()
        .control(operation_ref.id())
        .expect("resume operation ref by id");
    let deadline = Instant::now() + Duration::from_secs(5);
    let running = loop {
        match resumed_ref.get().await {
            Ok(snapshot) => break snapshot,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("get restored operation through live control path: {error}"),
        }
    };
    assert_eq!(running.state, ClientOperationState::Running);
    assert_eq!(running.revision, 2);

    restarted_service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_service_accept_resume_completes_durable_operation() {
    assert!(
        crate::support::cases::rust_case_by_id(
            "operations.service-accept-resume-completes-durable-operation",
        )
        .is_some(),
        "Rust manifest is missing operations.service-accept-resume-completes-durable-operation"
    );

    let fixture = start_control_operation_fixture(None).await;
    let operation_ref = start_operation_with_retry(&fixture.client, "accept-resume").await;
    let resumed_ref = fixture
        .client
        .operation::<EntityProcessOp>()
        .control(operation_ref.id())
        .expect("resume operation ref by id");

    fixture
        .operations
        .control(operation_ref.id())
        .await
        .expect("load service operation control")
        .complete(EntityProcessOutput {
            message: "accept-resume:completed".to_string(),
            done: true,
        })
        .await
        .expect("complete resumed operation");

    let terminal = resumed_ref.wait().await.expect("wait resumed operation");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    assert_eq!(
        terminal.output,
        Some(EntityProcessOutput {
            message: "accept-resume:completed".to_string(),
            done: true,
        })
    );

    fixture.service_task.abort_and_wait().await;
}

#[tokio::test]
async fn operations_service_control_rejects_invalid_mismatch_payload_terminal() {
    assert!(
        crate::support::cases::rust_case_by_id(
            "operations.service-control-rejects-invalid-mismatch-payload-terminal",
        )
        .is_some(),
        "Rust manifest is missing operations.service-control-rejects-invalid-mismatch-payload-terminal"
    );

    let fixture = start_control_operation_fixture(None).await;
    let operation_ref = start_operation_with_retry(&fixture.client, "control-errors").await;
    let status_operations =
        trellis_rs::service::InMemoryOperationRuntime::new("operations-fixture-service")
            .operation::<EntityStatusOp>();

    let mismatch = status_operations
        .restore_snapshot(
            serde_json::from_value(
                serde_json::to_value(
                    fixture
                        .operations
                        .get(operation_ref.id())
                        .await
                        .expect("get operation snapshot"),
                )
                .expect("serialize operation snapshot"),
            )
            .expect("decode operation snapshot"),
        )
        .await;
    assert!(matches!(
        mismatch,
        Err(ServerError::OperationMismatch { .. })
    ));

    let mut invalid_snapshot: OperationSnapshot<Value, Value> = serde_json::from_value(
        serde_json::to_value(
            fixture
                .operations
                .get(operation_ref.id())
                .await
                .expect("get operation snapshot for invalid payload"),
        )
        .expect("serialize operation snapshot"),
    )
    .expect("decode operation snapshot");
    invalid_snapshot.progress = Some(json!({ "message": 7, "step": 1 }));
    let invalid_operations =
        trellis_rs::service::InMemoryOperationRuntime::new("operations-fixture-service")
            .operation::<EntityProcessOp>();
    invalid_operations
        .restore_snapshot(invalid_snapshot)
        .await
        .expect("restore invalid payload snapshot");
    assert!(
        invalid_operations.get(operation_ref.id()).await.is_err(),
        "typed control should reject invalid restored payload"
    );

    fixture
        .operations
        .control(operation_ref.id())
        .await
        .expect("load service operation control")
        .complete(EntityProcessOutput {
            message: "control-errors:done".to_string(),
            done: true,
        })
        .await
        .expect("complete operation");
    let terminal_update = fixture
        .operations
        .control(operation_ref.id())
        .await
        .expect("load terminal operation control")
        .progress(EntityProcessProgress {
            message: "too-late".to_string(),
            step: 2,
        })
        .await;
    assert!(matches!(
        terminal_update,
        Err(ServerError::OperationTerminal { .. })
    ));

    fixture.service_task.abort_and_wait().await;
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

async fn start_status_operation_with_retry<'a>(
    client: &'a trellis_rs::client::TrellisClient,
    message: &str,
) -> trellis_rs::client::OperationRef<'a, trellis_rs::client::TrellisClient, EntityStatusOp> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .operation::<EntityStatusOp>()
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
            Err(error) => panic!("start live Entity.Status operation: {error}"),
        }
    }
}

async fn wait_for_observed_auth_capability(
    observer: &trellis_test::TrellisNatsMessageObserver,
    capability: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let capability_sets = observed_auth_capability_sets(observer);
        if capability_sets
            .iter()
            .any(|capabilities| capabilities == &[capability.to_string()])
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for auth capability {capability}; observed: {capability_sets:?}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn observed_auth_capability_sets(
    observer: &trellis_test::TrellisNatsMessageObserver,
) -> Vec<Vec<String>> {
    observer
        .frames()
        .into_iter()
        .filter_map(|frame| serde_json::from_str::<Value>(&frame.payload).ok())
        .filter_map(|value| {
            value
                .get("capabilities")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(ToOwned::to_owned))
                        .collect::<Vec<_>>()
                })
        })
        .collect()
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

async fn wait_for_recorded_signals(
    shared: &SharedOperationState,
    operation_id: &str,
    expected_count: usize,
) -> Vec<String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(signals) = shared.signals.lock().await.get(operation_id).cloned() {
            if signals.len() >= expected_count {
                return signals;
            }
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {expected_count} recorded signals for {operation_id}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn service_operation_state_name(state: &ServiceOperationState) -> &'static str {
    match state {
        ServiceOperationState::Pending => "pending",
        ServiceOperationState::Running => "running",
        ServiceOperationState::Completed => "completed",
        ServiceOperationState::Failed => "failed",
        ServiceOperationState::Cancelled => "cancelled",
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
        trellis_rs::contracts::use_contract(OP_SERVICE_ID)
            .with_operation_call(["Entity.Process", "Entity.Status"]),
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
