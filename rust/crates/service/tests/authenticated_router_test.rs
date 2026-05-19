use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use serde::{Deserialize, Serialize};
use trellis_service::{
    AuthenticatedRouter, OperationDescriptor, RequestContext, RequestValidation, RequestValidator,
    Router, RpcDescriptor, ServerError,
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

struct CapRpc;

impl RpcDescriptor for CapRpc {
    type Input = PingInput;
    type Output = PingOutput;
    const KEY: &'static str = "Cap.Ping";
    const SUBJECT: &'static str = "rpc.v1.Cap.Ping";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["rpc.call"];
}

struct CapOperation;

impl OperationDescriptor for CapOperation {
    type Input = PingInput;
    type Progress = PingOutput;
    type Output = PingOutput;

    const KEY: &'static str = "Cap.Operation";
    const SUBJECT: &'static str = "operations.v1.Cap.Operation";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["operation.call"];
    const READ_CAPABILITIES: &'static [&'static str] = &["operation.read"];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &["operation.cancel"];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &["operation.control"];
    const CANCELABLE: bool = true;
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
    ) -> BoxFuture<'a, Result<RequestValidation, ServerError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        ready(Ok(if self.allowed {
            RequestValidation::allowed()
        } else {
            RequestValidation::denied()
        }))
        .boxed()
    }
}

#[derive(Clone, Default)]
struct RecordingValidator {
    capabilities: Arc<Mutex<Vec<Option<Vec<String>>>>>,
}

impl RequestValidator for RecordingValidator {
    fn validate<'a>(
        &'a self,
        _subject: &'a str,
        _payload: &'a Bytes,
        context: &'a RequestContext,
    ) -> BoxFuture<'a, Result<RequestValidation, ServerError>> {
        self.capabilities
            .lock()
            .expect("lock recorded capabilities")
            .push(context.required_capabilities.clone());
        ready(Ok(RequestValidation::allowed())).boxed()
    }
}

fn auth_context(subject: &str) -> RequestContext {
    RequestContext {
        subject: subject.to_string(),
        session_key: Some("abcdefghijklmnop-session".to_string()),
        proof: Some("proof".to_string()),
        iat: None,
        request_id: None,
        required_capabilities: None,
        reply_to: None,
        caller: None,
        traceparent: None,
        tracestate: None,
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
                iat: None,
                request_id: None,
                required_capabilities: None,
                reply_to: None,
                caller: None,
                traceparent: None,
                tracestate: None,
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
                iat: None,
                request_id: None,
                required_capabilities: None,
                reply_to: None,
                caller: None,
                traceparent: None,
                tracestate: None,
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
async fn authenticated_router_forwards_descriptor_capabilities_to_validator() {
    let mut router = Router::new();
    router.register_rpc::<CapRpc, _, _>(|_ctx, input| async move {
        Ok(PingOutput {
            echoed: input.value,
        })
    });
    let validator = RecordingValidator::default();
    let recorded = Arc::clone(&validator.capabilities);
    let auth_router = AuthenticatedRouter::new(router, validator);

    auth_router
        .handle_request(
            CapRpc::SUBJECT,
            ping_payload("hello"),
            auth_context(CapRpc::SUBJECT),
        )
        .await
        .expect("request should pass auth");

    assert_eq!(
        *recorded.lock().expect("lock recorded capabilities"),
        vec![Some(vec!["rpc.call".to_string()])]
    );
}

#[tokio::test]
async fn authenticated_router_uses_action_specific_operation_control_capabilities() {
    let mut router = Router::new();
    router.register_operation::<CapOperation, _, _, _, _, _, _, _, _>(
        |_ctx, _input| async move {
            Ok(trellis_service::AcceptedOperation {
                kind: "accepted".to_string(),
                operation_ref: trellis_service::OperationRefData {
                    id: "op_1".to_string(),
                    service: "cap".to_string(),
                    operation: CapOperation::KEY.to_string(),
                },
                snapshot: trellis_service::OperationSnapshot::default(),
                transfer: None,
            })
        },
        |_ctx, _operation_id| async move { Ok(trellis_service::OperationSnapshot::default()) },
        |_ctx, _operation_id| async move {
            Ok(trellis_service::OperationSnapshot {
                state: trellis_service::OperationState::Completed,
                ..trellis_service::OperationSnapshot::default()
            })
        },
        |_ctx, _operation_id| async move { Ok(trellis_service::OperationSnapshot::default()) },
    );
    let validator = RecordingValidator::default();
    let recorded = Arc::clone(&validator.capabilities);
    let auth_router = AuthenticatedRouter::new(router, validator);
    let control_subject = trellis_service::control_subject(CapOperation::SUBJECT);

    for action in ["get", "wait", "watch", "cancel"] {
        let payload = Bytes::from(
            serde_json::to_vec(&serde_json::json!({ "action": action, "operationId": "op_1" }))
                .expect("serialize operation control request"),
        );
        auth_router
            .handle_request_response(&control_subject, payload, auth_context(&control_subject))
            .await
            .expect("operation control should pass auth");
    }

    assert_eq!(
        *recorded.lock().expect("lock recorded capabilities"),
        vec![
            Some(vec!["operation.read".to_string()]),
            Some(vec!["operation.read".to_string()]),
            Some(vec!["operation.read".to_string()]),
            Some(vec!["operation.cancel".to_string()]),
        ]
    );
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
                iat: None,
                request_id: None,
                required_capabilities: None,
                reply_to: None,
                caller: None,
                traceparent: None,
                tracestate: None,
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

#[tokio::test]
async fn authenticated_router_rejects_mismatched_reply_inbox() {
    let handler_called = Arc::new(AtomicBool::new(false));
    let validator = StubValidator::new(true);
    let router = build_router(Arc::clone(&handler_called));
    let auth_router = AuthenticatedRouter::new(router, validator.clone());
    let session_key = "abcdefghijklmnop-session";

    let result = auth_router
        .handle_request_response(
            PingRpc::SUBJECT,
            ping_payload("hello"),
            RequestContext {
                subject: PingRpc::SUBJECT.to_string(),
                session_key: Some(session_key.to_string()),
                proof: Some("proof".to_string()),
                iat: None,
                request_id: None,
                required_capabilities: None,
                reply_to: Some("_INBOX.someone_else.1".to_string()),
                caller: None,
                traceparent: None,
                tracestate: None,
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(ServerError::ReplyInboxMismatch {
            subject,
            session_key: rejected_session,
            reply_to,
        }) if subject == PingRpc::SUBJECT
            && rejected_session == session_key
            && reply_to == "_INBOX.someone_else.1"
    ));
    assert_eq!(validator.call_count(), 1);
    assert!(!handler_called.load(Ordering::SeqCst));
}
