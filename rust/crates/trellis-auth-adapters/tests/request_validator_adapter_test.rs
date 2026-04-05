use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use trellis_auth::{
    AuthValidateRequestRequest, AuthValidateRequestResponse, AuthValidateRequestResponseUser,
};
use trellis_auth_adapters::request_validator::{
    make_validate_request, payload_hash_base64url, AuthRequestValidatorAdapter,
    AuthRequestValidatorClientPort,
};
use trellis_client::TrellisClientError;
use trellis_server::{RequestContext, RequestValidator, ServerError};

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
    assert_eq!(request.capabilities, None);
}

struct FakeAuthValidateClient {
    result: Mutex<Option<Result<AuthValidateRequestResponse, TrellisClientError>>>,
    seen_requests: Arc<Mutex<Vec<AuthValidateRequestRequest>>>,
}

impl AuthRequestValidatorClientPort for FakeAuthValidateClient {
    fn auth_validate_request<'a>(
        &'a self,
        input: &'a AuthValidateRequestRequest,
    ) -> BoxFuture<'a, Result<AuthValidateRequestResponse, TrellisClientError>> {
        self.seen_requests
            .lock()
            .expect("lock seen requests")
            .push(input.clone());
        let result = self
            .result
            .lock()
            .expect("lock result")
            .take()
            .expect("result should be set");
        ready(result).boxed()
    }
}

fn allowed_response(allowed: bool) -> AuthValidateRequestResponse {
    AuthValidateRequestResponse {
        allowed,
        user: AuthValidateRequestResponseUser {
            active: true,
            email: "service@qlever.ai".to_string(),
            id: "svc-user".to_string(),
            name: "Service".to_string(),
            origin: "service".to_string(),
        },
    }
}

#[tokio::test]
async fn adapter_validate_calls_auth_and_returns_allowed() {
    let seen_requests = Arc::new(Mutex::new(Vec::new()));
    let adapter = AuthRequestValidatorAdapter::new(FakeAuthValidateClient {
        result: Mutex::new(Some(Ok(allowed_response(true)))),
        seen_requests: Arc::clone(&seen_requests),
    });
    let context = RequestContext {
        subject: "rpc.v1.Ignored".to_string(),
        session_key: Some("svc_session".to_string()),
        proof: Some("proof_b64url".to_string()),
    };

    let allowed = adapter
        .validate("rpc.v1.Ping", &Bytes::from_static(br#"{"a":1}"#), &context)
        .await
        .expect("validation request should succeed");

    assert!(allowed);

    let seen = seen_requests.lock().expect("lock seen requests");
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].subject, "rpc.v1.Ping");
    assert_eq!(seen[0].session_key, "svc_session");
    assert_eq!(seen[0].proof, "proof_b64url");
}

#[tokio::test]
async fn adapter_validate_maps_client_error_to_server_error() {
    let adapter = AuthRequestValidatorAdapter::new(FakeAuthValidateClient {
        result: Mutex::new(Some(Err(TrellisClientError::Timeout))),
        seen_requests: Arc::new(Mutex::new(Vec::new())),
    });
    let context = RequestContext {
        subject: "rpc.v1.Ignored".to_string(),
        session_key: Some("svc_session".to_string()),
        proof: Some("proof_b64url".to_string()),
    };

    let result = adapter
        .validate("rpc.v1.Ping", &Bytes::from_static(br#"{"a":1}"#), &context)
        .await;

    assert!(matches!(
        result,
        Err(ServerError::Nats(message)) if message.contains("Auth.ValidateRequest")
    ));
}
