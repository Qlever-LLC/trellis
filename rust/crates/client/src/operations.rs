use std::future::Future;
use std::marker::PhantomData;

use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::transfer::{FileInfo, UploadTransferGrant};
use crate::TrellisClientError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OperationState {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
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
    pub revision: u64,
    pub state: OperationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<TProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer: Option<OperationTransferProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<TOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationTransferProgress {
    pub chunk_index: u64,
    pub chunk_bytes: u64,
    pub transferred_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AcceptedEnvelope<TProgress = Value, TOutput = Value> {
    kind: String,
    #[serde(rename = "ref")]
    operation_ref: OperationRefData,
    snapshot: OperationSnapshot<TProgress, TOutput>,
    transfer: Option<UploadTransferGrant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SnapshotFrame<TProgress = Value, TOutput = Value> {
    kind: String,
    snapshot: OperationSnapshot<TProgress, TOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum OperationEvent<TProgress = Value, TOutput = Value> {
    Accepted {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Started {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Progress {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Transfer {
        snapshot: OperationSnapshot<TProgress, TOutput>,
        transfer: OperationTransferProgress,
    },
    Completed {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Failed {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
    Cancelled {
        snapshot: OperationSnapshot<TProgress, TOutput>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct EventFrame<TProgress = Value, TOutput = Value> {
    kind: String,
    event: OperationEvent<TProgress, TOutput>,
}

pub trait OperationDescriptor {
    type Input: Serialize;
    type Progress: DeserializeOwned + Send + 'static;
    type Output: DeserializeOwned + Send + 'static;

    const KEY: &'static str;
    const SUBJECT: &'static str;
    const CALLER_CAPABILITIES: &'static [&'static str];
    const READ_CAPABILITIES: &'static [&'static str];
    const CANCEL_CAPABILITIES: &'static [&'static str];
    const CANCELABLE: bool;
}

/// Marker trait for operations that declare an upload transfer.
pub trait TransferOperationDescriptor: OperationDescriptor {}

#[doc(hidden)]
pub trait OperationTransport {
    fn request_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> impl Future<Output = Result<Value, TrellisClientError>> + Send + 'a;

    fn watch_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> impl Future<
        Output = Result<BoxStream<'a, Result<Value, TrellisClientError>>, TrellisClientError>,
    > + Send
           + 'a;

    fn put_upload_transfer<'a>(
        &'a self,
        grant: UploadTransferGrant,
        body: Vec<u8>,
    ) -> impl Future<Output = Result<FileInfo, TrellisClientError>> + Send + 'a;
}

#[derive(Debug)]
pub struct OperationInvoker<'a, T, D> {
    transport: &'a T,
    _descriptor: PhantomData<D>,
}

/// Builder for operation calls with a captured input payload.
#[derive(Debug)]
pub struct OperationInputBuilder<'a, 'b, T, D: OperationDescriptor> {
    invoker: &'b OperationInvoker<'a, T, D>,
    input: &'b D::Input,
}

/// Builder for operation calls that upload bytes after the operation is accepted.
#[derive(Debug)]
pub struct OperationTransferInputBuilder<'a, 'b, T, D: OperationDescriptor> {
    invoker: &'b OperationInvoker<'a, T, D>,
    input: &'b D::Input,
    body: Vec<u8>,
}

/// Successful result for starting an operation and uploading its transfer body.
pub struct StartedOperationTransfer<'a, T, D> {
    operation_ref: OperationRef<'a, T, D>,
    file_info: FileInfo,
}

/// Error returned when starting or uploading an operation transfer fails.
pub enum OperationTransferStartError<'a, T, D> {
    Start(TrellisClientError),
    Upload {
        operation_ref: OperationRef<'a, T, D>,
        source: TrellisClientError,
    },
}

impl<'a, T, D> std::fmt::Debug for StartedOperationTransfer<'a, T, D> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StartedOperationTransfer")
            .field("operation_ref", &self.operation_ref)
            .field("file_info", &self.file_info)
            .finish()
    }
}

impl<'a, T, D> std::fmt::Debug for OperationTransferStartError<'a, T, D> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Start(source) => f.debug_tuple("Start").field(source).finish(),
            Self::Upload {
                operation_ref,
                source,
            } => f
                .debug_struct("Upload")
                .field("operation_ref", operation_ref)
                .field("source", source)
                .finish(),
        }
    }
}

pub struct OperationRef<'a, T, D> {
    transport: &'a T,
    data: OperationRefData,
    accepted_transfer: Option<UploadTransferGrant>,
    _descriptor: PhantomData<D>,
}

impl<'a, T, D> std::fmt::Debug for OperationRef<'a, T, D> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OperationRef")
            .field("data", &self.data)
            .field("accepted_transfer", &self.accepted_transfer)
            .finish_non_exhaustive()
    }
}

fn is_terminal_state(state: &OperationState) -> bool {
    matches!(
        state,
        OperationState::Completed | OperationState::Failed | OperationState::Cancelled
    )
}

impl<'a, T, D> OperationInvoker<'a, T, D> {
    pub fn new(transport: &'a T) -> Self {
        Self {
            transport,
            _descriptor: PhantomData,
        }
    }

    /// Captures an operation input for ergonomic chained calls.
    pub fn input<'b>(&'b self, input: &'b D::Input) -> OperationInputBuilder<'a, 'b, T, D>
    where
        D: OperationDescriptor,
    {
        OperationInputBuilder {
            invoker: self,
            input,
        }
    }
}

impl<'a, T, D> OperationInvoker<'a, T, D>
where
    T: OperationTransport,
    D: OperationDescriptor,
    D::Progress: Send,
    D::Output: Send,
{
    pub async fn start(
        &self,
        input: &D::Input,
    ) -> Result<OperationRef<'a, T, D>, TrellisClientError> {
        let body = serde_json::to_value(input)?;
        let response = self
            .transport
            .request_json_value(D::SUBJECT.to_string(), body)
            .await?;
        let accepted: AcceptedEnvelope<D::Progress, D::Output> = serde_json::from_value(response)?;
        if accepted.kind != "accepted" {
            return Err(TrellisClientError::OperationProtocol(format!(
                "expected accepted envelope, got '{}'",
                accepted.kind
            )));
        }
        Ok(OperationRef {
            transport: self.transport,
            data: accepted.operation_ref,
            accepted_transfer: accepted.transfer,
            _descriptor: PhantomData,
        })
    }
}

impl<'a, 'b, T, D> OperationInputBuilder<'a, 'b, T, D>
where
    T: OperationTransport,
    D: OperationDescriptor,
    D::Progress: Send,
    D::Output: Send,
{
    /// Starts the operation with the captured input.
    pub async fn start(self) -> Result<OperationRef<'a, T, D>, TrellisClientError> {
        self.invoker.start(self.input).await
    }

    /// Captures upload bytes to send after the operation is accepted.
    pub fn transfer(self, body: impl AsRef<[u8]>) -> OperationTransferInputBuilder<'a, 'b, T, D>
    where
        D: TransferOperationDescriptor,
    {
        OperationTransferInputBuilder {
            invoker: self.invoker,
            input: self.input,
            body: body.as_ref().to_vec(),
        }
    }
}

impl<'a, 'b, T, D> OperationTransferInputBuilder<'a, 'b, T, D>
where
    T: OperationTransport,
    D: TransferOperationDescriptor,
    D::Progress: Send,
    D::Output: Send,
{
    /// Starts the operation, uploads the captured bytes, and returns the operation and file info.
    pub async fn start(
        self,
    ) -> Result<StartedOperationTransfer<'a, T, D>, OperationTransferStartError<'a, T, D>> {
        let operation_ref = self
            .invoker
            .start(self.input)
            .await
            .map_err(OperationTransferStartError::Start)?;
        let file_info = match operation_ref.transfer_vec(self.body).await {
            Ok(file_info) => file_info,
            Err(source) => {
                return Err(OperationTransferStartError::Upload {
                    operation_ref,
                    source,
                })
            }
        };
        Ok(StartedOperationTransfer {
            operation_ref,
            file_info,
        })
    }
}

impl<'a, T, D> StartedOperationTransfer<'a, T, D> {
    /// Return the accepted operation reference.
    pub fn operation_ref(&self) -> &OperationRef<'a, T, D> {
        &self.operation_ref
    }

    /// Return information about the uploaded transfer body.
    pub fn file_info(&self) -> &FileInfo {
        &self.file_info
    }

    /// Consume the result and return the accepted operation reference.
    pub fn into_operation_ref(self) -> OperationRef<'a, T, D> {
        self.operation_ref
    }
}

impl<'a, T, D> OperationTransferStartError<'a, T, D> {
    /// Return the accepted operation reference when the operation was accepted before upload failed.
    pub fn operation_ref(&self) -> Option<&OperationRef<'a, T, D>> {
        match self {
            Self::Start(_) => None,
            Self::Upload { operation_ref, .. } => Some(operation_ref),
        }
    }

    /// Return the underlying client error.
    pub fn source(&self) -> &TrellisClientError {
        match self {
            Self::Start(source) | Self::Upload { source, .. } => source,
        }
    }
}

impl<'a, T, D> OperationRef<'a, T, D> {
    pub fn id(&self) -> &str {
        &self.data.id
    }

    pub fn service(&self) -> &str {
        &self.data.service
    }

    pub fn operation(&self) -> &str {
        &self.data.operation
    }
}

impl<'a, T, D> OperationRef<'a, T, D>
where
    T: OperationTransport,
    D: OperationDescriptor,
{
    pub async fn get(
        &self,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, TrellisClientError> {
        let body = json!({
            "action": "get",
            "operationId": self.id(),
        });
        let response = self
            .transport
            .request_json_value(control_subject(D::SUBJECT), body)
            .await?;
        let frame: SnapshotFrame<D::Progress, D::Output> = serde_json::from_value(response)?;
        if frame.kind != "snapshot" {
            return Err(TrellisClientError::OperationProtocol(format!(
                "expected snapshot frame, got '{}'",
                frame.kind
            )));
        }
        Ok(frame.snapshot)
    }

    pub async fn wait(
        &self,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, TrellisClientError> {
        let body = json!({
            "action": "wait",
            "operationId": self.id(),
        });
        let response = self
            .transport
            .request_json_value(control_subject(D::SUBJECT), body)
            .await?;
        let frame: SnapshotFrame<D::Progress, D::Output> = serde_json::from_value(response)?;
        if frame.kind != "snapshot" {
            return Err(TrellisClientError::OperationProtocol(format!(
                "expected snapshot frame, got '{}'",
                frame.kind
            )));
        }
        if !is_terminal_state(&frame.snapshot.state) {
            return Err(TrellisClientError::OperationProtocol(
                "wait returned non-terminal snapshot".to_string(),
            ));
        }
        Ok(frame.snapshot)
    }

    pub async fn cancel(
        &self,
    ) -> Result<OperationSnapshot<D::Progress, D::Output>, TrellisClientError> {
        let body = json!({
            "action": "cancel",
            "operationId": self.id(),
        });
        let response = self
            .transport
            .request_json_value(control_subject(D::SUBJECT), body)
            .await?;
        let frame: SnapshotFrame<D::Progress, D::Output> = serde_json::from_value(response)?;
        if frame.kind != "snapshot" {
            return Err(TrellisClientError::OperationProtocol(format!(
                "expected snapshot frame, got '{}'",
                frame.kind
            )));
        }
        Ok(frame.snapshot)
    }

    pub async fn watch(
        &self,
    ) -> Result<
        BoxStream<'a, Result<OperationEvent<D::Progress, D::Output>, TrellisClientError>>,
        TrellisClientError,
    > {
        let control = control_subject(D::SUBJECT);
        let body = json!({
            "action": "watch",
            "operationId": self.id(),
        });
        let response = self.transport.watch_json_value(control, body).await?;
        Ok(Box::pin(stream::try_unfold(
            (response, false),
            |(mut response, done)| async move {
                if done {
                    return Ok(None);
                }

                loop {
                    match response.next().await {
                        Some(frame) => {
                            let event = match frame {
                                Ok(value) => {
                                    match decode_watch_frame::<D::Progress, D::Output>(value) {
                                        Ok(Some(event)) => event,
                                        Ok(None) => continue,
                                        Err(error) => return Err(error),
                                    }
                                }
                                Err(error) => return Err(error),
                            };

                            let terminal = is_terminal_event(&event);
                            return Ok(Some((event, (response, terminal))));
                        }
                        None => return Ok(None),
                    }
                }
            },
        )))
    }

    pub async fn transfer(&self, body: impl AsRef<[u8]>) -> Result<FileInfo, TrellisClientError> {
        self.transfer_vec(body.as_ref().to_vec()).await
    }

    async fn transfer_vec(&self, body: Vec<u8>) -> Result<FileInfo, TrellisClientError> {
        let grant = self.accepted_transfer.clone().ok_or_else(|| {
            TrellisClientError::OperationProtocol(
                "operation does not have an accepted transfer session".into(),
            )
        })?;
        self.transport.put_upload_transfer(grant, body).await
    }
}

fn decode_watch_frame<TProgress: DeserializeOwned, TOutput: DeserializeOwned>(
    value: Value,
) -> Result<Option<OperationEvent<TProgress, TOutput>>, TrellisClientError> {
    if value.get("kind").and_then(Value::as_str) == Some("keepalive") {
        return Ok(None);
    }

    let kind = value.get("kind").and_then(Value::as_str).ok_or_else(|| {
        TrellisClientError::OperationProtocol("expected watch frame kind".to_string())
    })?;

    match kind {
        "snapshot" => {
            let frame: SnapshotFrame<TProgress, TOutput> = serde_json::from_value(value)?;
            Ok(Some(snapshot_to_event(frame.snapshot)))
        }
        "event" => {
            let frame: EventFrame<TProgress, TOutput> = serde_json::from_value(value)?;
            Ok(Some(frame.event))
        }
        _ => Err(TrellisClientError::OperationProtocol(
            "expected snapshot/event/keepalive frame".to_string(),
        )),
    }
}

fn snapshot_to_event<TProgress, TOutput>(
    snapshot: OperationSnapshot<TProgress, TOutput>,
) -> OperationEvent<TProgress, TOutput> {
    match snapshot.state {
        OperationState::Pending => OperationEvent::Accepted { snapshot },
        OperationState::Running => OperationEvent::Started { snapshot },
        OperationState::Completed => OperationEvent::Completed { snapshot },
        OperationState::Failed => OperationEvent::Failed { snapshot },
        OperationState::Cancelled => OperationEvent::Cancelled { snapshot },
    }
}

fn is_terminal_event<TProgress, TOutput>(event: &OperationEvent<TProgress, TOutput>) -> bool {
    matches!(
        event,
        OperationEvent::Completed { .. }
            | OperationEvent::Failed { .. }
            | OperationEvent::Cancelled { .. }
    )
}

pub fn control_subject(subject: &str) -> String {
    format!("{subject}.control")
}
