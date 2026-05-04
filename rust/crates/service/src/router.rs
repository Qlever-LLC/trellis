use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use bytes::Bytes;
use futures_util::future::BoxFuture;
use futures_util::{Stream, StreamExt};
use std::pin::Pin;

use crate::{
    control_subject, AcceptedOperation, HandlerResponse, HandlerResult, OperationControlRequest,
    OperationDescriptor, OperationProvider, OperationSnapshot, OperationSnapshotFrame,
    ResponseStream, RpcDescriptor, ServerError,
};

/// Request metadata forwarded to mounted RPC handlers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RequestContext {
    pub subject: String,
    pub session_key: Option<String>,
    pub proof: Option<String>,
}

type BoxedHandler = Box<
    dyn Fn(RequestContext, Bytes) -> BoxFuture<'static, Result<HandlerResponse, ServerError>>
        + Send
        + Sync,
>;

type OperationWatch<TProgress, TOutput> =
    Pin<Box<dyn Stream<Item = Result<OperationSnapshot<TProgress, TOutput>, ServerError>> + Send>>;

/// An in-memory subject router for descriptor-backed RPC handlers.
#[derive(Default)]
pub struct Router {
    handlers: HashMap<String, BoxedHandler>,
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
            Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<HandlerResponse, ServerError>> {
                    let handler = Arc::clone(&handler);
                    let input =
                        serde_json::from_slice::<D::Input>(&payload).map_err(ServerError::Json);
                    Box::pin(async move {
                        let input = input?;
                        let output = handler(ctx, input).await?;
                        Ok(HandlerResponse::Frames(vec![Bytes::from(
                            serde_json::to_vec(&output)?,
                        )]))
                    })
                },
            ),
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

        self.handlers.insert(
            D::SUBJECT.to_string(),
            Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<HandlerResponse, ServerError>> {
                    let start = Arc::clone(&start);
                    let input =
                        serde_json::from_slice::<D::Input>(&payload).map_err(ServerError::Json);
                    Box::pin(async move {
                        let input = input?;
                        let output = start(ctx, input).await?;
                        Ok(HandlerResponse::Frames(vec![Bytes::from(
                            serde_json::to_vec(&output)?,
                        )]))
                    })
                },
            ),
        );

        self.handlers.insert(
            control_subject(D::SUBJECT),
            Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<HandlerResponse, ServerError>> {
                    let get = Arc::clone(&get);
                    let watch = Arc::clone(&watch);
                    let cancel = Arc::clone(&cancel);
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
        }
    }

    /// Dispatch one request to the registered handler for its subject.
    pub async fn handle_request_response(
        &self,
        subject: &str,
        payload: Bytes,
        context: RequestContext,
    ) -> Result<HandlerResponse, ServerError> {
        let handler = self
            .handlers
            .get(subject)
            .ok_or_else(|| ServerError::MissingHandler(subject.to_string()))?;
        handler(context, payload).await
    }
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
        crate::OperationState::Pending => "accepted",
        crate::OperationState::Running if snapshot.transfer.is_some() => "transfer",
        crate::OperationState::Running if snapshot.progress.is_some() => "progress",
        crate::OperationState::Running => "started",
        crate::OperationState::Completed => "completed",
        crate::OperationState::Failed => "failed",
        crate::OperationState::Cancelled => "cancelled",
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
