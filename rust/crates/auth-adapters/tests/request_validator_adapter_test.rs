use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use serde_json::json;
use trellis_auth_adapters::request_validator::{
    make_validate_request, payload_hash_base64url, AuthRequestValidatorAdapter,
    AuthRequestValidatorClientPort,
};
use trellis_rs::client::{RpcErrorPayload, TrellisClientError};
use trellis_rs::sdk::auth::types::{AuthRequestsValidateRequest, AuthRequestsValidateResponse};
use trellis_rs::service::{RequestContext, RequestValidator, ServerError};

#[test]
fn payload_hash_base64url_hashes_payload_bytes() {
    let payload = [0x00, 0x9f, 0xff, 0x01];

    let hash = payload_hash_base64url(&payload);

    assert_eq!(hash, "knMGVlNQY5oQl6MLhcp06mehwDcBkseOAr0gMdwlCyw");
}

#[test]
fn make_validate_request_maps_subject_session_proof_and_hash() {
    let context = RequestContext {
        subject: "rpc.v1.Ignored".to_string(),
        session_key: Some("svc_session".to_string()),
        proof: Some("proof_b64url".to_string()),
        iat: Some(123),
        request_id: Some("request-1".to_string()),
        required_capabilities: Some(vec!["jobs.read".to_string()]),
        reply_to: None,
        caller: None,
        traceparent: None,
        tracestate: None,
    };

    let request = make_validate_request("rpc.v1.Ping", b"{\"a\":1}\n", &context)
        .expect("request should be built");

    assert_eq!(request.subject, "rpc.v1.Ping");
    assert_eq!(request.session_key, "svc_session");
    assert_eq!(request.proof, "proof_b64url");
    assert_eq!(
        request.payload_hash,
        "40ZDICGwQXlRjZYU81YMzXE1Sk7hAd3LiT1pWanWMBw"
    );
    assert_eq!(request.capabilities, Some(vec!["jobs.read".to_string()]));
    assert_eq!(request.iat, 123);
    assert_eq!(request.request_id, "request-1");
}

struct FakeAuthValidateClient {
    results: Mutex<VecDeque<Result<AuthRequestsValidateResponse, TrellisClientError>>>,
    seen_requests: Arc<Mutex<Vec<AuthRequestsValidateRequest>>>,
}

impl AuthRequestValidatorClientPort for FakeAuthValidateClient {
    fn auth_validate_request<'a>(
        &'a self,
        input: &'a AuthRequestsValidateRequest,
    ) -> BoxFuture<'a, Result<AuthRequestsValidateResponse, TrellisClientError>> {
        self.seen_requests
            .lock()
            .expect("lock seen requests")
            .push(input.clone());
        let result = self
            .results
            .lock()
            .expect("lock results")
            .pop_front()
            .expect("result should be set");
        ready(result).boxed()
    }
}

fn fake_client(
    results: impl Into<VecDeque<Result<AuthRequestsValidateResponse, TrellisClientError>>>,
    seen_requests: Arc<Mutex<Vec<AuthRequestsValidateRequest>>>,
) -> FakeAuthValidateClient {
    FakeAuthValidateClient {
        results: Mutex::new(results.into()),
        seen_requests,
    }
}

fn auth_error(reason: &str) -> TrellisClientError {
    TrellisClientError::RpcError(RpcErrorPayload::from_value(json!({
        "id": "test-error",
        "type": "AuthError",
        "message": format!("Auth failed: {reason}"),
        "reason": reason,
    })))
}

fn allowed_response(allowed: bool) -> AuthRequestsValidateResponse {
    AuthRequestsValidateResponse {
        allowed,
        caller: json!({
            "type": "service",
            "id": "svc-user",
            "name": "Service",
            "active": true,
            "capabilities": ["service"],
        }),
        inbox_prefix: "_INBOX.test".to_string(),
    }
}

#[tokio::test]
async fn adapter_validate_calls_auth_and_returns_allowed() {
    let seen_requests = Arc::new(Mutex::new(Vec::new()));
    let adapter = AuthRequestValidatorAdapter::new(fake_client(
        [Ok(allowed_response(true))],
        Arc::clone(&seen_requests),
    ));
    let context = RequestContext {
        subject: "rpc.v1.Ignored".to_string(),
        session_key: Some("svc_session".to_string()),
        proof: Some("proof_b64url".to_string()),
        iat: Some(123),
        request_id: Some("request-1".to_string()),
        required_capabilities: None,
        reply_to: None,
        caller: None,
        traceparent: None,
        tracestate: None,
    };

    let validation = adapter
        .validate("rpc.v1.Ping", &Bytes::from_static(br#"{"a":1}"#), &context)
        .await
        .expect("validation request should succeed");

    assert!(validation.allowed);
    assert_eq!(validation.caller, Some(allowed_response(true).caller));

    let seen = seen_requests.lock().expect("lock seen requests");
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].subject, "rpc.v1.Ping");
    assert_eq!(seen[0].session_key, "svc_session");
    assert_eq!(seen[0].proof, "proof_b64url");
    assert_eq!(seen[0].capabilities, None);
    assert_eq!(seen[0].iat, 123);
    assert_eq!(seen[0].request_id, "request-1");
}

#[tokio::test]
async fn adapter_validate_maps_client_error_to_server_error() {
    let adapter = AuthRequestValidatorAdapter::new(fake_client(
        [Err(TrellisClientError::Timeout)],
        Arc::new(Mutex::new(Vec::new())),
    ));
    let context = RequestContext {
        subject: "rpc.v1.Ignored".to_string(),
        session_key: Some("svc_session".to_string()),
        proof: Some("proof_b64url".to_string()),
        iat: None,
        request_id: None,
        required_capabilities: None,
        reply_to: None,
        caller: None,
        traceparent: None,
        tracestate: None,
    };

    let result = adapter
        .validate("rpc.v1.Ping", &Bytes::from_static(br#"{"a":1}"#), &context)
        .await;

    assert!(matches!(
        result,
        Err(ServerError::Nats(message)) if message.contains("Auth.Requests.Validate")
    ));
}

#[tokio::test]
async fn adapter_validate_retries_transient_session_not_found_once_then_succeeds() {
    let seen_requests = Arc::new(Mutex::new(Vec::new()));
    let adapter = AuthRequestValidatorAdapter::new(fake_client(
        [
            Err(auth_error("session_not_found")),
            Ok(allowed_response(true)),
        ],
        Arc::clone(&seen_requests),
    ));
    let context = RequestContext {
        subject: "rpc.v1.Ignored".to_string(),
        session_key: Some("svc_session".to_string()),
        proof: Some("proof_b64url".to_string()),
        iat: None,
        request_id: None,
        required_capabilities: None,
        reply_to: None,
        caller: None,
        traceparent: None,
        tracestate: None,
    };

    let validation = adapter
        .validate("rpc.v1.Ping", &Bytes::from_static(br#"{"a":1}"#), &context)
        .await
        .expect("validation should succeed after retry");

    assert!(validation.allowed);
    assert_eq!(seen_requests.lock().expect("lock seen requests").len(), 2);
}

#[tokio::test]
async fn adapter_validate_does_not_retry_non_transient_auth_error() {
    let seen_requests = Arc::new(Mutex::new(Vec::new()));
    let adapter = AuthRequestValidatorAdapter::new(fake_client(
        [
            Err(auth_error("invalid_signature")),
            Ok(allowed_response(true)),
        ],
        Arc::clone(&seen_requests),
    ));
    let context = RequestContext {
        subject: "rpc.v1.Ignored".to_string(),
        session_key: Some("svc_session".to_string()),
        proof: Some("proof_b64url".to_string()),
        iat: None,
        request_id: None,
        required_capabilities: None,
        reply_to: None,
        caller: None,
        traceparent: None,
        tracestate: None,
    };

    let result = adapter
        .validate("rpc.v1.Ping", &Bytes::from_static(br#"{"a":1}"#), &context)
        .await;

    assert!(matches!(
        result,
        Err(ServerError::Nats(message)) if message.contains("invalid_signature")
    ));
    assert_eq!(seen_requests.lock().expect("lock seen requests").len(), 1);
}
