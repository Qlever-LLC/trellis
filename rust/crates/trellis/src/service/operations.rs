use std::collections::HashMap;
use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::sync::{watch, Mutex};

use super::{RequestContext, ServerError, UploadTransferGrant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OperationState {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl OperationState {
    /// Return whether this state ends an operation lifecycle.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            OperationState::Completed | OperationState::Failed | OperationState::Cancelled
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OperationRefData {
    pub id: String,
    pub service: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshot<TProgress = Value, TOutput = Value> {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    pub revision: u64,
    pub state: OperationState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<TProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer: Option<OperationTransferProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<TOutput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<OperationError>,
}

impl<TProgress, TOutput> Default for OperationSnapshot<TProgress, TOutput> {
    fn default() -> Self {
        Self {
            id: None,
            service: None,
            operation: None,
            revision: 0,
            state: OperationState::Pending,
            created_at: None,
            updated_at: None,
            completed_at: None,
            progress: None,
            transfer: None,
            output: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationError {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

/// A typed operation failure payload that can be serialized into the operation snapshot.
pub trait OperationFailureLike: Send + 'static {
    /// The wire error type discriminator (e.g. "NotFoundError").
    fn error_type(&self) -> &str;
    /// Human-facing error message.
    fn message(&self) -> String;
    /// Additional structured fields for the error payload.
    fn fields(&self) -> serde_json::Map<String, Value>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationFailure {
    pub message: String,
}

impl OperationFailureLike for OperationFailure {
    fn error_type(&self) -> &str {
        "OperationFailure"
    }
    fn message(&self) -> String {
        self.message.clone()
    }
    fn fields(&self) -> serde_json::Map<String, Value> {
        serde_json::Map::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationTransferProgress {
    /// Zero-based transfer chunk index.
    pub chunk_index: u64,
    /// Number of bytes carried by this chunk.
    pub chunk_bytes: u64,
    /// Total number of bytes transferred after this chunk.
    pub transferred_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedOperation<TProgress = Value, TOutput = Value> {
    pub kind: String,
    #[serde(rename = "ref")]
    pub operation_ref: OperationRefData,
    pub snapshot: OperationSnapshot<TProgress, TOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer: Option<UploadTransferGrant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshotFrame<TProgress = Value, TOutput = Value> {
    pub kind: String,
    pub snapshot: OperationSnapshot<TProgress, TOutput>,
}

/// Signal accepted for delivery to an operation provider.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationSignal {
    pub operation_id: String,
    pub signal: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    pub signal_sequence: u64,
    pub accepted_at: String,
}

/// Acknowledgement frame returned to callers after a signal is accepted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationSignalAccepted<TProgress = Value, TOutput = Value> {
    pub kind: String,
    pub operation_id: String,
    pub signal: String,
    pub signal_sequence: u64,
    pub accepted_at: String,
    pub snapshot: OperationSnapshot<TProgress, TOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationControlRequest {
    pub action: String,
    pub operation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
}

pub trait OperationDescriptor {
    type Input: DeserializeOwned + Send + 'static;
    type Progress: Serialize + Send + 'static;
    type Output: Serialize + Send + 'static;
    type Error: OperationFailureLike + Send + 'static;

    const KEY: &'static str;
    const SUBJECT: &'static str;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = Self::CALLER_CAPABILITIES;
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool;
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str;
    const PROGRESS_SCHEMA_JSON: Option<&'static str>;
    const OUTPUT_SCHEMA_JSON: &'static str;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str;
}

impl<D> OperationDescriptor for D
where
    D: crate::client::OperationDescriptor,
    D::Input: DeserializeOwned + Send + 'static,
    D::Progress: Serialize + Send + 'static,
    D::Output: Serialize + Send + 'static,
    D::Error: OperationFailureLike,
{
    type Input = D::Input;
    type Progress = D::Progress;
    type Output = D::Output;
    type Error = D::Error;

    const KEY: &'static str = D::KEY;
    const SUBJECT: &'static str = D::SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = D::CALLER_CAPABILITIES;
    const OBSERVE_CAPABILITIES: &'static [&'static str] = D::OBSERVE_CAPABILITIES;
    const CANCEL_CAPABILITIES: &'static [&'static str] = D::CANCEL_CAPABILITIES;
    const CONTROL_CAPABILITIES: &'static [&'static str] = D::CONTROL_CAPABILITIES;
    const CANCELABLE: bool = D::CANCELABLE;
    const ERRORS: &'static [&'static str] = D::ERRORS;
    const INPUT_SCHEMA_JSON: &'static str = D::INPUT_SCHEMA_JSON;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> = D::PROGRESS_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = D::OUTPUT_SCHEMA_JSON;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = D::SIGNAL_INPUT_SCHEMAS_JSON;
}

/// Provider-style operation handler for generated service helpers.
pub trait OperationProvider<D>: Send + Sync + 'static
where
    D: OperationDescriptor,
{
    /// Start a new operation instance from the decoded input.
    fn start(
        &self,
        context: RequestContext,
        input: D::Input,
    ) -> BoxFuture<'static, Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>;

    /// Return the current snapshot for an operation id.
    fn get(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;

    /// Wait for a later or terminal snapshot for an operation id.
    fn wait(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;

    /// Cancel an operation id and return the resulting snapshot.
    fn cancel(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;
}

pub fn control_subject(subject: &str) -> String {
    format!("{subject}.control")
}

#[derive(Debug, Clone)]
struct StoredOperation {
    service: String,
    operation: String,
    snapshot: OperationSnapshot<Value, Value>,
    updates: watch::Sender<OperationSnapshot<Value, Value>>,
    signals: Vec<OperationSignal>,
    signal_updates: watch::Sender<u64>,
}

#[derive(Debug)]
struct OperationSignalStreamState {
    inner: Arc<OperationRuntimeInner>,
    operation_ref: OperationRefData,
    next_index: usize,
    receiver: watch::Receiver<u64>,
}

#[derive(Debug, Default)]
struct OperationRuntimeInner {
    operations: Mutex<HashMap<String, StoredOperation>>,
}

/// In-memory service-owned operation runtime for durable-style operation control.
///
/// This runtime persists operation snapshots for the lifetime of the service process and exposes
/// operation-scoped typed control handles by operation id. Concrete persistence remains host-backed;
/// services that need restart durability should replace this in-memory store with a host storage
/// implementation that preserves the same lifecycle semantics.
#[derive(Debug, Clone)]
pub struct InMemoryOperationRuntime {
    service: String,
    inner: Arc<OperationRuntimeInner>,
}

impl InMemoryOperationRuntime {
    /// Create an in-memory operation runtime for one owning service name.
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            inner: Arc::new(OperationRuntimeInner::default()),
        }
    }

    /// Return a typed runtime handle for one operation descriptor.
    pub fn operation<D>(&self) -> ServiceOperation<D>
    where
        D: OperationDescriptor,
    {
        ServiceOperation {
            service: self.service.clone(),
            inner: Arc::clone(&self.inner),
            _descriptor: PhantomData,
        }
    }
}

/// Typed service-owned operation runtime handle for one operation descriptor.
#[derive(Debug)]
pub struct ServiceOperation<D>
where
    D: OperationDescriptor,
{
    service: String,
    inner: Arc<OperationRuntimeInner>,
    _descriptor: PhantomData<D>,
}

impl<D> Clone for ServiceOperation<D>
where
    D: OperationDescriptor,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            inner: Arc::clone(&self.inner),
            _descriptor: PhantomData,
        }
    }
}

impl<D> ServiceOperation<D>
where
    D: OperationDescriptor,
    D::Progress: Serialize + DeserializeOwned + Send + 'static,
    D::Output: Serialize + DeserializeOwned + Send + 'static,
{
    /// Accept an operation id and create its initial pending snapshot.
    pub async fn accept(
        &self,
        operation_id: impl Into<String>,
    ) -> Result<AcceptedOperation<D::Progress, D::Output>, ServerError> {
        let operation_id = operation_id.into();
        if operation_id.trim().is_empty() {
            return Err(ServerError::OperationInvalidId { operation_id });
        }
        let now = now_timestamp();
        let snapshot = OperationSnapshot::<Value, Value> {
            id: Some(operation_id.clone()),
            service: Some(self.service.clone()),
            operation: Some(D::KEY.to_string()),
            revision: 1,
            state: OperationState::Pending,
            created_at: Some(now.clone()),
            updated_at: Some(now),
            completed_at: None,
            progress: None,
            transfer: None,
            output: None,
            error: None,
        };
        let (updates, _receiver) = watch::channel(snapshot.clone());
        let (signal_updates, _receiver) = watch::channel(0);
        let mut operations = self.inner.operations.lock().await;
        if operations.contains_key(&operation_id) {
            return Err(ServerError::OperationAlreadyExists { operation_id });
        }
        operations.insert(
            operation_id.clone(),
            StoredOperation {
                service: self.service.clone(),
                operation: D::KEY.to_string(),
                snapshot: snapshot.clone(),
                updates,
                signals: Vec::new(),
                signal_updates,
            },
        );

        Ok(AcceptedOperation {
            kind: "accepted".to_string(),
            operation_ref: OperationRefData {
                id: operation_id,
                service: self.service.clone(),
                operation: D::KEY.to_string(),
            },
            snapshot: typed_snapshot(snapshot)?,
            transfer: None,
        })
    }

    /// Return a control handle for an operation id.
    pub async fn control(
        &self,
        operation_id: impl Into<String>,
    ) -> Result<OperationControl<D>, ServerError> {
        let operation_id = operation_id.into();
        self.get(operation_id.clone()).await?;
        Ok(OperationControl {
            operation: self.clone(),
            operation_ref: OperationRefData {
                id: operation_id,
                service: self.service.clone(),
                operation: D::KEY.to_string(),
            },
        })
    }

    /// Return a control handle for an operation reference and validate service/name on update.
    pub async fn control_ref(
        &self,
        operation_ref: OperationRefData,
    ) -> Result<OperationControl<D>, ServerError> {
        let operations = self.inner.operations.lock().await;
        let stored =
            operations
                .get(&operation_ref.id)
                .ok_or_else(|| ServerError::OperationNotFound {
                    operation_id: operation_ref.id.clone(),
                })?;
        if stored.service != operation_ref.service || stored.operation != operation_ref.operation {
            return Err(ServerError::OperationMismatch {
                operation_id: operation_ref.id.clone(),
                expected_service: operation_ref.service.clone(),
                expected_operation: operation_ref.operation.clone(),
                actual_service: stored.service.clone(),
                actual_operation: stored.operation.clone(),
            });
        }
        self.validate_stored(&operation_ref.id, stored)?;
        Ok(OperationControl {
            operation: self.clone(),
            operation_ref,
        })
    }

    /// Return the current durable-style snapshot for an operation id.
    pub async fn get(
        &self,
        operation_id: impl Into<String>,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError> {
        let operation_id = operation_id.into();
        let operations = self.inner.operations.lock().await;
        let stored =
            operations
                .get(&operation_id)
                .ok_or_else(|| ServerError::OperationNotFound {
                    operation_id: operation_id.clone(),
                })?;
        self.validate_stored(&operation_id, stored)?;
        typed_snapshot(stored.snapshot.clone())
    }

    /// Restore a previously persisted snapshot into this runtime.
    ///
    /// This is intended for host-backed operation stores that reload durable records after a
    /// service reconnect. The restored record is available to `get`, `wait`, and follow-up control
    /// calls, but active signal waiters are not restored.
    pub async fn restore_snapshot(
        &self,
        snapshot: OperationSnapshot<Value, Value>,
    ) -> Result<(), ServerError> {
        let operation_id = snapshot
            .id
            .as_ref()
            .filter(|id| !id.trim().is_empty())
            .cloned()
            .ok_or_else(|| ServerError::OperationInvalidId {
                operation_id: String::new(),
            })?;
        let service = snapshot
            .service
            .as_ref()
            .ok_or_else(|| ServerError::OperationMismatch {
                operation_id: operation_id.clone(),
                expected_service: self.service.clone(),
                expected_operation: D::KEY.to_string(),
                actual_service: String::new(),
                actual_operation: snapshot.operation.clone().unwrap_or_default(),
            })?;
        let operation =
            snapshot
                .operation
                .as_ref()
                .ok_or_else(|| ServerError::OperationMismatch {
                    operation_id: operation_id.clone(),
                    expected_service: self.service.clone(),
                    expected_operation: D::KEY.to_string(),
                    actual_service: service.clone(),
                    actual_operation: String::new(),
                })?;
        if service != &self.service || operation != D::KEY {
            return Err(ServerError::OperationMismatch {
                operation_id: operation_id.clone(),
                expected_service: self.service.clone(),
                expected_operation: D::KEY.to_string(),
                actual_service: service.clone(),
                actual_operation: operation.clone(),
            });
        }

        let (updates, _receiver) = watch::channel(snapshot.clone());
        let (signal_updates, _receiver) = watch::channel(0);
        let mut operations = self.inner.operations.lock().await;
        operations.insert(
            operation_id,
            StoredOperation {
                service: service.clone(),
                operation: operation.clone(),
                snapshot,
                updates,
                signals: Vec::new(),
                signal_updates,
            },
        );
        Ok(())
    }

    /// Wait for the current or next terminal snapshot for an operation id.
    pub async fn wait(
        &self,
        operation_id: impl Into<String>,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError> {
        let operation_id = operation_id.into();
        let mut receiver = {
            let operations = self.inner.operations.lock().await;
            let stored =
                operations
                    .get(&operation_id)
                    .ok_or_else(|| ServerError::OperationNotFound {
                        operation_id: operation_id.clone(),
                    })?;
            self.validate_stored(&operation_id, stored)?;
            if stored.snapshot.state.is_terminal() {
                return typed_snapshot(stored.snapshot.clone());
            }
            stored.updates.subscribe()
        };

        loop {
            receiver.changed().await.map_err(|_| {
                ServerError::Nats(format!("operation '{operation_id}' update stream closed"))
            })?;
            let snapshot = receiver.borrow().clone();
            if snapshot.state.is_terminal() {
                return typed_snapshot(snapshot);
            }
        }
    }

    /// Watch operation snapshots from the current snapshot through future updates.
    pub async fn watch(
        &self,
        operation_id: impl Into<String>,
    ) -> Result<
        BoxStream<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>,
        ServerError,
    > {
        let operation_id = operation_id.into();
        let (initial, receiver) = {
            let operations = self.inner.operations.lock().await;
            let stored =
                operations
                    .get(&operation_id)
                    .ok_or_else(|| ServerError::OperationNotFound {
                        operation_id: operation_id.clone(),
                    })?;
            self.validate_stored(&operation_id, stored)?;
            (stored.snapshot.clone(), stored.updates.subscribe())
        };
        let initial = typed_snapshot(initial)?;
        if initial.state.is_terminal() {
            let snapshots: BoxStream<
                'static,
                Result<OperationSnapshot<D::Progress, D::Output>, ServerError>,
            > = Box::pin(stream::once(async move { Ok(initial) }));
            return Ok(snapshots);
        }
        let updates = stream::unfold((receiver, false), |(mut receiver, done)| async move {
            if done {
                return None;
            }
            if receiver.changed().await.is_err() {
                return None;
            }
            let snapshot = receiver.borrow().clone();
            let done = snapshot.state.is_terminal();
            Some((typed_snapshot(snapshot), (receiver, done)))
        });
        let snapshots: BoxStream<
            'static,
            Result<OperationSnapshot<D::Progress, D::Output>, ServerError>,
        > = Box::pin(stream::once(async move { Ok(initial) }).chain(updates));
        Ok(snapshots)
    }

    /// Cancel an operation id and return its resulting snapshot.
    pub async fn cancel(
        &self,
        operation_id: impl Into<String>,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError> {
        self.control(operation_id).await?.cancel().await
    }

    /// Accept a caller signal for an operation id and return its acknowledgement frame.
    pub async fn signal(
        &self,
        operation_id: impl Into<String>,
        signal: impl Into<String>,
        input: Option<Value>,
    ) -> Result<OperationSignalAccepted<D::Progress, D::Output>, ServerError> {
        let operation_id = operation_id.into();
        let signal = signal.into();
        if signal.trim().is_empty() {
            return Err(ServerError::OperationUnsupportedControl {
                operation: D::KEY.to_string(),
                action: "signal".to_string(),
            });
        }

        let mut operations = self.inner.operations.lock().await;
        let stored =
            operations
                .get_mut(&operation_id)
                .ok_or_else(|| ServerError::OperationNotFound {
                    operation_id: operation_id.clone(),
                })?;
        self.validate_stored(&operation_id, stored)?;
        if stored.snapshot.state.is_terminal() {
            return Err(ServerError::OperationTerminal {
                operation_id,
                state: operation_state_name(&stored.snapshot.state).to_string(),
            });
        }

        let signal_sequence = stored.signals.len() as u64 + 1;
        let accepted_at = now_timestamp();
        let signal_event = OperationSignal {
            operation_id: operation_id.clone(),
            signal: signal.clone(),
            input,
            signal_sequence,
            accepted_at: accepted_at.clone(),
        };
        stored.signals.push(signal_event);
        let _ = stored.signal_updates.send(signal_sequence);

        Ok(OperationSignalAccepted {
            kind: "signal-accepted".to_string(),
            operation_id,
            signal,
            signal_sequence,
            accepted_at,
            snapshot: typed_snapshot(stored.snapshot.clone())?,
        })
    }

    fn validate_stored(
        &self,
        operation_id: &str,
        stored: &StoredOperation,
    ) -> Result<(), ServerError> {
        if stored.service != self.service || stored.operation != D::KEY {
            return Err(ServerError::OperationMismatch {
                operation_id: operation_id.to_string(),
                expected_service: self.service.clone(),
                expected_operation: D::KEY.to_string(),
                actual_service: stored.service.clone(),
                actual_operation: stored.operation.clone(),
            });
        }
        Ok(())
    }
}

/// Typed service-owned operation lifecycle control handle.
#[derive(Debug)]
pub struct OperationControl<D>
where
    D: OperationDescriptor,
{
    operation: ServiceOperation<D>,
    operation_ref: OperationRefData,
}

impl<D> OperationControl<D>
where
    D: OperationDescriptor,
    D::Progress: Serialize + DeserializeOwned + Send + 'static,
    D::Output: Serialize + DeserializeOwned + Send + 'static,
{
    /// Mark the operation as started/running.
    pub async fn started(&self) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError> {
        self.update(OperationState::Running, None, None, None).await
    }

    /// Publish typed operation progress and mark the operation as running.
    pub async fn progress(
        &self,
        progress: D::Progress,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError> {
        self.update(
            OperationState::Running,
            Some(serde_json::to_value(progress)?),
            None,
            None,
        )
        .await
    }

    /// Complete the operation with typed output.
    pub async fn complete(
        &self,
        output: D::Output,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError> {
        self.update(
            OperationState::Completed,
            None,
            Some(serde_json::to_value(output)?),
            None,
        )
        .await
    }

    /// Fail the operation with a typed failure payload.
    pub async fn fail(
        &self,
        error: D::Error,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError>
    where
        D::Error: OperationFailureLike,
    {
        self.update(
            OperationState::Failed,
            None,
            None,
            Some(OperationError {
                error_type: error.error_type().to_string(),
                message: error.message(),
            }),
        )
        .await
    }

    /// Attach operation completion to a service-owned async task.
    ///
    /// The attached task is expected to drive operation lifecycle updates through
    /// this control handle or another service-owned control path. After the task
    /// returns, the operation must have a terminal snapshot.
    pub async fn attach<Fut, E>(
        &self,
        task: Fut,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError>
    where
        Fut: Future<Output = Result<(), E>>,
        E: std::fmt::Display,
    {
        task.await.map_err(|error| {
            ServerError::Nats(format!("attached operation task failed: {error}"))
        })?;
        let snapshot = self.operation.get(self.operation_ref.id.clone()).await?;
        if snapshot.state.is_terminal() {
            Ok(snapshot)
        } else {
            Err(ServerError::Nats(
                "attached operation task completed without terminal operation state".to_string(),
            ))
        }
    }

    /// Cancel the operation.
    pub async fn cancel(&self) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError> {
        if !D::CANCELABLE {
            return Err(ServerError::OperationUnsupportedControl {
                operation: D::KEY.to_string(),
                action: "cancel".to_string(),
            });
        }
        self.update(OperationState::Cancelled, None, None, None)
            .await
    }

    /// Iterate accepted signals for this operation from this subscription onward.
    pub async fn signals(
        &self,
    ) -> Result<BoxStream<'static, Result<OperationSignal, ServerError>>, ServerError> {
        let receiver = {
            let operations = self.operation.inner.operations.lock().await;
            let stored = operations.get(&self.operation_ref.id).ok_or_else(|| {
                ServerError::OperationNotFound {
                    operation_id: self.operation_ref.id.clone(),
                }
            })?;
            self.operation
                .validate_stored(&self.operation_ref.id, stored)?;
            stored.signal_updates.subscribe()
        };
        let state = OperationSignalStreamState {
            inner: Arc::clone(&self.operation.inner),
            operation_ref: self.operation_ref.clone(),
            next_index: 0,
            receiver,
        };

        Ok(Box::pin(stream::unfold(state, |mut state| async move {
            loop {
                {
                    let inner = Arc::clone(&state.inner);
                    let operations = inner.operations.lock().await;
                    let stored = match operations.get(&state.operation_ref.id) {
                        Some(stored) => stored,
                        None => {
                            return Some((
                                Err(ServerError::OperationNotFound {
                                    operation_id: state.operation_ref.id.clone(),
                                }),
                                state,
                            ));
                        }
                    };
                    if stored.service != state.operation_ref.service
                        || stored.operation != state.operation_ref.operation
                    {
                        return Some((
                            Err(ServerError::OperationMismatch {
                                operation_id: state.operation_ref.id.clone(),
                                expected_service: state.operation_ref.service.clone(),
                                expected_operation: state.operation_ref.operation.clone(),
                                actual_service: stored.service.clone(),
                                actual_operation: stored.operation.clone(),
                            }),
                            state,
                        ));
                    }
                    if let Some(signal) = stored.signals.get(state.next_index).cloned() {
                        state.next_index += 1;
                        return Some((Ok(signal), state));
                    }
                }

                if state.receiver.changed().await.is_err() {
                    return None;
                }
            }
        })))
    }

    async fn update(
        &self,
        state: OperationState,
        progress: Option<Value>,
        output: Option<Value>,
        error: Option<OperationError>,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, ServerError> {
        let mut operations = self.operation.inner.operations.lock().await;
        let stored = operations.get_mut(&self.operation_ref.id).ok_or_else(|| {
            ServerError::OperationNotFound {
                operation_id: self.operation_ref.id.clone(),
            }
        })?;

        if stored.service != self.operation_ref.service
            || stored.operation != self.operation_ref.operation
        {
            return Err(ServerError::OperationMismatch {
                operation_id: self.operation_ref.id.clone(),
                expected_service: self.operation_ref.service.clone(),
                expected_operation: self.operation_ref.operation.clone(),
                actual_service: stored.service.clone(),
                actual_operation: stored.operation.clone(),
            });
        }
        self.operation
            .validate_stored(&self.operation_ref.id, stored)?;
        if stored.snapshot.state.is_terminal() {
            return Err(ServerError::OperationTerminal {
                operation_id: self.operation_ref.id.clone(),
                state: operation_state_name(&stored.snapshot.state).to_string(),
            });
        }

        stored.snapshot.revision += 1;
        let now = now_timestamp();
        stored.snapshot.state = state;
        stored.snapshot.updated_at = Some(now.clone());
        if stored.snapshot.state.is_terminal() {
            stored.snapshot.completed_at = Some(now);
        }
        if progress.is_some() {
            stored.snapshot.progress = progress;
        }
        if output.is_some() {
            stored.snapshot.output = output;
        }
        if error.is_some() {
            stored.snapshot.error = error;
        }
        let snapshot = stored.snapshot.clone();
        let _ = stored.updates.send(snapshot.clone());
        typed_snapshot(snapshot)
    }
}

fn typed_snapshot<TProgress, TOutput>(
    snapshot: OperationSnapshot<Value, Value>,
) -> Result<OperationSnapshot<TProgress, TOutput>, ServerError>
where
    TProgress: DeserializeOwned,
    TOutput: DeserializeOwned,
{
    Ok(OperationSnapshot {
        id: snapshot.id,
        service: snapshot.service,
        operation: snapshot.operation,
        revision: snapshot.revision,
        state: snapshot.state,
        created_at: snapshot.created_at,
        updated_at: snapshot.updated_at,
        completed_at: snapshot.completed_at,
        progress: snapshot.progress.map(serde_json::from_value).transpose()?,
        transfer: snapshot.transfer,
        output: snapshot.output.map(serde_json::from_value).transpose()?,
        error: snapshot.error,
    })
}

fn now_timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn operation_state_name(state: &OperationState) -> &'static str {
    match state {
        OperationState::Pending => "pending",
        OperationState::Running => "running",
        OperationState::Completed => "completed",
        OperationState::Failed => "failed",
        OperationState::Cancelled => "cancelled",
    }
}
