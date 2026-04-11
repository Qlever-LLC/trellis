use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use serde::{Deserialize, Serialize};
use trellis_server::{
    AuthenticatedRouter, RequestContext, RequestValidator, Router, RpcDescriptor, ServerError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PingInput {
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PingOutput {
    echoed: String,
}

struct PingRpc;

impl RpcDescriptor for PingRpc {
    type Input = PingInput;
    type Output = PingOutput;
    const KEY: &'static str = "Ping";
    const SUBJECT: &'static str = "rpc.v1.Ping";
}

#[derive(Clone)]
struct StubValidator {
    allowed: bool,
    calls: Arc<AtomicUsize>,
}

impl StubValidator {
    fn new(allowed: bool) -> Self {
        Self {
            allowed,
            calls: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn call_count(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl RequestValidator for StubValidator {
    fn validate<'a>(
        &'a self,
        _subject: &'a str,
        _payload: &'a Bytes,
        _context: &'a RequestContext,
    ) -> BoxFuture<'a, Result<bool, ServerError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        ready(Ok(self.allowed)).boxed()
    }
}

fn build_router(handler_called: Arc<AtomicBool>) -> Router {
    let mut router = Router::new();
    router.register_rpc::<PingRpc, _, _>(move |_ctx, input| {
        let handler_called = Arc::clone(&handler_called);
        async move {
            handler_called.store(true, Ordering::SeqCst);
            Ok(PingOutput {
                echoed: input.value,
            })
        }
    });
    router
}

fn ping_payload(value: &str) -> Bytes {
    Bytes::from(
        serde_json::to_vec(&PingInput {
            value: value.to_string(),
        })
        .expect("serialize ping payload"),
    )
}

#[tokio::test]
async fn authenticated_router_rejects_missing_session_key_before_validation() {
    let handler_called = Arc::new(AtomicBool::new(false));
    let validator = StubValidator::new(true);
    let router = build_router(Arc::clone(&handler_called));
    let auth_router = AuthenticatedRouter::new(router, validator.clone());

    let result = auth_router
        .handle_request(
            PingRpc::SUBJECT,
            ping_payload("hello"),
            RequestContext {
                subject: PingRpc::SUBJECT.to_string(),
                session_key: None,
                proof: Some("proof".to_string()),
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(ServerError::MissingSessionKey { subject }) if subject == PingRpc::SUBJECT
    ));
    assert_eq!(validator.call_count(), 0);
    assert!(!handler_called.load(Ordering::SeqCst));
}

#[tokio::test]
async fn authenticated_router_rejects_request_when_validator_denies() {
    let handler_called = Arc::new(AtomicBool::new(false));
    let validator = StubValidator::new(false);
    let router = build_router(Arc::clone(&handler_called));
    let auth_router = AuthenticatedRouter::new(router, validator.clone());

    let result = auth_router
        .handle_request(
            PingRpc::SUBJECT,
            ping_payload("hello"),
            RequestContext {
                subject: PingRpc::SUBJECT.to_string(),
                session_key: Some("svc_session".to_string()),
                proof: Some("proof".to_string()),
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(ServerError::RequestDenied {
            subject,
            session_key,
        }) if subject == PingRpc::SUBJECT && session_key == "svc_session"
    ));
    assert_eq!(validator.call_count(), 1);
    assert!(!handler_called.load(Ordering::SeqCst));
}

#[tokio::test]
async fn authenticated_router_dispatches_to_inner_router_when_validator_allows() {
    let handler_called = Arc::new(AtomicBool::new(false));
    let validator = StubValidator::new(true);
    let router = build_router(Arc::clone(&handler_called));
    let auth_router = AuthenticatedRouter::new(router, validator.clone());

    let response = auth_router
        .handle_request(
            PingRpc::SUBJECT,
            ping_payload("hello"),
            RequestContext {
                subject: PingRpc::SUBJECT.to_string(),
                session_key: Some("svc_session".to_string()),
                proof: Some("proof".to_string()),
            },
        )
        .await
        .expect("request should pass auth and dispatch");

    assert_eq!(validator.call_count(), 1);
    assert!(handler_called.load(Ordering::SeqCst));

    let payload: PingOutput = serde_json::from_slice(&response).expect("decode response payload");
    assert_eq!(
        payload,
        PingOutput {
            echoed: "hello".to_string(),
        }
    );
}
