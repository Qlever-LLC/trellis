use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use serde::{Deserialize, Serialize};
use trellis_server::{
    dispatch_one, BootstrapBinding, ConnectedService, InboundRequest, RequestContext,
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
async fn connected_service_bootstrap_dispatches_request_with_validation() {
    let connected = ConnectedService::new(
        "jobs-service",
        matching_binding(),
        matching_binding(),
        (),
        StubValidator { allowed: true },
    );

    let host = connected
        .bootstrap(make_router())
        .expect("bootstrap should succeed");

    let reply = dispatch_one(&host, make_request())
        .await
        .expect("dispatch should succeed")
        .expect("reply should be present");
    assert!(!reply.is_error);

    let payload: PingOutput = serde_json::from_slice(&reply.payload).expect("decode payload");
    assert_eq!(
        payload,
        PingOutput {
            echoed: "hello".to_string(),
        }
    );
}

#[tokio::test]
async fn connected_service_run_with_runner_passes_runtime_client_and_subject() {
    let seen_subject = Arc::new(Mutex::new(None::<String>));
    let seen_runtime = Arc::new(Mutex::new(None::<String>));

    let connected = ConnectedService::new(
        "jobs-service",
        matching_binding(),
        matching_binding(),
        "runtime-client".to_string(),
        StubValidator { allowed: true },
    );

    let result = connected
        .run_with_runner("rpc.v1.Ping", make_router(), {
            let seen_subject = Arc::clone(&seen_subject);
            let seen_runtime = Arc::clone(&seen_runtime);
            move |runtime_client, run_subject, host| {
                let seen_subject = Arc::clone(&seen_subject);
                let seen_runtime = Arc::clone(&seen_runtime);
                async move {
                    *seen_subject.lock().expect("lock seen subject") = Some(run_subject);
                    *seen_runtime.lock().expect("lock seen runtime") = Some(runtime_client);

                    let reply = dispatch_one(&host, make_request())
                        .await?
                        .expect("reply should be present");
                    assert!(!reply.is_error);
                    Ok(())
                }
            }
        })
        .await;

    assert!(result.is_ok());
    assert_eq!(
        seen_subject.lock().expect("lock seen subject").as_deref(),
        Some("rpc.v1.Ping")
    );
    assert_eq!(
        seen_runtime.lock().expect("lock seen runtime").as_deref(),
        Some("runtime-client")
    );
}

#[tokio::test]
async fn connected_service_run_with_runner_propagates_runner_error() {
    let connected = ConnectedService::new(
        "jobs-service",
        matching_binding(),
        matching_binding(),
        (),
        StubValidator { allowed: true },
    );

    let result = connected
        .run_with_runner("rpc.v1.Ping", make_router(), |_, _, _| async move {
            Err(ServerError::Nats("runner boom".to_string()))
        })
        .await;

    assert!(matches!(
        result,
        Err(ServerError::Nats(message)) if message == "runner boom"
    ));
}
