use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use bytes::Bytes;
use futures_util::future::BoxFuture;
use futures_util::{Stream, StreamExt};
use std::pin::Pin;

use serde_json::Value;

use super::error::ValidationIssue;
use super::request_loop::{HandlerResponse, ResponseStream};
use super::schema_validation::validate_input_schema;
use super::{
    control_subject, AcceptedOperation, FeedDescriptor, HandlerResult, OperationControlRequest,
    OperationDescriptor, OperationProvider, OperationSignalAccepted, OperationSnapshot,
    OperationSnapshotFrame, RpcDescriptor, ServerError,
};

/// Request metadata forwarded to mounted RPC handlers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RequestContext {
    /// NATS subject that received the request.
    pub subject: String,
    /// Runtime session key from the authenticated request headers.
    pub session_key: Option<String>,
    /// Proof signature from the authenticated request headers.
    pub proof: Option<String>,
    /// Proof issued-at timestamp from the authenticated request headers.
    pub iat: Option<i64>,
    /// Unique request id from the authenticated request headers.
    pub request_id: Option<String>,
    /// Capability requirements for this exact routed request.
    pub required_capabilities: Option<Vec<String>>,
    /// NATS reply inbox used for request/reply responses.
    pub reply_to: Option<String>,
    /// Validated caller metadata returned by `Auth.Requests.Validate`.
    pub caller: Option<Value>,
    /// W3C trace context header propagated by the caller, if present.
    pub traceparent: Option<String>,
    /// W3C trace state header propagated by the caller, if present.
    pub tracestate: Option<String>,
}

type BoxedHandler = Box<
    dyn Fn(RequestContext, Bytes) -> BoxFuture<'static, Result<HandlerResponse, ServerError>>
        + Send
        + Sync,
>;

struct Route {
    handler: BoxedHandler,
    capabilities: RouteCapabilities,
}

#[derive(Debug, Clone, Copy)]
enum RouteCapabilities {
    Static(&'static [&'static str]),
    OperationControl {
        observe: &'static [&'static str],
        cancel: &'static [&'static str],
        control: &'static [&'static str],
    },
}

impl RouteCapabilities {
    fn required_for_payload(self, payload: &[u8]) -> Option<Vec<String>> {
        let capabilities = match self {
            Self::Static(capabilities) => capabilities,
            Self::OperationControl {
                observe,
                cancel,
                control,
            } => match serde_json::from_slice::<OperationControlRequest>(payload) {
                Ok(request) => match request.action.as_str() {
                    "get" | "wait" | "watch" => observe,
                    "cancel" => cancel,
                    "signal" => control,
                    _ => &[],
                },
                Err(_) => &[],
            },
        };

        Some(
            capabilities
                .iter()
                .map(|capability| (*capability).to_string())
                .collect(),
        )
    }
}

type OperationWatch<TProgress, TOutput> =
    Pin<Box<dyn Stream<Item = Result<OperationSnapshot<TProgress, TOutput>, ServerError>> + Send>>;

/// An in-memory subject router for descriptor-backed RPC handlers.
#[derive(Default)]
pub struct Router {
    handlers: HashMap<String, Route>,
}

impl Router {
    /// Create an empty router.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register one descriptor-backed handler.
    pub fn register_rpc<D, F, Fut>(&mut self, handler: F)
    where
        D: RpcDescriptor + 'static,
        F: Fn(RequestContext, D::Input) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = HandlerResult<D::Output>> + Send + 'static,
    {
        let handler = Arc::new(handler);
        self.handlers.insert(
            D::SUBJECT.to_string(),
            Route {
                capabilities: RouteCapabilities::Static(D::CALLER_CAPABILITIES),
                handler: Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<HandlerResponse, ServerError>> {
                    let handler = Arc::clone(&handler);
                    Box::pin(async move {
                        let input = parse_validated_input::<D::Input>(&payload, D::INPUT_SCHEMA_JSON)?;
                        let output = handler(ctx, input).await?;
                        Ok(HandlerResponse::Frames(vec![Bytes::from(
                            serde_json::to_vec(&output)?,
                        )]))
                    })
                },
            ),
            },
        );
    }

    /// Register one descriptor-backed feed handler.
    pub fn register_feed<D, F, S>(&mut self, handler: F)
    where
        D: FeedDescriptor + 'static,
        F: Fn(RequestContext, D::Input) -> S + Send + Sync + 'static,
        S: Stream<Item = Result<D::Event, ServerError>> + Send + 'static,
    {
        let handler = Arc::new(handler);
        self.handlers.insert(
            D::SUBJECT.to_string(),
            Route {
                capabilities: RouteCapabilities::Static(D::SUBSCRIBE_CAPABILITIES),
                handler: Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<HandlerResponse, ServerError>> {
                    let handler = Arc::clone(&handler);
                    Box::pin(async move {
                        let input = parse_validated_input::<D::Input>(&payload, D::INPUT_SCHEMA_JSON)?;
                        Ok(HandlerResponse::FeedStream(feed_response_stream(handler(
                            ctx, input,
                        ))))
                    })
                },
            ),
            },
        );
    }

    /// Register one operation-backed handler pair.
    pub fn register_operation<
        D,
        FStart,
        FutStart,
        FGet,
        FutGet,
        FWait,
        FutWait,
        FCancel,
        FutCancel,
    >(
        &mut self,
        start: FStart,
        get: FGet,
        wait: FWait,
        cancel: FCancel,
    ) where
        D: OperationDescriptor + 'static,
        FStart: Fn(RequestContext, D::Input) -> FutStart + Send + Sync + 'static,
        FutStart: Future<Output = Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FGet: Fn(RequestContext, String) -> FutGet + Send + Sync + 'static,
        FutGet: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FWait: Fn(RequestContext, String) -> FutWait + Send + Sync + 'static,
        FutWait: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FCancel: Fn(RequestContext, String) -> FutCancel + Send + Sync + 'static,
        FutCancel: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
    {
        let watch = {
            let wait = Arc::new(wait);
            move |ctx, operation_id| {
                let wait = Arc::clone(&wait);
                Box::pin(futures_util::stream::once(async move {
                    wait(ctx, operation_id).await
                })) as OperationWatch<D::Progress, D::Output>
            }
        };

        self.register_operation_with_watch::<D, _, _, _, _, _, _, _>(start, get, watch, cancel);
    }

    /// Register one operation-backed handler pair with a watch snapshot stream.
    pub fn register_operation_with_watch<
        D,
        FStart,
        FutStart,
        FGet,
        FutGet,
        FWatch,
        FCancel,
        FutCancel,
    >(
        &mut self,
        start: FStart,
        get: FGet,
        watch: FWatch,
        cancel: FCancel,
    ) where
        D: OperationDescriptor + 'static,
        FStart: Fn(RequestContext, D::Input) -> FutStart + Send + Sync + 'static,
        FutStart: Future<Output = Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FGet: Fn(RequestContext, String) -> FutGet + Send + Sync + 'static,
        FutGet: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FWatch: Fn(RequestContext, String) -> OperationWatch<D::Progress, D::Output>
            + Send
            + Sync
            + 'static,
        FCancel: Fn(RequestContext, String) -> FutCancel + Send + Sync + 'static,
        FutCancel: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
    {
        let start = Arc::new(start);
        let get = Arc::new(get);
        let watch = Arc::new(watch);
        let cancel = Arc::new(cancel);

        self.register_operation_with_watch_and_signal::<D, _, _, _, _, _, _, _, _, _>(
            move |ctx, input| {
                let start = Arc::clone(&start);
                async move { start(ctx, input).await }
            },
            move |ctx, operation_id| {
                let get = Arc::clone(&get);
                async move { get(ctx, operation_id).await }
            },
            move |ctx, operation_id| watch(ctx, operation_id),
            move |ctx, operation_id| {
                let cancel = Arc::clone(&cancel);
                async move { cancel(ctx, operation_id).await }
            },
            |_ctx, _operation_id, _signal, _input| async move {
                Err(ServerError::InvalidOperationControlAction {
                    subject: D::SUBJECT.to_string(),
                    action: "signal".to_string(),
                })
            },
        );
    }

    /// Register one operation-backed handler with watch and signal control support.
    pub fn register_operation_with_watch_and_signal<
        D,
        FStart,
        FutStart,
        FGet,
        FutGet,
        FWatch,
        FCancel,
        FutCancel,
        FSignal,
        FutSignal,
    >(
        &mut self,
        start: FStart,
        get: FGet,
        watch: FWatch,
        cancel: FCancel,
        signal: FSignal,
    ) where
        D: OperationDescriptor + 'static,
        FStart: Fn(RequestContext, D::Input) -> FutStart + Send + Sync + 'static,
        FutStart: Future<Output = Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FGet: Fn(RequestContext, String) -> FutGet + Send + Sync + 'static,
        FutGet: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FWatch: Fn(RequestContext, String) -> OperationWatch<D::Progress, D::Output>
            + Send
            + Sync
            + 'static,
        FCancel: Fn(RequestContext, String) -> FutCancel + Send + Sync + 'static,
        FutCancel: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FSignal:
            Fn(RequestContext, String, String, Option<Value>) -> FutSignal + Send + Sync + 'static,
        FutSignal: Future<Output = Result<OperationSignalAccepted<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
    {
        let start = Arc::new(start);
        let get = Arc::new(get);
        let watch = Arc::new(watch);
        let cancel = Arc::new(cancel);
        let signal = Arc::new(signal);

        self.handlers.insert(
            D::SUBJECT.to_string(),
            Route {
                capabilities: RouteCapabilities::Static(D::CALLER_CAPABILITIES),
                handler: Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<HandlerResponse, ServerError>> {
                    let start = Arc::clone(&start);
                    Box::pin(async move {
                        let input = parse_validated_input::<D::Input>(&payload, D::INPUT_SCHEMA_JSON)?;
                        let output = start(ctx, input).await?;
                        Ok(HandlerResponse::Frames(vec![Bytes::from(
                            serde_json::to_vec(&output)?,
                        )]))
                    })
                },
            ),
            },
        );

        self.handlers.insert(
            control_subject(D::SUBJECT),
            Route {
                capabilities: RouteCapabilities::OperationControl {
                    observe: D::OBSERVE_CAPABILITIES,
                    cancel: D::CANCEL_CAPABILITIES,
                    control: D::CONTROL_CAPABILITIES,
                },
                handler: Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<HandlerResponse, ServerError>> {
                    let get = Arc::clone(&get);
                    let watch = Arc::clone(&watch);
                    let cancel = Arc::clone(&cancel);
                    let signal = Arc::clone(&signal);
                    let request = serde_json::from_slice::<OperationControlRequest>(&payload)
                        .map_err(ServerError::Json);
                    Box::pin(async move {
                        let request = request?;
                        tracing::debug!(
                            subject = D::SUBJECT,
                            action = %request.action,
                            operation_id = %request.operation_id,
                            "operation control request"
                        );
                        let frames = match request.action.as_str() {
                            "get" => HandlerResponse::Frames(vec![snapshot_frame(
                                get(ctx, request.operation_id).await?,
                            )?]),
                            "wait" => {
                                let mut snapshots = watch(ctx, request.operation_id);
                                let mut terminal = None;
                                while let Some(snapshot) = snapshots.next().await {
                                    let snapshot = snapshot?;
                                    if snapshot.state.is_terminal() {
                                        terminal = Some(snapshot);
                                        break;
                                    }
                                }
                                let snapshot = terminal.ok_or_else(|| {
                                    ServerError::Nats(
                                        "operation wait ended without terminal snapshot"
                                            .to_string(),
                                    )
                                })?;
                                HandlerResponse::Frames(vec![snapshot_frame(snapshot)?])
                            }
                            "watch" => HandlerResponse::Stream(watch_response_stream(watch(
                                ctx,
                                request.operation_id,
                            ))),
                            "cancel" if D::CANCELABLE => {
                                HandlerResponse::Frames(vec![snapshot_frame(
                                    cancel(ctx, request.operation_id).await?,
                                )?])
                            }
                            "signal" => {
                                let signal_name = request.signal.ok_or_else(|| {
                                    ServerError::InvalidOperationControlAction {
                                        subject: D::SUBJECT.to_string(),
                                        action: "signal".to_string(),
                                    }
                                })?;
                                let signal_schemas: serde_json::Value =
                                    serde_json::from_str(D::SIGNAL_INPUT_SCHEMAS_JSON)
                                        .map_err(|e| ServerError::Nats(
                                            format!("failed to parse signal schemas: {e}")
                                        ))?;
                                let signal_schema = signal_schemas
                                    .get(&signal_name)
                                    .ok_or_else(|| ServerError::InvalidOperationControlAction {
                                        subject: D::SUBJECT.to_string(),
                                        action: format!("signal:{signal_name}"),
                                    })?;
                                let signal_value = request.input.as_ref().unwrap_or(&serde_json::Value::Null);
                                let signal_schema_str = serde_json::to_string(signal_schema)
                                    .map_err(|e| ServerError::Nats(
                                        format!("failed to serialize signal schema: {e}")
                                    ))?;
                                validate_input_schema(&signal_schema_str, signal_value)?;
                                HandlerResponse::Frames(vec![signal_frame(
                                    signal(ctx, request.operation_id, signal_name, request.input)
                                        .await?,
                                )?])
                            }
                            action => {
                                return Err(ServerError::InvalidOperationControlAction {
                                    subject: D::SUBJECT.to_string(),
                                    action: action.to_string(),
                                })
                            }
                        };
                        Ok(frames)
                    })
                },
            ),
            },
        );
    }

    /// Register one operation-backed provider.
    pub fn register_operation_provider<D, P>(&mut self, provider: P)
    where
        D: OperationDescriptor + 'static,
        P: OperationProvider<D>,
    {
        let provider = Arc::new(provider);
        self.register_operation::<D, _, _, _, _, _, _, _, _>(
            {
                let provider = Arc::clone(&provider);
                move |context, input| provider.start(context, input)
            },
            {
                let provider = Arc::clone(&provider);
                move |context, operation_id| provider.get(context, operation_id)
            },
            {
                let provider = Arc::clone(&provider);
                move |context, operation_id| provider.wait(context, operation_id)
            },
            move |context, operation_id| provider.cancel(context, operation_id),
        );
    }

    /// Dispatch one request to the registered handler for its subject.
    pub async fn handle_request(
        &self,
        subject: &str,
        payload: Bytes,
        context: RequestContext,
    ) -> Result<Bytes, ServerError> {
        let mut frames = self
            .handle_request_frames(subject, payload, context)
            .await?;
        let first = frames.drain(..).next().ok_or_else(|| {
            ServerError::Nats(format!("handler for '{subject}' returned no response"))
        })?;
        Ok(first)
    }

    /// Return declared capabilities required for the routed request payload.
    pub fn required_capabilities(
        &self,
        subject: &str,
        payload: &[u8],
    ) -> Result<Option<Vec<String>>, ServerError> {
        let route = self
            .handlers
            .get(subject)
            .ok_or_else(|| ServerError::MissingHandler(subject.to_string()))?;
        Ok(route.capabilities.required_for_payload(payload))
    }

    /// Dispatch one request to the registered handler for its subject.
    pub async fn handle_request_frames(
        &self,
        subject: &str,
        payload: Bytes,
        context: RequestContext,
    ) -> Result<Vec<Bytes>, ServerError> {
        match self
            .handle_request_response(subject, payload, context)
            .await?
        {
            HandlerResponse::Frames(frames) => Ok(frames),
            HandlerResponse::Error(payload) => Ok(vec![payload]),
            HandlerResponse::Stream(mut stream) => {
                let mut frames = Vec::new();
                while let Some(frame) = stream.next().await {
                    frames.push(frame?);
                }
                Ok(frames)
            }
            HandlerResponse::FeedStream(mut stream) => {
                let mut frames = Vec::new();
                while let Some(frame) = stream.next().await {
                    frames.push(frame?);
                }
                Ok(frames)
            }
        }
    }

    /// Dispatch one request to the registered handler for its subject.
    pub async fn handle_request_response(
        &self,
        subject: &str,
        payload: Bytes,
        context: RequestContext,
    ) -> Result<HandlerResponse, ServerError> {
        let route = self
            .handlers
            .get(subject)
            .ok_or_else(|| ServerError::MissingHandler(subject.to_string()))?;
        (route.handler)(context, payload).await
    }
}

/// Parse bytes into a valid JSON value, validate against JSON Schema, then
/// deserialize into the target type.
///
/// JSON Schema validation failures become `ServerError::Validation` or
/// `ServerError::SchemaValidation` before handler dispatch.
/// Serde deserialization failures after successful validation are internal errors.
fn parse_validated_input<T>(payload: &[u8], schema_json: &str) -> Result<T, ServerError>
where
    T: serde::de::DeserializeOwned,
{
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|error| ServerError::Validation {
            issues: vec![ValidationIssue {
                path: String::new(),
                message: format!("Invalid JSON: {error}"),
            }],
        })?;

    validate_input_schema(schema_json, &value)?;

    serde_json::from_value::<T>(value).map_err(|error| {
        ServerError::Nats(format!(
            "validated payload failed Rust type decoding: {error}"
        ))
    })
}

fn feed_response_stream<TEvent>(
    events: impl Stream<Item = Result<TEvent, ServerError>> + Send + 'static,
) -> ResponseStream
where
    TEvent: serde::Serialize + 'static,
{
    Box::pin(
        events.map(|event| event.and_then(|event| Ok(Bytes::from(serde_json::to_vec(&event)?)))),
    )
}

fn watch_response_stream<TProgress, TOutput>(
    snapshots: OperationWatch<TProgress, TOutput>,
) -> ResponseStream
where
    TProgress: serde::Serialize + 'static,
    TOutput: serde::Serialize + 'static,
{
    Box::pin(snapshots.enumerate().map(|(index, snapshot)| {
        snapshot.and_then(|snapshot| operation_watch_frame(index, snapshot))
    }))
}

fn snapshot_frame<TProgress, TOutput>(
    snapshot: OperationSnapshot<TProgress, TOutput>,
) -> Result<Bytes, ServerError>
where
    TProgress: serde::Serialize,
    TOutput: serde::Serialize,
{
    Ok(Bytes::from(serde_json::to_vec(&OperationSnapshotFrame {
        kind: "snapshot".to_string(),
        snapshot,
    })?))
}

fn signal_frame<TProgress, TOutput>(
    accepted: OperationSignalAccepted<TProgress, TOutput>,
) -> Result<Bytes, ServerError>
where
    TProgress: serde::Serialize,
    TOutput: serde::Serialize,
{
    Ok(Bytes::from(serde_json::to_vec(&accepted)?))
}

fn operation_watch_frame<TProgress, TOutput>(
    index: usize,
    snapshot: OperationSnapshot<TProgress, TOutput>,
) -> Result<Bytes, ServerError>
where
    TProgress: serde::Serialize,
    TOutput: serde::Serialize,
{
    if index == 0 {
        return snapshot_frame(snapshot);
    }

    let event_type = match snapshot.state {
        super::OperationState::Pending => "accepted",
        super::OperationState::Running if snapshot.transfer.is_some() => "transfer",
        super::OperationState::Running if snapshot.progress.is_some() => "progress",
        super::OperationState::Running => "started",
        super::OperationState::Completed => "completed",
        super::OperationState::Failed => "failed",
        super::OperationState::Cancelled => "cancelled",
    };

    let mut event = serde_json::json!({
        "type": event_type,
        "snapshot": snapshot,
    });
    if let Some(progress) = event
        .get("snapshot")
        .and_then(|value| value.get("progress"))
        .cloned()
    {
        event["progress"] = progress;
    }
    if let Some(transfer) = event
        .get("snapshot")
        .and_then(|value| value.get("transfer"))
        .cloned()
    {
        event["transfer"] = transfer;
    }

    Ok(Bytes::from(serde_json::to_vec(&serde_json::json!({
        "kind": "event",
        "sequence": index,
        "event": event,
    }))?))
}
