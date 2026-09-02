use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::stream::{self, BoxStream};
use futures_util::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{watch, Notify};
use tokio::task::JoinHandle;
use trellis_rs::client::{
    OperationDescriptor, OperationEvent, OperationState as ClientOperationState,
};
use trellis_rs::service::GeneratedServiceContract;
use trellis_rs::service::{
    AcceptedOperation, OperationRefData, OperationSignalAccepted, OperationSnapshot,
    OperationState as ServiceOperationState, ServerError,
};

use crate::support::assertions::{
    assert_case_registered, assert_generated_service_contract, assert_runtime_case_registered,
};

const OP_SERVICE_ID: &str = "integration.operations-service@v1";
const OP_CLIENT_ID: &str = "integration.operations-client@v1";
const OP_UNAUTHORIZED_CLIENT_ID: &str = "integration.operations-unauthorized-client@v1";
const OP_PROCESS_CAPABILITY: &str = "process";
const OP_CANCEL_CAPABILITY: &str = "cancelProcess";
const OP_CONTROL_CAPABILITY: &str = "process";

const OP_SERVICE_API_SOURCE_JSON: &str = r#"{
  "format": "trellis.api.v1",
  "id": "integration.operations-service@v1",
  "version": "1.0.0",
  "displayName": "Trellis Integration Operations Service",
  "description": "Exercises client-to-service operation start and watch through generated surfaces.",
  "capabilities": {
    "process": {"allows": [
      {"target": {"kind": "apiSurface", "api": "integration.operations-service@v1", "surface": "operation", "name": "Entity.Process"}, "action": "invoke"},
      {"target": {"kind": "apiSurface", "api": "integration.operations-service@v1", "surface": "operation", "name": "Entity.Status"}, "action": "invoke"},
      {"target": {"kind": "apiSurface", "api": "integration.operations-service@v1", "surface": "operation", "name": "Entity.Process"}, "action": "observe"},
      {"target": {"kind": "apiSurface", "api": "integration.operations-service@v1", "surface": "operation", "name": "Entity.Status"}, "action": "observe"},
      {"target": {"kind": "operationSignal", "api": "integration.operations-service@v1", "operation": "Entity.Process", "signal": "updateMessage"}, "action": "control"},
      {"target": {"kind": "operationSignal", "api": "integration.operations-service@v1", "operation": "Entity.Process", "signal": "appendMessage"}, "action": "control"}
    ]},
    "cancelProcess": {"allows": [{"target": {"kind": "apiSurface", "api": "integration.operations-service@v1", "surface": "operation", "name": "Entity.Process"}, "action": "cancel"}]}
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
    "OperationUpdate": {
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
  "operations": {
    "Entity.Process": {
      "version": "v1",
      "input": { "schema": "OperationInput" },
      "update": { "schema": "OperationUpdate" },
      "progress": { "schema": "OperationProgress" },
      "output": { "schema": "OperationOutput" },
      "signals": {
        "updateMessage": { "input": { "schema": "OperationSignalInput" } },
        "appendMessage": { "input": { "schema": "OperationSignalInput" } }
      },
      "cancel": true
    },
    "Entity.Status": {
      "version": "v1",
      "input": { "schema": "OperationInput" },
      "progress": { "schema": "OperationProgress" },
      "output": { "schema": "OperationOutput" },
      "cancel": false
    }
  }
}"#;

struct OperationsServiceContract;

impl trellis_rs::service::GeneratedServiceContract for OperationsServiceContract {
    const PARTICIPANT_ID: &'static str = OP_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "v2foFDt4eZnzHHkLoSTSTle_B9-cX2UzSMxZx5dkEAM";
    const PARTICIPANT_NEEDS_DIGEST: &'static str = "fwo8l9xRKAS-ly-CUf3wm43AgIeYdLSkuJpyyPWLurY";
    const PARTICIPANT_JSON: &'static str = r#"{"description":"Exercises client-to-service operation start and watch through generated surfaces.","displayName":"Trellis Integration Operations Service","format":"trellis.participant.v1","id":"integration.operations-service@v1","implements":{"self":{"api":"integration.operations-service@v1","apiDigest":"PsEDVGJah2bA90N_sUpK5ZtEs3J-YTfuV_m7frJ_9bY"}},"kind":"service","schemas":{"OperationInput":{"properties":{"message":{"type":"string"}},"required":["message"],"type":"object"},"OperationOutput":{"properties":{"done":{"type":"boolean"},"message":{"type":"string"}},"required":["message","done"],"type":"object"},"OperationProgress":{"properties":{"message":{"type":"string"},"step":{"type":"integer"}},"required":["message","step"],"type":"object"},"OperationSignalInput":{"properties":{"suffix":{"type":"string"}},"required":["suffix"],"type":"object"},"OperationUpdate":{"properties":{"message":{"type":"string"},"step":{"type":"integer"}},"required":["message","step"],"type":"object"}}}"#;
    const API_JSON: &'static str = r#"{"capabilities":{"cancelProcess":{"allows":[{"action":"cancel","target":{"api":"integration.operations-service@v1","kind":"apiSurface","name":"Entity.Process","surface":"operation"}}]},"process":{"allows":[{"action":"invoke","target":{"api":"integration.operations-service@v1","kind":"apiSurface","name":"Entity.Process","surface":"operation"}},{"action":"observe","target":{"api":"integration.operations-service@v1","kind":"apiSurface","name":"Entity.Process","surface":"operation"}},{"action":"invoke","target":{"api":"integration.operations-service@v1","kind":"apiSurface","name":"Entity.Status","surface":"operation"}},{"action":"observe","target":{"api":"integration.operations-service@v1","kind":"apiSurface","name":"Entity.Status","surface":"operation"}},{"action":"control","target":{"api":"integration.operations-service@v1","kind":"operationSignal","operation":"Entity.Process","signal":"appendMessage"}},{"action":"control","target":{"api":"integration.operations-service@v1","kind":"operationSignal","operation":"Entity.Process","signal":"updateMessage"}}]}},"description":"Exercises client-to-service operation start and watch through generated surfaces.","displayName":"Trellis Integration Operations Service","format":"trellis.api.v1","id":"integration.operations-service@v1","version":"1.0.0","operations":{"Entity.Process":{"cancel":true,"input":{"schema":"OperationInput"},"output":{"schema":"OperationOutput"},"progress":{"schema":"OperationProgress"},"signals":{"appendMessage":{"input":{"schema":"OperationSignalInput"}},"updateMessage":{"input":{"schema":"OperationSignalInput"}}},"update":{"schema":"OperationUpdate"},"version":"v1"},"Entity.Status":{"input":{"schema":"OperationInput"},"output":{"schema":"OperationOutput"},"progress":{"schema":"OperationProgress"},"version":"v1"}},"schemas":{"OperationInput":{"properties":{"message":{"type":"string"}},"required":["message"],"type":"object"},"OperationOutput":{"properties":{"done":{"type":"boolean"},"message":{"type":"string"}},"required":["message","done"],"type":"object"},"OperationProgress":{"properties":{"message":{"type":"string"},"step":{"type":"integer"}},"required":["message","step"],"type":"object"},"OperationSignalInput":{"properties":{"suffix":{"type":"string"}},"required":["suffix"],"type":"object"},"OperationUpdate":{"properties":{"message":{"type":"string"},"step":{"type":"integer"}},"required":["message","step"],"type":"object"}}}"#;
    const API_DIGEST: &'static str = "PsEDVGJah2bA90N_sUpK5ZtEs3J-YTfuV_m7frJ_9bY";
    const REFERENCED_API_ARTIFACTS: &'static [(&'static str, &'static str)] = &[];
}

#[test]
fn operations_service_contract_evidence_is_exact() {
    let contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .unwrap();
    assert_generated_service_contract::<OperationsServiceContract>(&contract);
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityProcessUpdate {
    message: String,
    step: u64,
}

struct EntityProcessOp;

impl trellis_rs::client::OperationDescriptor for EntityProcessOp {
    type Input = EntityProcessInput;
    type Progress = EntityProcessProgress;
    type Output = EntityProcessOutput;
    type Update = EntityProcessUpdate;
    type UpdateEvidence = trellis_rs::client::DeclaredOperationUpdates;
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
    const UPDATE_SCHEMA_JSON: Option<&'static str> = Some(
        r#"{"type":"object","required":["message","step"],"properties":{"message":{"type":"string"},"step":{"type":"integer"}}}"#,
    );
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = r##"{"appendMessage":{"type":"object","required":["suffix"],"properties":{"suffix":{"type":"string"}}},"updateMessage":{"type":"object","required":["suffix"],"properties":{"suffix":{"type":"string"}}}}"##;
}

struct EntityStatusOp;

impl trellis_rs::client::OperationDescriptor for EntityStatusOp {
    type Input = EntityProcessInput;
    type Progress = EntityProcessProgress;
    type Output = EntityProcessOutput;
    type Update = Value;
    type UpdateEvidence = trellis_rs::client::NoOperationUpdates;
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
    const UPDATE_SCHEMA_JSON: Option<&'static str> = None;
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
    watch_opened: Notify,
    signals: tokio::sync::Mutex<HashMap<String, Vec<String>>>,
    signal_notify: Notify,
}

#[derive(Debug)]
struct ObservedOperationRequest {
    caller: Option<trellis_rs::service::VerifiedCaller>,
    session_key: Option<String>,
    request_id: Option<String>,
}

type ProviderFuture<T> = futures_util::future::BoxFuture<'static, Result<T, ServerError>>;
type StartProvider<D> = Box<
    dyn Fn(
            trellis_rs::service::RequestContext,
            <D as trellis_rs::service::OperationDescriptor>::Input,
        ) -> ProviderFuture<
            AcceptedOperation<
                <D as trellis_rs::service::OperationDescriptor>::Progress,
                <D as trellis_rs::service::OperationDescriptor>::Output,
            >,
        > + Send
        + Sync,
>;
type SnapshotProvider<D> = Box<
    dyn Fn(
            trellis_rs::service::RequestContext,
            String,
        ) -> ProviderFuture<
            OperationSnapshot<
                <D as trellis_rs::service::OperationDescriptor>::Progress,
                <D as trellis_rs::service::OperationDescriptor>::Output,
            >,
        > + Send
        + Sync,
>;
type WatchProvider<D> = Box<
    dyn Fn(
            trellis_rs::service::RequestContext,
            String,
        ) -> trellis_rs::service::OperationLiveWatch<
            <D as trellis_rs::service::OperationDescriptor>::Progress,
            <D as trellis_rs::service::OperationDescriptor>::Update,
            <D as trellis_rs::service::OperationDescriptor>::Output,
        > + Send
        + Sync,
>;
type SignalProvider<D> = Box<
    dyn Fn(
            trellis_rs::service::RequestContext,
            String,
            String,
            Option<Value>,
        ) -> ProviderFuture<
            OperationSignalAccepted<
                <D as trellis_rs::service::OperationDescriptor>::Progress,
                <D as trellis_rs::service::OperationDescriptor>::Output,
            >,
        > + Send
        + Sync,
>;

struct TestOperationProvider<D: trellis_rs::service::OperationDescriptor> {
    start: StartProvider<D>,
    get: SnapshotProvider<D>,
    wait: SnapshotProvider<D>,
    watch: WatchProvider<D>,
    cancel: SnapshotProvider<D>,
    signal: SignalProvider<D>,
}

impl<D> trellis_rs::service::ServiceOperationProvider<D> for TestOperationProvider<D>
where
    D: trellis_rs::service::OperationDescriptor + 'static,
{
    fn start(
        &self,
        context: trellis_rs::service::RequestContext,
        input: D::Input,
    ) -> ProviderFuture<AcceptedOperation<D::Progress, D::Output>> {
        (self.start)(context, input)
    }
    fn get(
        &self,
        context: trellis_rs::service::RequestContext,
        operation_id: String,
    ) -> ProviderFuture<OperationSnapshot<D::Progress, D::Output>> {
        (self.get)(context, operation_id)
    }
    fn wait(
        &self,
        context: trellis_rs::service::RequestContext,
        operation_id: String,
    ) -> ProviderFuture<OperationSnapshot<D::Progress, D::Output>> {
        (self.wait)(context, operation_id)
    }
    fn watch(
        &self,
        context: trellis_rs::service::RequestContext,
        operation_id: String,
    ) -> trellis_rs::service::OperationLiveWatch<D::Progress, D::Update, D::Output> {
        (self.watch)(context, operation_id)
    }
    fn cancel(
        &self,
        context: trellis_rs::service::RequestContext,
        operation_id: String,
    ) -> ProviderFuture<OperationSnapshot<D::Progress, D::Output>> {
        (self.cancel)(context, operation_id)
    }
    fn signal(
        &self,
        context: trellis_rs::service::RequestContext,
        operation_id: String,
        signal: String,
        input: Option<Value>,
    ) -> ProviderFuture<OperationSignalAccepted<D::Progress, D::Output>> {
        (self.signal)(context, operation_id, signal, input)
    }
}

impl SharedOperationState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshots: Mutex::new(HashMap::new()),
            watchers: Mutex::new(HashMap::new()),
            cancelled: tokio::sync::Mutex::new(HashMap::new()),
            cancel_notify: Notify::new(),
            watch_opened: Notify::new(),
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

    service.register_operation_provider::<EntityProcessOp, _>(TestOperationProvider {
        start: Box::new({
            let shared = shared_clone;
            move |_context: trellis_rs::service::RequestContext, input: EntityProcessInput| {
                let shared = Arc::clone(&shared);
                Box::pin(async move {
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
                            let _ = tokio::time::timeout(
                                Duration::from_secs(2),
                                shared.watch_opened.notified(),
                            )
                            .await;
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
                })
            }
        }),
        get: Box::new({
            let shared = shared_for_getter;
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let shared = Arc::clone(&shared);
                Box::pin(async move {
                    let snapshots = shared.snapshots.lock().unwrap();
                    snapshots
                        .get(&operation_id)
                        .cloned()
                        .ok_or(ServerError::OperationNotFound { operation_id })
                })
            }
        }),
        wait: Box::new({
            let shared = Arc::clone(shared);
            move |_context, operation_id| {
                let shared = Arc::clone(&shared);
                Box::pin(async move {
                    shared
                        .snapshots
                        .lock()
                        .unwrap()
                        .get(&operation_id)
                        .cloned()
                        .ok_or(ServerError::OperationNotFound { operation_id })
                })
            }
        }),
        watch: Box::new({
            let shared = shared_for_watcher;
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
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
                shared.watch_opened.notify_one();
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
                Box::pin(stream.map(|snapshot| {
                    snapshot.map(trellis_rs::service::OperationLiveEvent::Snapshot)
                }))
            }
        }),
        cancel: Box::new({
            let shared = shared_for_cancel;
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let shared = Arc::clone(&shared);
                Box::pin(async move {
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
                })
            }
        }),
        signal: Box::new({
            let shared = shared_for_signal;
            move |_context: trellis_rs::service::RequestContext,
                  operation_id: String,
                  signal_name: String,
                  input: Option<Value>| {
                let shared = Arc::clone(&shared);
                Box::pin(async move {
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
                })
            }
        }),
    });

    let shared_for_status_start = Arc::clone(shared);
    let shared_for_status_get = Arc::clone(shared);
    let shared_for_status_wait = Arc::clone(shared);

    service.register_operation_provider::<EntityStatusOp, _>(TestOperationProvider {
        start: Box::new(
            move |_context: trellis_rs::service::RequestContext, input: EntityProcessInput| {
                let shared = Arc::clone(&shared_for_status_start);
                Box::pin(async move {
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
                })
            },
        ),
        get: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let shared = Arc::clone(&shared_for_status_get);
                Box::pin(async move {
                    let snapshots = shared.snapshots.lock().unwrap();
                    snapshots
                        .get(&operation_id)
                        .cloned()
                        .ok_or(ServerError::OperationNotFound { operation_id })
                })
            },
        ),
        wait: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let shared = Arc::clone(&shared_for_status_wait);
                Box::pin(async move {
                    let snapshots = shared.snapshots.lock().unwrap();
                    snapshots
                        .get(&operation_id)
                        .cloned()
                        .ok_or(ServerError::OperationNotFound { operation_id })
                })
            },
        ),
        watch: Box::new(|_context, _operation_id| Box::pin(stream::empty())),
        cancel: Box::new(
            |_context: trellis_rs::service::RequestContext, _operation_id: String| {
                Box::pin(async move {
                    Err(ServerError::InvalidOperationControlAction {
                        subject: EntityStatusOp::SUBJECT.to_string(),
                        action: "cancel".to_string(),
                    })
                })
            },
        ),
        signal: Box::new(|_context, operation_id, _signal, _input| {
            Box::pin(async move {
                Err(ServerError::InvalidOperationControlAction {
                    subject: operation_id,
                    action: "signal".to_string(),
                })
            })
        }),
    });
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

    service.register_operation_provider::<EntityProcessOp, _>(TestOperationProvider {
        start: Box::new(
            move |_context: trellis_rs::service::RequestContext, input: EntityProcessInput| {
                let operations = operations_for_start.clone();
                let shared = Arc::clone(&shared_for_start);
                let release_signal_consumption = release_signal_consumption.clone();
                Box::pin(async move {
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
                })
            },
        ),
        get: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations_for_get.clone();
                Box::pin(async move { operations.get(operation_id).await })
            },
        ),
        wait: Box::new({
            let operations = operations_for_watch.clone();
            move |_context, operation_id| {
                let operations = operations.clone();
                Box::pin(async move { operations.wait(operation_id).await })
            }
        }),
        watch: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations_for_watch.clone();
                Box::pin(stream::once(async move {
                    operations
                        .get(operation_id)
                        .await
                        .map(trellis_rs::service::OperationLiveEvent::Snapshot)
                }))
            },
        ),
        cancel: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations_for_cancel.clone();
                Box::pin(async move { operations.cancel(operation_id).await })
            },
        ),
        signal: Box::new(
            move |_context: trellis_rs::service::RequestContext,
                  operation_id: String,
                  signal_name: String,
                  input: Option<Value>| {
                let operations = operations.clone();
                Box::pin(async move { operations.signal(operation_id, signal_name, input).await })
            },
        ),
    });
}

fn setup_control_operation_service(
    service: &mut trellis_rs::service::ConnectedServiceRuntime<OperationsServiceContract>,
    operations: trellis_rs::service::ServiceOperation<EntityProcessOp>,
    observed_requests: Option<Arc<tokio::sync::Mutex<Vec<ObservedOperationRequest>>>>,
) {
    service.register_operation_provider::<EntityProcessOp, _>(TestOperationProvider {
        start: Box::new({
            let operations = operations.clone();
            move |context: trellis_rs::service::RequestContext, input: EntityProcessInput| {
                let operations = operations.clone();
                let observed_requests = observed_requests.clone();
                Box::pin(async move {
                    if let Some(observed_requests) = observed_requests {
                        observed_requests
                            .lock()
                            .await
                            .push(ObservedOperationRequest {
                                caller: context.caller.clone(),
                                session_key: context.session_key.clone(),
                                request_id: context.request_id.clone(),
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
                })
            }
        }),
        get: Box::new({
            let operations = operations.clone();
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations.clone();
                Box::pin(async move { operations.get(operation_id).await })
            }
        }),
        wait: Box::new({
            let operations = operations.clone();
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations.clone();
                Box::pin(async move { operations.wait(operation_id).await })
            }
        }),
        watch: Box::new({
            let operations = operations.clone();
            move |_context, operation_id| {
                let operations = operations.clone();
                Box::pin(stream::once(async move {
                    operations
                        .wait(operation_id)
                        .await
                        .map(trellis_rs::service::OperationLiveEvent::Snapshot)
                }))
            }
        }),
        cancel: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations.clone();
                Box::pin(async move { operations.cancel(operation_id).await })
            },
        ),
        signal: Box::new(|_context, operation_id, _signal, _input| {
            Box::pin(async move {
                Err(ServerError::InvalidOperationControlAction {
                    subject: operation_id,
                    action: "signal".to_string(),
                })
            })
        }),
    });
}

#[derive(Default)]
struct OperationUpdateGates {
    watch_opened: Notify,
    release_updates: Notify,
    release_terminal: Notify,
}

fn setup_update_operation_service(
    service: &mut trellis_rs::service::ConnectedServiceRuntime<OperationsServiceContract>,
    operations: trellis_rs::service::ServiceOperation<EntityProcessOp>,
    gates: Arc<OperationUpdateGates>,
) {
    let operations_for_start = operations.clone();
    let operations_for_get = operations.clone();
    let operations_for_watch = operations.clone();
    let operations_for_cancel = operations.clone();

    service.register_operation_provider::<EntityProcessOp, _>(TestOperationProvider {
        start: Box::new({
            let gates = Arc::clone(&gates);
            move |_context: trellis_rs::service::RequestContext, input: EntityProcessInput| {
                let operations = operations_for_start.clone();
                let gates = Arc::clone(&gates);
                Box::pin(async move {
                    let operation_id = format!("op-{}", input.message);
                    let accepted = operations.accept(operation_id.clone()).await?;
                    let control = operations.control(operation_id).await?;
                    let running = control.started().await?;

                    tokio::spawn(async move {
                        gates.release_updates.notified().await;
                        control
                            .emit_update(EntityProcessUpdate {
                                message: input.message.clone(),
                                step: 1,
                            })
                            .await
                            .expect("emit first live operation update");
                        control
                            .emit_update(EntityProcessUpdate {
                                message: input.message,
                                step: 2,
                            })
                            .await
                            .expect("emit second live operation update");
                        gates.release_terminal.notified().await;
                        control
                            .complete(EntityProcessOutput {
                                message: "updates-complete".to_string(),
                                done: true,
                            })
                            .await
                            .expect("complete live-update operation");
                    });

                    Ok(AcceptedOperation {
                        snapshot: running,
                        ..accepted
                    })
                })
            }
        }),
        get: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations_for_get.clone();
                Box::pin(async move { operations.get(operation_id).await })
            },
        ),
        wait: Box::new({
            let operations = operations_for_watch.clone();
            move |_context, operation_id| {
                let operations = operations.clone();
                Box::pin(async move { operations.wait(operation_id).await })
            }
        }),
        watch: Box::new({
            let gates = Arc::clone(&gates);
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations_for_watch.clone();
                let gates = Arc::clone(&gates);
                Box::pin(
                    stream::once(async move {
                        let events = operations.live_events(operation_id).await?;
                        gates.watch_opened.notify_one();
                        Ok::<_, ServerError>(events)
                    })
                    .try_flatten(),
                )
            }
        }),
        cancel: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations_for_cancel.clone();
                Box::pin(async move { operations.cancel(operation_id).await })
            },
        ),
        signal: Box::new(
            move |_context: trellis_rs::service::RequestContext,
                  operation_id: String,
                  signal_name: String,
                  input: Option<Value>| {
                let operations = operations.clone();
                Box::pin(async move { operations.signal(operation_id, signal_name, input).await })
            },
        ),
    });
}

struct ControlOperationFixture {
    runtime: trellis_test::TrellisTestRuntime,
    service_key: trellis_test::TrellisTestServiceKey,
    service_task: AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>>,
    client: trellis_rs::generated::Caller,
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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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
            trellis_rs::generated::TrellisClientError,
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
async fn operations_live_updates_are_typed_ordered_and_transient() {
    assert_case_registered(
        "operations.live-updates-are-typed-ordered-and-transient",
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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");
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
    let gates = Arc::new(OperationUpdateGates::default());
    setup_update_operation_service(&mut service, operations, Arc::clone(&gates));
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust operations client");

    let operation_ref = start_operation_with_retry(&client, "typed-updates").await;
    let mut events = operation_ref
        .watch_with_updates()
        .await
        .expect("watch typed operation updates");
    tokio::time::timeout(Duration::from_secs(5), gates.watch_opened.notified())
        .await
        .expect("service opens update-aware watch");
    gates.release_updates.notify_one();

    let mut updates = Vec::new();
    while updates.len() < 2 {
        let event = tokio::time::timeout(Duration::from_secs(5), events.next())
            .await
            .expect("receive operation event before timeout")
            .expect("operation event stream item")
            .expect("valid operation event");
        match event {
            OperationEvent::Update { update } => updates.push(update),
            OperationEvent::Completed { .. }
            | OperationEvent::Failed { .. }
            | OperationEvent::Cancelled { .. } => {
                panic!("operation became terminal before both updates")
            }
            _ => {}
        }
    }
    assert_eq!(
        updates
            .iter()
            .map(|event| event.update.step)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(updates[0].update.message, "typed-updates");
    assert!(updates[0].sequence < updates[1].sequence);

    let running = operation_ref.get().await.expect("get running snapshot");
    assert_eq!(running.state, ClientOperationState::Running);
    assert!(running.progress.is_none());
    assert!(running.output.is_none());
    assert!(serde_json::to_value(&running)
        .expect("serialize running snapshot")
        .get("update")
        .is_none());

    gates.release_terminal.notify_one();
    let completed = loop {
        let event = tokio::time::timeout(Duration::from_secs(5), events.next())
            .await
            .expect("receive terminal event before timeout")
            .expect("terminal event stream item")
            .expect("valid terminal event");
        if let OperationEvent::Completed { snapshot } = event {
            break snapshot;
        }
    };
    let expected_output = EntityProcessOutput {
        message: "updates-complete".to_string(),
        done: true,
    };
    assert_eq!(completed.output, Some(expected_output.clone()));
    assert!(events.next().await.is_none());

    let terminal = operation_ref.get().await.expect("get terminal snapshot");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    assert_eq!(terminal.output, Some(expected_output));
    assert!(serde_json::to_value(&terminal)
        .expect("serialize terminal snapshot")
        .get("update")
        .is_none());

    let late_updates: Vec<_> = operation_ref
        .updates()
        .await
        .expect("open late update watch")
        .collect()
        .await;
    assert!(late_updates.is_empty());

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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
            trellis_rs::generated::TrellisClientError,
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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let cancelled = operation_ref.cancel().await.expect("cancel operation");
    assert_eq!(cancelled.state, ClientOperationState::Cancelled);

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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
    assert_runtime_case_registered(
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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        operations_client_contract(&service_contract).expect("build operations client contract");

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

    service.register_operation_provider::<EntityProcessOp, _>(TestOperationProvider {
        start: Box::new({
            let operations = operations.clone();
            let release_attached_task_rx = release_attached_task_rx.clone();
            move |_context: trellis_rs::service::RequestContext, input: EntityProcessInput| {
                let operations = operations.clone();
                let release_attached_task_rx = release_attached_task_rx.clone();
                Box::pin(async move {
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
                })
            }
        }),
        get: Box::new({
            let operations = operations.clone();
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations.clone();
                Box::pin(async move { operations.get(operation_id).await })
            }
        }),
        wait: Box::new({
            let operations = operations.clone();
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations.clone();
                Box::pin(async move { operations.wait(operation_id).await })
            }
        }),
        watch: Box::new({
            let operations = operations.clone();
            move |_context, operation_id| {
                let operations = operations.clone();
                Box::pin(stream::once(async move {
                    operations
                        .wait(operation_id)
                        .await
                        .map(trellis_rs::service::OperationLiveEvent::Snapshot)
                }))
            }
        }),
        cancel: Box::new(
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let operations = operations.clone();
                Box::pin(async move { operations.cancel(operation_id).await })
            },
        ),
        signal: Box::new(|_context, operation_id, _signal, _input| {
            Box::pin(async move {
                Err(ServerError::InvalidOperationControlAction {
                    subject: operation_id,
                    action: "signal".to_string(),
                })
            })
        }),
    });

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

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        OP_SERVICE_ID,
        OP_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build operations service test contract");
    assert_eq!(
        service_contract.digest(),
        OperationsServiceContract::CONTRACT_DIGEST
    );
    let client_contract = operations_unauthorized_client_contract(&service_contract)
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
    client: &'a trellis_rs::generated::Caller,
    message: &str,
) -> trellis_rs::generated::OperationRef<'a, trellis_rs::generated::Caller, EntityProcessOp> {
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
    client: &'a trellis_rs::generated::Caller,
    message: &str,
) -> trellis_rs::generated::OperationRef<'a, trellis_rs::generated::Caller, EntityStatusOp> {
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

fn is_retryable_service_startup_error(error: &trellis_rs::generated::TrellisClientError) -> bool {
    match error {
        trellis_rs::generated::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::generated::TrellisClientError::Timeout => true,
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
    service_contract: &trellis_test::TrellisTestContract,
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractBuilder::authoring(
        OP_CLIENT_ID,
        OP_CLIENT_ID,
        "1.0.0",
        "Trellis Integration Operations Client",
        "App/client participant for the operations integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "operationsService",
        trellis_rs::contracts::use_contract(OP_SERVICE_ID)
            .with_operation_call(["Entity.Process", "Entity.Status"])
            .with_operation_cancel(["Entity.Process"])
            .with_operation_control(["Entity.Process"]),
    );

    trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
        manifest,
        &[service_contract],
    )
}

fn operations_unauthorized_client_contract(
    service_contract: &trellis_test::TrellisTestContract,
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractBuilder::authoring(
        OP_UNAUTHORIZED_CLIENT_ID,
        OP_UNAUTHORIZED_CLIENT_ID,
        "1.0.0",
        "Trellis Integration Unauthorized Operations Client",
        "App/client without operation call authority for Entity.Process.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "operationsService",
        trellis_rs::contracts::use_contract(OP_SERVICE_ID).with_operation_call(["Entity.Status"]),
    );

    trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
        manifest,
        &[service_contract],
    )
}
