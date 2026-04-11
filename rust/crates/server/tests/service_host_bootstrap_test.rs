use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use serde::{Deserialize, Serialize};
use trellis_server::{
    bootstrap_service_host, dispatch_one, BootstrapBinding, InboundRequest, RequestContext,
    RequestValidator, Router, RpcDescriptor, ServerError,
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
}

impl RequestValidator for StubValidator {
    fn validate<'a>(
        &'a self,
        _subject: &'a str,
        _payload: &'a Bytes,
        _context: &'a RequestContext,
    ) -> BoxFuture<'a, Result<bool, ServerError>> {
        ready(Ok(self.allowed)).boxed()
    }
}

fn matching_binding() -> BootstrapBinding {
    BootstrapBinding {
        contract_id: "trellis.jobs@v1".to_string(),
        digest: "sha256:expected".to_string(),
    }
}

fn make_router() -> Router {
    let mut router = Router::new();
    router.register_rpc::<PingRpc, _, _>(|_ctx, input| async move {
        Ok(PingOutput {
            echoed: input.value,
        })
    });
    router
}

fn make_request() -> InboundRequest {
    InboundRequest {
        subject: PingRpc::SUBJECT.to_string(),
        payload: Bytes::from_static(br#"{"value":"hello"}"#),
        reply_to: Some("_INBOX.1".to_string()),
        context: RequestContext {
            subject: PingRpc::SUBJECT.to_string(),
            session_key: Some("svc_session".to_string()),
            proof: Some("proof".to_string()),
        },
    }
}

#[tokio::test]
async fn bootstrap_service_host_happy_path_returns_binding_and_handles_request() {
    let host = bootstrap_service_host(
        "jobs-service",
        matching_binding(),
        make_router(),
        StubValidator { allowed: true },
    );

    assert_eq!(host.service_name(), "jobs-service");
    assert_eq!(host.binding(), &matching_binding());

    let reply = dispatch_one(&host, make_request())
        .await
        .expect("dispatch should succeed")
        .expect("reply should be present");
    assert!(!reply.is_error);

    let payload: PingOutput = serde_json::from_slice(&reply.payload).expect("decode reply payload");
    assert_eq!(
        payload,
        PingOutput {
            echoed: "hello".to_string(),
        }
    );
}

#[tokio::test]
async fn service_host_enforces_authenticated_validation() {
    let host = bootstrap_service_host(
        "jobs-service",
        matching_binding(),
        make_router(),
        StubValidator { allowed: false },
    );

    let reply = dispatch_one(&host, make_request())
        .await
        .expect("dispatch should return error reply")
        .expect("reply should be present");

    assert!(reply.is_error);
}
