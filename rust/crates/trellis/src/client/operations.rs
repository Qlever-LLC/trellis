use std::future::Future;
use std::marker::PhantomData;

use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::client::transfer::{FileInfo, UploadTransferGrant};
use crate::client::TrellisClientError;

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

/// Acknowledgement returned after an operation signal is accepted by the provider.
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OperationErrorFrame {
    kind: String,
    error: OperationControlError,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OperationControlError {
    #[serde(rename = "type")]
    error_type: String,
    message: String,
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
    const OBSERVE_CAPABILITIES: &'static [&'static str];
    const CANCEL_CAPABILITIES: &'static [&'static str];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[];
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
    /// Create a typed operation reference for an existing operation id.
    ///
    /// This does not send a start request or run the operation handler. Follow-up
    /// methods on the returned reference use the descriptor-derived control
    /// subject and preserve the descriptor's progress and output types.
    pub fn control(
        &self,
        operation_id: impl Into<String>,
    ) -> Result<OperationRef<'a, T, D>, TrellisClientError>
    where
        D: OperationDescriptor,
    {
        let operation_id = operation_id.into();
        if operation_id.trim().is_empty() {
            return Err(TrellisClientError::OperationProtocol(
                "operation id must not be empty".to_string(),
            ));
        }

        Ok(OperationRef {
            transport: self.transport,
            data: OperationRefData {
                id: operation_id,
                service: String::new(),
                operation: D::KEY.to_string(),
            },
            accepted_transfer: None,
            _descriptor: PhantomData,
        })
    }

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
    /// Return the durable operation id.
    pub fn id(&self) -> &str {
        &self.data.id
    }

    /// Return the owning service name when known from the accepted envelope.
    ///
    /// References resumed with [`OperationInvoker::control`] are scoped by the
    /// typed descriptor and operation id, so this value is empty until the
    /// runtime receives service metadata from a start response.
    pub fn service(&self) -> &str {
        &self.data.service
    }

    /// Return the operation key for this typed reference.
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
        decode_snapshot_response(response)
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
        let snapshot = decode_snapshot_response(response)?;
        if !is_terminal_state(&snapshot.state) {
            return Err(TrellisClientError::OperationProtocol(
                "wait returned non-terminal snapshot".to_string(),
            ));
        }
        Ok(snapshot)
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
        decode_snapshot_response(response)
    }

    /// Send a control signal to the running operation.
    pub async fn signal(
        &self,
        signal: impl Into<String>,
        input: Option<Value>,
    ) -> Result<OperationSignalAccepted<D::Progress, D::Output>, TrellisClientError> {
        let mut body = json!({
            "action": "signal",
            "operationId": self.id(),
            "signal": signal.into(),
        });
        if let Some(input) = input {
            body["input"] = input;
        }
        let response = self
            .transport
            .request_json_value(control_subject(D::SUBJECT), body)
            .await?;
        decode_signal_response(response)
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
        "error" => Err(operation_error_frame(value)),
        _ => Err(TrellisClientError::OperationProtocol(
            "expected snapshot/event/keepalive frame".to_string(),
        )),
    }
}

fn decode_snapshot_response<TProgress: DeserializeOwned, TOutput: DeserializeOwned>(
    value: Value,
) -> Result<OperationSnapshot<TProgress, TOutput>, TrellisClientError> {
    let kind = value.get("kind").and_then(Value::as_str).ok_or_else(|| {
        TrellisClientError::OperationProtocol("expected control frame kind".to_string())
    })?;

    match kind {
        "snapshot" => {
            let frame: SnapshotFrame<TProgress, TOutput> = serde_json::from_value(value)?;
            Ok(frame.snapshot)
        }
        "error" => Err(operation_error_frame(value)),
        _ => Err(TrellisClientError::OperationProtocol(format!(
            "expected snapshot frame, got '{kind}'"
        ))),
    }
}

fn decode_signal_response<TProgress: DeserializeOwned, TOutput: DeserializeOwned>(
    value: Value,
) -> Result<OperationSignalAccepted<TProgress, TOutput>, TrellisClientError> {
    let kind = value.get("kind").and_then(Value::as_str).ok_or_else(|| {
        TrellisClientError::OperationProtocol("expected signal frame kind".to_string())
    })?;

    match kind {
        "signal-accepted" => Ok(serde_json::from_value(value)?),
        "error" => Err(operation_error_frame(value)),
        _ => Err(TrellisClientError::OperationProtocol(format!(
            "expected signal-accepted frame, got '{kind}'"
        ))),
    }
}

fn operation_error_frame(value: Value) -> TrellisClientError {
    match serde_json::from_value::<OperationErrorFrame>(value) {
        Ok(frame) => TrellisClientError::OperationProtocol(format!(
            "{}: {}",
            frame.error.error_type, frame.error.message
        )),
        Err(error) => TrellisClientError::Json(error),
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

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use futures_util::stream::{self, BoxStream};
    use futures_util::StreamExt;
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};

    use super::{
        control_subject, FileInfo, OperationDescriptor, OperationEvent, OperationInvoker,
        OperationSignalAccepted, OperationTransferProgress, OperationTransport,
        TransferOperationDescriptor, UploadTransferGrant,
    };
    use crate::client::TrellisClientError;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundInput {
        charge_id: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundProgress {
        message: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundOutput {
        refund_id: String,
    }

    struct RefundOperation;

    impl OperationDescriptor for RefundOperation {
        type Input = RefundInput;
        type Progress = RefundProgress;
        type Output = RefundOutput;

        const KEY: &'static str = "Billing.Refund";
        const SUBJECT: &'static str = "operations.v1.Billing.Refund";
        const CALLER_CAPABILITIES: &'static [&'static str] = &["billing.refund"];
        const OBSERVE_CAPABILITIES: &'static [&'static str] = &["billing.read"];
        const CANCEL_CAPABILITIES: &'static [&'static str] = &["billing.cancel"];
        const CANCELABLE: bool = true;
    }

    impl TransferOperationDescriptor for RefundOperation {}

    #[derive(Debug, Default)]
    struct RecordingTransport {
        requests: Mutex<Vec<(String, Value)>>,
        responses: Mutex<Vec<Value>>,
        watch_frames: Mutex<Vec<Value>>,
    }

    impl RecordingTransport {
        fn with_responses(responses: Vec<Value>) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                responses: Mutex::new(responses),
                watch_frames: Mutex::new(Vec::new()),
            }
        }

        fn with_watch_frames(watch_frames: Vec<Value>) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                responses: Mutex::new(Vec::new()),
                watch_frames: Mutex::new(watch_frames),
            }
        }

        fn requests(&self) -> Vec<(String, Value)> {
            self.requests.lock().expect("requests lock").clone()
        }
    }

    impl OperationTransport for RecordingTransport {
        async fn request_json_value(
            &self,
            subject: String,
            body: Value,
        ) -> Result<Value, TrellisClientError> {
            self.requests
                .lock()
                .expect("requests lock")
                .push((subject, body));
            let response = self.responses.lock().expect("responses lock").remove(0);
            Ok(response)
        }

        async fn watch_json_value<'a>(
            &'a self,
            subject: String,
            body: Value,
        ) -> Result<BoxStream<'a, Result<Value, TrellisClientError>>, TrellisClientError> {
            self.requests
                .lock()
                .expect("requests lock")
                .push((subject, body));
            let frames = std::mem::take(&mut *self.watch_frames.lock().expect("watch lock"));
            Ok(Box::pin(stream::iter(frames.into_iter().map(Ok))))
        }

        async fn put_upload_transfer<'a>(
            &'a self,
            _grant: UploadTransferGrant,
            _body: Vec<u8>,
        ) -> Result<FileInfo, TrellisClientError> {
            Err(TrellisClientError::TransferProtocol(
                "not implemented in test transport".to_string(),
            ))
        }
    }

    #[tokio::test]
    async fn control_by_operation_id_uses_typed_control_subject_without_starting() {
        let transport = RecordingTransport::with_responses(vec![json!({
            "kind": "snapshot",
            "snapshot": {
                "revision": 7,
                "state": "running",
                "progress": { "message": "job resumed" }
            }
        })]);
        let invoker = OperationInvoker::<_, RefundOperation>::new(&transport);

        let operation = invoker
            .control("op_resumed")
            .expect("operation id is valid");
        let snapshot = operation.get().await.expect("get succeeds");

        assert_eq!(operation.id(), "op_resumed");
        assert_eq!(operation.operation(), "Billing.Refund");
        assert_eq!(snapshot.revision, 7);
        assert_eq!(
            snapshot.progress,
            Some(RefundProgress {
                message: "job resumed".to_string(),
            })
        );
        assert_eq!(
            transport.requests(),
            vec![(
                control_subject(RefundOperation::SUBJECT),
                json!({ "action": "get", "operationId": "op_resumed" })
            )]
        );
    }

    #[test]
    fn control_by_operation_id_rejects_empty_id_as_result_error() {
        let transport = RecordingTransport::default();
        let invoker = OperationInvoker::<_, RefundOperation>::new(&transport);

        let error = invoker.control("   ").expect_err("empty id is rejected");

        assert!(matches!(error, TrellisClientError::OperationProtocol(_)));
        assert!(transport.requests().is_empty());
    }

    #[tokio::test]
    async fn resumed_operation_reference_preserves_typed_output() {
        let transport = RecordingTransport::with_responses(vec![json!({
            "kind": "snapshot",
            "snapshot": {
                "revision": 8,
                "state": "completed",
                "output": { "refund_id": "rf_resumed" }
            }
        })]);
        let invoker = OperationInvoker::<_, RefundOperation>::new(&transport);

        let snapshot = invoker
            .control("op_done")
            .expect("operation id is valid")
            .wait()
            .await
            .expect("wait succeeds");

        assert_eq!(
            snapshot.output,
            Some(RefundOutput {
                refund_id: "rf_resumed".to_string(),
            })
        );
    }

    #[tokio::test]
    async fn resumed_transfer_attempt_returns_result_error_without_payload_mutation() {
        let transport = RecordingTransport::default();
        let invoker = OperationInvoker::<_, RefundOperation>::new(&transport);

        let error = invoker
            .control("op_transfer")
            .expect("operation id is valid")
            .transfer(Vec::new())
            .await
            .expect_err("resumed refs do not carry accepted transfer grants");

        assert!(matches!(error, TrellisClientError::OperationProtocol(_)));
        assert!(transport.requests().is_empty());

        let _ = OperationTransferProgress {
            chunk_index: 0,
            chunk_bytes: 0,
            transferred_bytes: 0,
        };
    }

    #[tokio::test]
    async fn control_error_frame_returns_result_error_for_invalid_operation_state() {
        let transport = RecordingTransport::with_responses(vec![json!({
            "kind": "error",
            "error": {
                "type": "TerminalOperation",
                "message": "operation is already terminal"
            }
        })]);
        let invoker = OperationInvoker::<_, RefundOperation>::new(&transport);

        let error = invoker
            .control("op_done")
            .expect("operation id is valid")
            .cancel()
            .await
            .expect_err("terminal control returns expected error");

        match error {
            TrellisClientError::OperationProtocol(message) => {
                assert!(message.contains("TerminalOperation"));
                assert!(message.contains("already terminal"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[tokio::test]
    async fn signal_sends_control_signal_and_decodes_ack() {
        let transport = RecordingTransport::with_responses(vec![json!({
            "kind": "signal-accepted",
            "operationId": "op_signal",
            "signal": "selectWorkspace",
            "signalSequence": 1,
            "acceptedAt": "2026-05-15T00:00:00Z",
            "snapshot": {
                "revision": 2,
                "state": "running",
                "progress": { "message": "waiting" }
            }
        })]);
        let invoker = OperationInvoker::<_, RefundOperation>::new(&transport);

        let ack: OperationSignalAccepted<RefundProgress, RefundOutput> = invoker
            .control("op_signal")
            .expect("operation id is valid")
            .signal("selectWorkspace", Some(json!({ "workspaceId": "ws_1" })))
            .await
            .expect("signal succeeds");

        assert_eq!(ack.signal, "selectWorkspace");
        assert_eq!(ack.signal_sequence, 1);
        assert_eq!(
            transport.requests(),
            vec![(
                control_subject(RefundOperation::SUBJECT),
                json!({
                    "action": "signal",
                    "operationId": "op_signal",
                    "signal": "selectWorkspace",
                    "input": { "workspaceId": "ws_1" }
                })
            )]
        );
    }

    #[tokio::test]
    async fn watch_uses_control_subject_skips_keepalive_and_stops_after_terminal_event() {
        let transport = RecordingTransport::with_watch_frames(vec![
            json!({
                "kind": "snapshot",
                "snapshot": {
                    "revision": 2,
                    "state": "running",
                    "progress": { "message": "working" }
                }
            }),
            json!({
                "kind": "event",
                "event": {
                    "type": "progress",
                    "snapshot": {
                        "revision": 3,
                        "state": "running",
                        "progress": { "message": "almost there" }
                    }
                }
            }),
            json!({ "kind": "keepalive" }),
            json!({
                "kind": "event",
                "event": {
                    "type": "completed",
                    "snapshot": {
                        "revision": 4,
                        "state": "completed",
                        "output": { "refund_id": "rf_123" }
                    }
                }
            }),
            json!({
                "kind": "event",
                "event": {
                    "type": "progress",
                    "snapshot": {
                        "revision": 5,
                        "state": "running",
                        "progress": { "message": "ignored" }
                    }
                }
            }),
        ]);
        let invoker = OperationInvoker::<_, RefundOperation>::new(&transport);

        let operation = invoker.control("op_123").expect("operation id is valid");
        let events: Vec<_> = operation
            .watch()
            .await
            .expect("watch succeeds")
            .collect()
            .await;

        assert_eq!(
            transport.requests(),
            vec![(
                control_subject(RefundOperation::SUBJECT),
                json!({ "action": "watch", "operationId": "op_123" })
            )]
        );
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], Ok(OperationEvent::Started { .. })));
        assert!(matches!(events[1], Ok(OperationEvent::Progress { .. })));
        assert!(matches!(events[2], Ok(OperationEvent::Completed { .. })));
    }
}
