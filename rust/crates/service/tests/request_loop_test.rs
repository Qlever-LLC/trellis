use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::future::{BoxFuture, FutureExt};
use trellis_service::{
    dispatch_one, InboundRequest, OutboundReply, RequestContext, RequestHandler, ServerError,
};

#[derive(Clone)]
struct RecordingHandler {
    result: Arc<dyn Fn() -> Result<Bytes, ServerError> + Send + Sync>,
    seen: Arc<Mutex<Vec<(String, Bytes, RequestContext)>>>,
}

impl RecordingHandler {
    #[allow(clippy::result_large_err)]
    fn allow(payload: &str) -> Self {
        Self {
            result: Arc::new({
                let payload = payload.to_string();
                move || Ok(Bytes::from(payload.clone()))
            }),
            seen: Arc::new(Mutex::new(Vec::new())),
        }
    }

    #[allow(clippy::result_large_err)]
    fn deny_request(subject: &str, session_key: &str) -> Self {
        Self {
            result: Arc::new({
                let subject = subject.to_string();
                let session_key = session_key.to_string();
                move || {
                    Err(ServerError::RequestDenied {
                        subject: subject.clone(),
                        session_key: session_key.clone(),
                    })
                }
            }),
            seen: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn panic(message: &str) -> Self {
        Self {
            result: Arc::new({
                let message = message.to_string();
                move || panic!("{message}")
            }),
            seen: Arc::new(Mutex::new(Vec::new())),
        }
    }

    #[allow(clippy::result_large_err)]
    fn declared_error() -> Self {
        Self {
            result: Arc::new(|| {
                Err(ServerError::DeclaredRpc(
                    trellis_service::DeclaredRpcError::new(
                        "NotFoundError",
                        "Workspace not found",
                        [("resource", serde_json::json!("Workspace"))],
                    ),
                ))
            }),
            seen: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl RequestHandler for RecordingHandler {
    fn handle<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Bytes, ServerError>> {
        self.seen
            .lock()
            .expect("lock seen")
            .push((subject.to_string(), payload, context));
        let result = Arc::clone(&self.result);
        async move { result() }.boxed()
    }
}

fn request(reply_to: Option<&str>) -> InboundRequest {
    InboundRequest {
        subject: "rpc.v1.Jobs.Health".to_string(),
        payload: Bytes::from_static(b"{}"),
        reply_to: reply_to.map(ToString::to_string),
        context: RequestContext {
            subject: "rpc.v1.Jobs.Health".to_string(),
            session_key: Some("svc_session".to_string()),
            proof: Some("proof".to_string()),
            iat: None,
            request_id: None,
            required_capabilities: None,
            reply_to: reply_to.map(ToString::to_string),
            caller: None,
            traceparent: None,
            tracestate: None,
        },
    }
}

#[tokio::test]
async fn dispatch_one_passes_subject_payload_and_context_to_handler() {
    let handler = RecordingHandler::allow("ok");
    let incoming = request(Some("_INBOX.1"));

    let _ = dispatch_one(&handler, incoming)
        .await
        .expect("dispatch success");

    let seen = handler.seen.lock().expect("lock seen");
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].0, "rpc.v1.Jobs.Health");
    assert_eq!(seen[0].1, Bytes::from_static(b"{}"));
    assert_eq!(seen[0].2.session_key.as_deref(), Some("svc_session"));
    assert_eq!(seen[0].2.proof.as_deref(), Some("proof"));
}

#[tokio::test]
async fn dispatch_one_returns_success_reply_when_handler_succeeds() {
    let handler = RecordingHandler::allow("{\"status\":\"ok\"}");
    let incoming = request(Some("_INBOX.1"));

    let reply = dispatch_one(&handler, incoming)
        .await
        .expect("dispatch success")
        .expect("reply should be present");

    assert_eq!(
        reply,
        OutboundReply {
            reply_to: "_INBOX.1".to_string(),
            payload: Bytes::from("{\"status\":\"ok\"}"),
            is_error: false,
        }
    );
}

#[tokio::test]
async fn dispatch_one_returns_error_reply_when_handler_fails() {
    let handler = RecordingHandler::deny_request("rpc.v1.Jobs.Health", "svc_session");
    let incoming = request(Some("_INBOX.1"));

    let reply = dispatch_one(&handler, incoming)
        .await
        .expect("dispatch should emit error reply")
        .expect("reply should be present");

    assert!(reply.is_error);
    assert_eq!(reply.reply_to, "_INBOX.1");

    let body: serde_json::Value =
        serde_json::from_slice(&reply.payload).expect("error payload should be JSON");
    assert!(body["id"].as_str().is_some_and(|value| !value.is_empty()));
    assert_eq!(body["type"], "UnexpectedError");
    assert_eq!(body["message"], "An unexpected error has occurred");
    assert_eq!(
        body["context"]["causeMessage"],
        "request denied for subject 'rpc.v1.Jobs.Health' and session 'svc_session'"
    );
}

#[tokio::test]
async fn dispatch_one_returns_declared_rpc_error_directly() {
    let handler = RecordingHandler::declared_error();
    let incoming = request(Some("_INBOX.1"));

    let reply = dispatch_one(&handler, incoming)
        .await
        .expect("dispatch should emit error reply")
        .expect("reply should be present");

    assert!(reply.is_error);
    let body: serde_json::Value =
        serde_json::from_slice(&reply.payload).expect("error payload should be JSON");
    assert!(body["id"].as_str().is_some_and(|value| !value.is_empty()));
    assert_eq!(body["type"], "NotFoundError");
    assert_eq!(body["message"], "Workspace not found");
    assert_eq!(body["resource"], "Workspace");
}

#[tokio::test]
async fn dispatch_one_skips_reply_when_reply_to_missing() {
    let handler = RecordingHandler::allow("ok");
    let incoming = request(None);

    let reply = dispatch_one(&handler, incoming)
        .await
        .expect("dispatch success");
    assert_eq!(reply, None);
}

#[tokio::test]
async fn dispatch_one_converts_handler_panic_to_error_reply() {
    let handler = RecordingHandler::panic("object store timed out");
    let incoming = request(Some("_INBOX.1"));

    let reply = dispatch_one(&handler, incoming)
        .await
        .expect("dispatch should survive panic")
        .expect("reply should be present");

    assert!(reply.is_error);
    let body: serde_json::Value =
        serde_json::from_slice(&reply.payload).expect("error payload should be JSON");
    assert_eq!(body["type"], "UnexpectedError");
    assert!(body["context"]["causeMessage"]
        .as_str()
        .is_some_and(|value| value.contains("request handler panicked")));
}
