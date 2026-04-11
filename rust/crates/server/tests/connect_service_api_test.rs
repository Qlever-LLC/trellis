use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use serde::{Deserialize, Serialize};
use trellis_server::{
    connect_service, dispatch_one, BootstrapBinding, BootstrapBindingInfo, BootstrapContractRef,
    ConnectServiceError, ConnectedServiceParts, CoreBootstrapPort, InboundRequest, RequestContext,
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

struct StubCorePort {
    catalog: Mutex<Option<Result<Vec<BootstrapContractRef>, ServerError>>>,
    binding: Mutex<Option<Result<Option<BootstrapBinding>, ServerError>>>,
    fetch_catalog_calls: Arc<Mutex<usize>>,
    fetch_binding_calls: Arc<Mutex<usize>>,
}

impl CoreBootstrapPort for StubCorePort {
    type Binding = BootstrapBinding;

    fn fetch_catalog_contracts<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<BootstrapContractRef>, ServerError>> {
        *self
            .fetch_catalog_calls
            .lock()
            .expect("lock fetch catalog calls") += 1;
        let result = self
            .catalog
            .lock()
            .expect("lock catalog")
            .take()
            .expect("catalog result should be set");
        ready(result).boxed()
    }

    fn fetch_binding<'a>(
        &'a self,
        _expected: &'a BootstrapContractRef,
    ) -> BoxFuture<'a, Result<Option<BootstrapBinding>, ServerError>> {
        *self
            .fetch_binding_calls
            .lock()
            .expect("lock fetch binding calls") += 1;
        let result = self
            .binding
            .lock()
            .expect("lock binding")
            .take()
            .expect("binding result should be set");
        ready(result).boxed()
    }
}

fn expected_contract() -> BootstrapContractRef {
    BootstrapContractRef {
        id: "trellis.jobs@v1".to_string(),
        digest: "sha256:expected".to_string(),
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
async fn connect_service_eagerly_resolves_binding_and_reuses_it_for_bootstrap() {
    let expected = expected_contract();
    let fetch_catalog_calls = Arc::new(Mutex::new(0usize));
    let fetch_binding_calls = Arc::new(Mutex::new(0usize));

    let connected = connect_service(
        "jobs-service",
        &expected,
        || async { Ok::<_, ()>("rc") },
        |runtime| ConnectedServiceParts {
            runtime_client: runtime,
            core_port: StubCorePort {
                catalog: Mutex::new(Some(Ok(vec![expected.clone()]))),
                binding: Mutex::new(Some(Ok(Some(matching_binding())))),
                fetch_catalog_calls: Arc::clone(&fetch_catalog_calls),
                fetch_binding_calls: Arc::clone(&fetch_binding_calls),
            },
            validator: StubValidator { allowed: true },
        },
    )
    .await
    .expect("connect should succeed");

    assert_eq!(
        *fetch_catalog_calls
            .lock()
            .expect("lock fetch catalog calls"),
        1
    );
    assert_eq!(
        *fetch_binding_calls
            .lock()
            .expect("lock fetch binding calls"),
        1
    );
    assert_eq!(connected.binding().bootstrap_binding(), matching_binding());
    assert_eq!(connected.bootstrap_binding(), &matching_binding());

    let host = connected
        .bootstrap(make_router())
        .expect("bootstrap should succeed");

    assert_eq!(
        *fetch_catalog_calls
            .lock()
            .expect("lock fetch catalog calls"),
        1
    );
    assert_eq!(
        *fetch_binding_calls
            .lock()
            .expect("lock fetch binding calls"),
        1
    );

    let reply = dispatch_one(&host, make_request())
        .await
        .expect("dispatch should succeed")
        .expect("reply should be present");
    assert!(!reply.is_error);
}

#[tokio::test]
async fn connected_service_run_with_runner_passes_runtime_and_subject() {
    let expected = expected_contract();
    let seen_subject = Arc::new(Mutex::new(None::<String>));
    let seen_runtime = Arc::new(Mutex::new(None::<String>));

    let connected = connect_service(
        "jobs-service",
        &expected,
        || async { Ok::<_, ()>("runtime-client".to_string()) },
        |runtime_client| ConnectedServiceParts {
            runtime_client,
            core_port: StubCorePort {
                catalog: Mutex::new(Some(Ok(vec![expected.clone()]))),
                binding: Mutex::new(Some(Ok(Some(matching_binding())))),
                fetch_catalog_calls: Arc::new(Mutex::new(0)),
                fetch_binding_calls: Arc::new(Mutex::new(0)),
            },
            validator: StubValidator { allowed: true },
        },
    )
    .await
    .expect("connect should succeed");

    let result = connected
        .run_with_runner(PingRpc::SUBJECT, make_router(), {
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
        Some(PingRpc::SUBJECT)
    );
    assert_eq!(
        seen_runtime.lock().expect("lock seen runtime").as_deref(),
        Some("runtime-client")
    );
}

#[tokio::test]
async fn connect_service_surfaces_connect_error() {
    let expected = expected_contract();

    let result = connect_service(
        "jobs-service",
        &expected,
        || async { Err::<String, _>("connect failed") },
        |_| ConnectedServiceParts {
            runtime_client: (),
            core_port: StubCorePort {
                catalog: Mutex::new(Some(Ok(vec![expected.clone()]))),
                binding: Mutex::new(Some(Ok(Some(matching_binding())))),
                fetch_catalog_calls: Arc::new(Mutex::new(0)),
                fetch_binding_calls: Arc::new(Mutex::new(0)),
            },
            validator: StubValidator { allowed: true },
        },
    )
    .await;

    assert!(matches!(
        result,
        Err(ConnectServiceError::Connect(message)) if message == "connect failed"
    ));
}
