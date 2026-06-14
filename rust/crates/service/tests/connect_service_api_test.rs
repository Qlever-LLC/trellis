use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use serde::{Deserialize, Serialize};
use trellis_service::internal::{
    connect_service, connect_service_with_options, dispatch_one,
    AuthenticatedServiceConnectOptions, ConnectServiceError, ConnectedServiceParts, InboundRequest,
};
use trellis_service::{
    BootstrapBinding, BootstrapBindingInfo, BootstrapContractRef, CoreBootstrapPort,
    JobsQueueResourceBinding, JobsResourceBinding, JobsSchemaRef, KvResourceBinding,
    RequestContext, RequestValidation, RequestValidator, Router, RpcDescriptor, ServerError,
    ServiceResourceBindings,
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
    ) -> BoxFuture<'a, Result<RequestValidation, ServerError>> {
        ready(Ok(if self.allowed {
            RequestValidation::allowed()
        } else {
            RequestValidation::denied()
        }))
        .boxed()
    }
}

struct StubCorePort {
    catalog: Mutex<Option<Result<Vec<BootstrapContractRef>, ServerError>>>,
    binding: Mutex<Option<Result<Option<BoundService>, ServerError>>>,
    fetch_catalog_calls: Arc<Mutex<usize>>,
    fetch_binding_calls: Arc<Mutex<usize>>,
}

#[derive(Clone)]
struct BoundService {
    binding: BootstrapBinding,
    resources: ServiceResourceBindings,
}

impl BootstrapBindingInfo for BoundService {
    fn bootstrap_binding(&self) -> BootstrapBinding {
        self.binding.clone()
    }

    fn resource_bindings(&self) -> ServiceResourceBindings {
        self.resources.clone()
    }
}

impl CoreBootstrapPort for StubCorePort {
    type Binding = BoundService;

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
    ) -> BoxFuture<'a, Result<Option<BoundService>, ServerError>> {
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

fn matching_bound_service(resources: ServiceResourceBindings) -> BoundService {
    BoundService {
        binding: matching_binding(),
        resources,
    }
}

fn resources() -> ServiceResourceBindings {
    ServiceResourceBindings {
        kv: BTreeMap::from([(
            "drafts".to_string(),
            KvResourceBinding {
                bucket: "svc_drafts".to_string(),
                history: 10,
                max_value_bytes: Some(16_384),
                ttl_ms: 86_400_000,
            },
        )]),
        store: BTreeMap::new(),
        jobs: Some(JobsResourceBinding {
            namespace: "field-ops".to_string(),
            work_stream: Some("JOBS_WORK".to_string()),
            queues: BTreeMap::from([(
                "report-finalize".to_string(),
                JobsQueueResourceBinding {
                    queue_type: "report-finalize".to_string(),
                    publish_prefix: "trellis.jobs.field-ops.report-finalize".to_string(),
                    work_subject: "trellis.work.field-ops.report-finalize".to_string(),
                    consumer_name: "field-ops-report-finalize".to_string(),
                    payload: JobsSchemaRef {
                        schema: "ReportFinalizePayload".to_string(),
                    },
                    result: None,
                    max_deliver: 5,
                    backoff_ms: vec![5_000, 30_000],
                    ack_wait_ms: 60_000,
                    default_deadline_ms: Some(120_000),
                    progress: true,
                    logs: true,
                    dlq: true,
                    concurrency: 2,
                    key_concurrency: None,
                    queue: None,
                },
            )]),
        }),
        event_consumers: BTreeMap::new(),
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
        reply_to: Some("_INBOX.svc_session.1".to_string()),
        context: RequestContext {
            subject: PingRpc::SUBJECT.to_string(),
            session_key: Some("svc_session".to_string()),
            proof: Some("proof".to_string()),
            iat: None,
            request_id: None,
            required_capabilities: None,
            reply_to: Some("_INBOX.svc_session.1".to_string()),
            caller: None,
            traceparent: None,
            tracestate: None,
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
                binding: Mutex::new(Some(Ok(Some(matching_bound_service(
                    ServiceResourceBindings::default(),
                ))))),
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
async fn connect_service_propagates_resolved_resource_bindings() {
    let expected = expected_contract();

    let connected = connect_service(
        "jobs-service",
        &expected,
        || async { Ok::<_, ()>("runtime-client") },
        |runtime_client| ConnectedServiceParts {
            runtime_client,
            core_port: StubCorePort {
                catalog: Mutex::new(Some(Ok(vec![expected.clone()]))),
                binding: Mutex::new(Some(Ok(Some(matching_bound_service(resources()))))),
                fetch_catalog_calls: Arc::new(Mutex::new(0)),
                fetch_binding_calls: Arc::new(Mutex::new(0)),
            },
            validator: StubValidator { allowed: true },
        },
    )
    .await
    .expect("connect should succeed");

    assert_eq!(
        connected.kv_binding("drafts").expect("kv").bucket,
        "svc_drafts"
    );
    let jobs = connected.jobs_binding().expect("jobs");
    assert_eq!(jobs.work_stream.as_deref(), Some("JOBS_WORK"));
    let queue = jobs.queues.get("report-finalize").expect("queue");
    assert_eq!(queue.payload.schema, "ReportFinalizePayload");
    assert!(queue.dlq);
}

#[tokio::test]
async fn connect_service_with_options_passes_authenticated_bootstrap_inputs() {
    let options = AuthenticatedServiceConnectOptions {
        service_name: "jobs-service",
        trellis_url: "https://trellis.example.test",
        contract_id: "trellis.jobs@v1",
        contract_digest: "sha256:expected",
        service_instance_seed_base64url: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        timeout_ms: 2_000,
    };
    let seen_url = Arc::new(Mutex::new(None::<String>));
    let seen_seed = Arc::new(Mutex::new(None::<String>));
    let fetch_catalog_calls = Arc::new(Mutex::new(0usize));
    let fetch_binding_calls = Arc::new(Mutex::new(0usize));

    let connected = connect_service_with_options(
        options,
        {
            let seen_url = Arc::clone(&seen_url);
            let seen_seed = Arc::clone(&seen_seed);
            move |options| {
                *seen_url.lock().expect("lock seen url") = Some(options.trellis_url.to_string());
                *seen_seed.lock().expect("lock seen seed") =
                    Some(options.service_instance_seed_base64url.to_string());
                || async { Ok::<_, ()>("runtime-client".to_string()) }
            }
        },
        |runtime_client| ConnectedServiceParts {
            runtime_client,
            core_port: StubCorePort {
                catalog: Mutex::new(Some(Ok(vec![BootstrapContractRef {
                    id: "trellis.jobs@v1".to_string(),
                    digest: "sha256:expected".to_string(),
                }]))),
                binding: Mutex::new(Some(Ok(Some(matching_bound_service(
                    ServiceResourceBindings::default(),
                ))))),
                fetch_catalog_calls: Arc::clone(&fetch_catalog_calls),
                fetch_binding_calls: Arc::clone(&fetch_binding_calls),
            },
            validator: StubValidator { allowed: true },
        },
    )
    .await
    .expect("connect should succeed");

    assert_eq!(connected.service_name(), "jobs-service");
    assert_eq!(connected.binding().bootstrap_binding(), matching_binding());
    assert_eq!(connected.internal_runtime_client(), "runtime-client");
    assert_eq!(
        seen_url.lock().expect("lock seen url").as_deref(),
        Some("https://trellis.example.test")
    );
    assert_eq!(
        seen_seed.lock().expect("lock seen seed").as_deref(),
        Some("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    );
    assert_eq!(*fetch_catalog_calls.lock().expect("lock calls"), 1);
    assert_eq!(*fetch_binding_calls.lock().expect("lock calls"), 1);
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
                binding: Mutex::new(Some(Ok(Some(matching_bound_service(
                    ServiceResourceBindings::default(),
                ))))),
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
                binding: Mutex::new(Some(Ok(Some(matching_bound_service(
                    ServiceResourceBindings::default(),
                ))))),
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
