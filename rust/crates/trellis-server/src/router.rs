use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use bytes::Bytes;
use futures_util::future::BoxFuture;

use crate::{
    control_subject, AcceptedOperation, HandlerResult, OperationControlRequest,
    OperationDescriptor, OperationSnapshot, OperationSnapshotFrame, RpcDescriptor, ServerError,
};

/// Request metadata forwarded to mounted RPC handlers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RequestContext {
    pub subject: String,
    pub session_key: Option<String>,
    pub proof: Option<String>,
}

type BoxedHandler = Box<
    dyn Fn(RequestContext, Bytes) -> BoxFuture<'static, Result<Bytes, ServerError>> + Send + Sync,
>;

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
                move |ctx, payload| -> BoxFuture<'static, Result<Bytes, ServerError>> {
                    let handler = Arc::clone(&handler);
                    let input =
                        serde_json::from_slice::<D::Input>(&payload).map_err(ServerError::Json);
                    Box::pin(async move {
                        let input = input?;
                        let output = handler(ctx, input).await?;
                        Ok(Bytes::from(serde_json::to_vec(&output)?))
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
        let start = Arc::new(start);
        let get = Arc::new(get);
        let wait = Arc::new(wait);
        let cancel = Arc::new(cancel);

        self.handlers.insert(
            D::SUBJECT.to_string(),
            Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<Bytes, ServerError>> {
                    let start = Arc::clone(&start);
                    let input =
                        serde_json::from_slice::<D::Input>(&payload).map_err(ServerError::Json);
                    Box::pin(async move {
                        let input = input?;
                        let output = start(ctx, input).await?;
                        Ok(Bytes::from(serde_json::to_vec(&output)?))
                    })
                },
            ),
        );

        self.handlers.insert(
            control_subject(D::SUBJECT),
            Box::new(
                move |ctx, payload| -> BoxFuture<'static, Result<Bytes, ServerError>> {
                    let get = Arc::clone(&get);
                    let wait = Arc::clone(&wait);
                    let cancel = Arc::clone(&cancel);
                    let request = serde_json::from_slice::<OperationControlRequest>(&payload)
                        .map_err(ServerError::Json);
                    Box::pin(async move {
                        let request = request?;
                        let snapshot = match request.action.as_str() {
                            "get" => get(ctx, request.operation_id).await?,
                            "wait" => wait(ctx, request.operation_id).await?,
                            "watch" => get(ctx, request.operation_id).await?,
                            "cancel" if D::CANCELABLE => cancel(ctx, request.operation_id).await?,
                            action => {
                                return Err(ServerError::InvalidOperationControlAction {
                                    subject: D::SUBJECT.to_string(),
                                    action: action.to_string(),
                                })
                            }
                        };

                        let frame = OperationSnapshotFrame {
                            kind: "snapshot".to_string(),
                            snapshot,
                        };
                        Ok(Bytes::from(serde_json::to_vec(&frame)?))
                    })
                },
            ),
        );
    }

    /// Dispatch one request to the registered handler for its subject.
    pub async fn handle_request(
        &self,
        subject: &str,
        payload: Bytes,
        context: RequestContext,
    ) -> Result<Bytes, ServerError> {
        let handler = self
            .handlers
            .get(subject)
            .ok_or_else(|| ServerError::MissingHandler(subject.to_string()))?;
        handler(context, payload).await
    }
}
