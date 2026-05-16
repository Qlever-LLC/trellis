use async_nats::header::HeaderMap;
use bytes::Bytes;
use futures_util::future::BoxFuture;
use futures_util::stream::FuturesUnordered;
use futures_util::{FutureExt, Stream, StreamExt};

use std::any::Any;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{AuthenticatedRouter, RequestContext, RequestValidator, Router, ServerError};

static ERROR_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

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

pub type ResponseStream = Pin<Box<dyn Stream<Item = Result<Bytes, ServerError>> + Send>>;

pub enum HandlerResponse {
    Frames(Vec<Bytes>),
    Error(Bytes),
    Stream(ResponseStream),
    FeedStream(ResponseStream),
}

/// Async request handler trait used by host request loops.
pub trait RequestHandler: Send + Sync {
    fn handle<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Bytes, ServerError>>;

    fn handle_frames<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Vec<Bytes>, ServerError>> {
        Box::pin(async move {
            match self.handle_response(subject, payload, context).await? {
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
        })
    }

    fn handle_response<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<HandlerResponse, ServerError>> {
        Box::pin(async move {
            Ok(HandlerResponse::Frames(vec![
                self.handle(subject, payload, context).await?,
            ]))
        })
    }
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

    fn handle_frames<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Vec<Bytes>, ServerError>> {
        Box::pin(async move { self.handle_request_frames(subject, payload, context).await })
    }

    fn handle_response<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<HandlerResponse, ServerError>> {
        Box::pin(async move {
            self.handle_request_response(subject, payload, context)
                .await
        })
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

    fn handle_frames<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Vec<Bytes>, ServerError>> {
        Box::pin(async move { self.handle_request_frames(subject, payload, context).await })
    }

    fn handle_response<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<HandlerResponse, ServerError>> {
        Box::pin(async move {
            self.handle_request_response(subject, payload, context)
                .await
        })
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
    let traceparent = message
        .headers
        .as_ref()
        .and_then(|headers| headers.get("traceparent"))
        .map(|value| value.as_str().to_string());
    let tracestate = message
        .headers
        .as_ref()
        .and_then(|headers| headers.get("tracestate"))
        .map(|value| value.as_str().to_string());

    InboundRequest {
        subject: subject.clone(),
        payload: message.payload.clone(),
        reply_to: reply_to.clone(),
        context: RequestContext {
            subject,
            session_key,
            proof,
            reply_to: reply_to.clone(),
            caller: None,
            traceparent,
            tracestate,
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
    if let ServerError::DeclaredRpc(error) = error {
        let payload = serde_json::to_vec(&error.to_payload(error_id())).unwrap_or_else(|_| {
            br#"{"id":"rust-server-error","type":"UnexpectedError","message":"An unexpected error has occurred"}"#.to_vec()
        });
        return OutboundReply {
            reply_to,
            payload: Bytes::from(payload),
            is_error: true,
        };
    }

    #[derive(serde::Serialize)]
    struct ErrorPayload<'a> {
        id: String,
        r#type: &'static str,
        message: &'static str,
        context: ErrorContext<'a>,
    }

    #[derive(serde::Serialize)]
    struct ErrorContext<'a> {
        #[serde(rename = "causeMessage")]
        cause_message: &'a str,
    }

    let error_message = error.to_string();
    let payload = match serde_json::to_vec(&ErrorPayload {
        id: error_id(),
        r#type: "UnexpectedError",
        message: "An unexpected error has occurred",
        context: ErrorContext {
            cause_message: &error_message,
        },
    }) {
        Ok(value) => Bytes::from(value),
        Err(_) => Bytes::from_static(
            br#"{"id":"rust-server-error","type":"UnexpectedError","message":"An unexpected error has occurred"}"#,
        ),
    };

    OutboundReply {
        reply_to,
        payload,
        is_error: true,
    }
}

fn error_id() -> String {
    let sequence = ERROR_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    format!("rust-server-error-{timestamp}-{sequence}")
}

/// Dispatch one decoded request to a request handler and encode a reply.
pub async fn dispatch_one<H>(
    handler: &H,
    request: InboundRequest,
) -> Result<Option<OutboundReply>, ServerError>
where
    H: RequestHandler,
{
    Ok(dispatch_all(handler, request)
        .await?
        .and_then(|mut replies| {
            if replies.is_empty() {
                None
            } else {
                Some(replies.remove(0))
            }
        }))
}

/// Dispatch one decoded request to a request handler and encode all replies.
pub async fn dispatch_all<H>(
    handler: &H,
    request: InboundRequest,
) -> Result<Option<Vec<OutboundReply>>, ServerError>
where
    H: RequestHandler,
{
    let reply_to = request.reply_to;
    let result =
        AssertUnwindSafe(handler.handle_frames(&request.subject, request.payload, request.context))
            .catch_unwind()
            .await;

    match result {
        Ok(Ok(payloads)) => Ok(reply_to.map(|reply_to| {
            payloads
                .into_iter()
                .map(|payload| encode_success_reply(reply_to.clone(), payload))
                .collect()
        })),
        Ok(Err(error)) => match reply_to {
            Some(reply_to) => Ok(Some(vec![encode_error_reply(reply_to, &error)])),
            None => Err(error),
        },
        Err(panic) => {
            let error = panic_to_server_error(panic);
            match reply_to {
                Some(reply_to) => Ok(Some(vec![encode_error_reply(reply_to, &error)])),
                None => Err(error),
            }
        }
    }
}

pub async fn dispatch_response<H>(
    handler: &H,
    request: InboundRequest,
) -> Result<Option<(String, HandlerResponse)>, ServerError>
where
    H: RequestHandler,
{
    let reply_to = request.reply_to;
    let result = AssertUnwindSafe(handler.handle_response(
        &request.subject,
        request.payload,
        request.context,
    ))
    .catch_unwind()
    .await;

    let Some(reply_to) = reply_to else {
        return match result {
            Ok(Ok(_)) => Ok(None),
            Ok(Err(error)) => Err(error),
            Err(panic) => Err(panic_to_server_error(panic)),
        };
    };

    match result {
        Ok(Ok(response)) => Ok(Some((reply_to, response))),
        Ok(Err(error)) => Ok(Some((
            reply_to.clone(),
            HandlerResponse::Error(encode_error_reply(reply_to, &error).payload),
        ))),
        Err(panic) => {
            let error = panic_to_server_error(panic);
            Ok(Some((
                reply_to.clone(),
                HandlerResponse::Error(encode_error_reply(reply_to, &error).payload),
            )))
        }
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

async fn flush_replies(client: &async_nats::Client) -> Result<(), ServerError> {
    client
        .flush()
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))
}

async fn publish_response(
    client: &async_nats::Client,
    reply_to: String,
    response: HandlerResponse,
) -> Result<(), ServerError> {
    match response {
        HandlerResponse::Frames(frames) => {
            for payload in frames {
                publish_reply(client, encode_success_reply(reply_to.clone(), payload)).await?;
            }
        }
        HandlerResponse::Error(payload) => {
            let reply = OutboundReply {
                reply_to,
                payload,
                is_error: true,
            };
            publish_reply(client, reply).await?;
        }
        HandlerResponse::Stream(mut stream) => loop {
            let frame = AssertUnwindSafe(stream.next()).catch_unwind().await;
            match frame {
                Ok(Some(Ok(payload))) => {
                    publish_reply(client, encode_success_reply(reply_to.clone(), payload)).await?;
                    flush_replies(client).await?;
                }
                Ok(Some(Err(error))) => {
                    publish_reply(client, encode_error_reply(reply_to.clone(), &error)).await?;
                    flush_replies(client).await?;
                    break;
                }
                Ok(None) => break,
                Err(panic) => {
                    let error = panic_to_server_error(panic);
                    publish_reply(client, encode_error_reply(reply_to.clone(), &error)).await?;
                    flush_replies(client).await?;
                    break;
                }
            }
        },
        HandlerResponse::FeedStream(mut stream) => {
            let mut headers = HeaderMap::new();
            headers.insert("feed-status", "ready");
            client
                .publish_with_headers(reply_to.clone(), headers, Bytes::new())
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            flush_replies(client).await?;

            loop {
                let frame = AssertUnwindSafe(stream.next()).catch_unwind().await;
                match frame {
                    Ok(Some(Ok(payload))) => {
                        publish_reply(client, encode_success_reply(reply_to.clone(), payload))
                            .await?;
                        flush_replies(client).await?;
                    }
                    Ok(Some(Err(error))) => {
                        publish_reply(client, encode_error_reply(reply_to.clone(), &error)).await?;
                        flush_replies(client).await?;
                        break;
                    }
                    Ok(None) => break,
                    Err(panic) => {
                        let error = panic_to_server_error(panic);
                        publish_reply(client, encode_error_reply(reply_to.clone(), &error)).await?;
                        flush_replies(client).await?;
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}

fn panic_to_server_error(panic: Box<dyn Any + Send>) -> ServerError {
    let message = panic
        .downcast_ref::<&str>()
        .map(|value| (*value).to_string())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "request handler panicked".to_string());
    ServerError::Nats(format!("request handler panicked: {message}"))
}

/// Run an inbound NATS request loop until the subscriber closes.
pub async fn run_nats_request_loop<H>(
    client: async_nats::Client,
    subscriber: impl futures_util::Stream<Item = async_nats::Message>,
    handler: H,
) -> Result<(), ServerError>
where
    H: RequestHandler,
{
    let mut subscriber = Box::pin(subscriber);

    let mut in_flight = FuturesUnordered::new();
    loop {
        tokio::select! {
            message = subscriber.next() => {
                let Some(message) = message else {
                    break;
                };
                let request = decode_nats_request(&message);
                let client = &client;
                let handler = &handler;
                in_flight.push(async move {
                    match dispatch_response(handler, request).await {
                        Ok(Some((reply_to, response))) => publish_response(client, reply_to, response).await?,
                        Ok(None) => {}
                        Err(_) => {}
                    }
                    Ok::<(), ServerError>(())
                });
            }
            result = in_flight.next(), if !in_flight.is_empty() => {
                if let Some(result) = result {
                    result?;
                }
            }
        }
    }

    while let Some(result) = in_flight.next().await {
        result?;
    }

    Ok(())
}
