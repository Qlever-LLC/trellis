use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use bytes::Bytes;
use futures_util::future::BoxFuture;

use crate::{HandlerResult, RpcDescriptor, ServerError};

/// Request metadata forwarded to mounted RPC handlers.
#[derive(Debug, Clone, Default)]
pub struct RequestContext {
    pub subject: String,
    pub session_key: Option<String>,
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
                    let input = serde_json::from_slice::<D::Input>(&payload)
                        .map_err(ServerError::Json);
                    Box::pin(async move {
                        let input = input?;
                        let output = handler(ctx, input).await?;
                        Ok(Bytes::from(serde_json::to_vec(&output)?))
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
