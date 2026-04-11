use async_nats::header::HeaderMap;
use bytes::Bytes;
use futures_util::future::BoxFuture;
use futures_util::StreamExt;

use crate::{AuthenticatedRouter, RequestContext, RequestValidator, Router, ServerError};

/// Decoded request message consumed by the host dispatcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundRequest {
    pub subject: String,
    pub payload: Bytes,
    pub reply_to: Option<String>,
    pub context: RequestContext,
}

/// Outbound response message emitted by the host dispatcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundReply {
    pub reply_to: String,
    pub payload: Bytes,
    pub is_error: bool,
}

/// Async request handler trait used by host request loops.
pub trait RequestHandler: Send + Sync {
    fn handle<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Bytes, ServerError>>;
}

impl RequestHandler for Router {
    fn handle<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Bytes, ServerError>> {
        Box::pin(async move { self.handle_request(subject, payload, context).await })
    }
}

impl<V> RequestHandler for AuthenticatedRouter<V>
where
    V: RequestValidator,
{
    fn handle<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Bytes, ServerError>> {
        Box::pin(async move { self.handle_request(subject, payload, context).await })
    }
}

/// Decode one inbound NATS message into host request fields.
pub fn decode_nats_request(message: &async_nats::Message) -> InboundRequest {
    let subject = message.subject.to_string();
    let reply_to = message.reply.as_ref().map(ToString::to_string);
    let session_key = message
        .headers
        .as_ref()
        .and_then(|headers| headers.get("session-key"))
        .map(|value| value.as_str().to_string());
    let proof = message
        .headers
        .as_ref()
        .and_then(|headers| headers.get("proof"))
        .map(|value| value.as_str().to_string());

    InboundRequest {
        subject: subject.clone(),
        payload: message.payload.clone(),
        reply_to,
        context: RequestContext {
            subject,
            session_key,
            proof,
        },
    }
}

/// Encode one successful handler payload for reply publishing.
pub fn encode_success_reply(reply_to: String, payload: Bytes) -> OutboundReply {
    OutboundReply {
        reply_to,
        payload,
        is_error: false,
    }
}

/// Encode one failed handler result for reply publishing.
pub fn encode_error_reply(reply_to: String, error: &ServerError) -> OutboundReply {
    #[derive(serde::Serialize)]
    struct ErrorPayload<'a> {
        error: &'a str,
    }

    let error_message = error.to_string();
    let payload = match serde_json::to_vec(&ErrorPayload {
        error: &error_message,
    }) {
        Ok(value) => Bytes::from(value),
        Err(_) => Bytes::from_static(br#"{"error":"unexpected error"}"#),
    };

    OutboundReply {
        reply_to,
        payload,
        is_error: true,
    }
}

/// Dispatch one decoded request to a request handler and encode a reply.
pub async fn dispatch_one<H>(
    handler: &H,
    request: InboundRequest,
) -> Result<Option<OutboundReply>, ServerError>
where
    H: RequestHandler,
{
    match handler
        .handle(&request.subject, request.payload, request.context)
        .await
    {
        Ok(payload) => Ok(request
            .reply_to
            .map(|reply_to| encode_success_reply(reply_to, payload))),
        Err(error) => match request.reply_to {
            Some(reply_to) => Ok(Some(encode_error_reply(reply_to, &error))),
            None => Err(error),
        },
    }
}

async fn publish_reply(
    client: &async_nats::Client,
    reply: OutboundReply,
) -> Result<(), ServerError> {
    if reply.is_error {
        let mut headers = HeaderMap::new();
        headers.insert("status", "error");
        client
            .publish_with_headers(reply.reply_to, headers, reply.payload)
            .await
            .map_err(|error| ServerError::Nats(error.to_string()))?;
        return Ok(());
    }

    client
        .publish(reply.reply_to, reply.payload)
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;
    Ok(())
}

/// Run an inbound NATS request loop until the subscriber closes.
pub async fn run_nats_request_loop<H>(
    client: async_nats::Client,
    mut subscriber: async_nats::Subscriber,
    handler: H,
) -> Result<(), ServerError>
where
    H: RequestHandler,
{
    while let Some(message) = subscriber.next().await {
        let request = decode_nats_request(&message);
        match dispatch_one(&handler, request).await {
            Ok(Some(reply)) => publish_reply(&client, reply).await?,
            Ok(None) => {}
            Err(_) => {}
        }
    }

    Ok(())
}
