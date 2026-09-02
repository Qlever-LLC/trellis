use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::task::JoinHandle;
use trellis_rs::client::RpcDescriptor;
use trellis_rs::service::{ConnectedServiceRuntime, DeclaredRpcError, ServerError};

use crate::support::assertions::{assert_case_registered, assert_runtime_case_registered};

const RPC_SERVICE_ID: &str = "integration.rpc-service@v1";
const RPC_CLIENT_ID: &str = "integration.rpc-client@v1";
const RPC_UNAUTHORIZED_CLIENT_ID: &str = "integration.rpc-unauthorized-client@v1";
const RPC_READ_CAPABILITY: &str = "integration.rpc-service::read";

const RPC_SERVICE_API_SOURCE_JSON: &str = r#"{
  "format": "trellis.api.v1",
  "id": "integration.rpc-service@v1",
  "version": "1.0.0",
  "displayName": "Trellis Integration RPC Service",
  "description": "Exercises client-to-service RPC through generated surfaces.",
  "capabilities": {
    "integration.rpc-service::read": {"allows": [
      {"target": {"kind": "apiSurface", "api": "integration.rpc-service@v1", "surface": "rpc", "name": "Entity.Get"}, "action": "call"},
      {"target": {"kind": "apiSurface", "api": "integration.rpc-service@v1", "surface": "rpc", "name": "Validation.Annotated"}, "action": "call"},
      {"target": {"kind": "apiSurface", "api": "integration.rpc-service@v1", "surface": "rpc", "name": "Validation.Mixed"}, "action": "call"}
    ]}
  },
  "schemas": {
    "EntityGetInput": {
      "type": "object",
      "required": ["id"],
      "properties": { "id": { "type": "string" } }
    },
    "EntityGetOutput": {
      "type": "object",
      "required": ["id", "found"],
      "properties": {
        "id": { "type": "string" },
        "found": { "type": "boolean" }
      }
    },
    "AnnotatedValidationInput": {
      "type": "object",
      "required": ["items"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1,
          "x-trellis-validation": {
            "label": "Items",
            "issues": {
              "minItems": {
                "code": "rpc.items.required",
                "message": "Add at least one item."
              }
            }
          }
        }
      }
    },
    "MixedValidationInput": {
      "type": "object",
      "required": ["items", "name"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1,
          "x-trellis-validation": {
            "label": "Items",
            "issues": {
              "minItems": {
                "code": "rpc.items.required",
                "message": "Add at least one item."
              }
            }
          }
        },
        "name": { "type": "string", "minLength": 3 }
      }
    },
    "ValidationOutput": {
      "type": "object",
      "required": ["success"],
      "properties": { "success": { "type": "boolean" } }
    }
  },
  "errors": {
    "NOT_FOUND": {
      "schema": { "schema": "EntityGetInput" }
    }
  },
  "rpc": {
    "Entity.Get": {
      "version": "v1",
      "input": { "schema": "EntityGetInput" },
      "output": { "schema": "EntityGetOutput" },
      "errors": ["NOT_FOUND"]
    },
    "Validation.Annotated": {
      "version": "v1",
      "input": { "schema": "AnnotatedValidationInput" },
      "output": { "schema": "ValidationOutput" },
      "errors": []
    },
    "Validation.Mixed": {
      "version": "v1",
      "input": { "schema": "MixedValidationInput" },
      "output": { "schema": "ValidationOutput" },
      "errors": []
    }
  }
}"#;

struct RpcServiceContract;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityGetInput {
    id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityGetOutput {
    id: String,
    found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct AnnotatedValidationInput {
    items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct MixedValidationInput {
    items: Vec<String>,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ValidationOutput {
    success: bool,
}

struct EntityGetRpc;

impl RpcDescriptor for EntityGetRpc {
    type Input = EntityGetInput;
    type Output = EntityGetOutput;

    const KEY: &'static str = "Entity.Get";
    const SUBJECT: &'static str = "rpc.v1.Entity.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[RPC_READ_CAPABILITY];
    const ERRORS: &'static [&'static str] = &["NOT_FOUND"];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
}

struct AnnotatedValidationRpc;

impl RpcDescriptor for AnnotatedValidationRpc {
    type Input = AnnotatedValidationInput;
    type Output = ValidationOutput;

    const KEY: &'static str = "Validation.Annotated";
    const SUBJECT: &'static str = "rpc.v1.Validation.Annotated";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[RPC_READ_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{
      "type": "object",
      "required": ["items"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1,
          "x-trellis-validation": {
            "label": "Items",
            "issues": {
              "minItems": {
                "code": "rpc.items.required",
                "message": "Add at least one item."
              }
            }
          }
        }
      }
    }"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
}

struct MixedValidationRpc;

impl RpcDescriptor for MixedValidationRpc {
    type Input = MixedValidationInput;
    type Output = ValidationOutput;

    const KEY: &'static str = "Validation.Mixed";
    const SUBJECT: &'static str = "rpc.v1.Validation.Mixed";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[RPC_READ_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{
      "type": "object",
      "required": ["items", "name"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1,
          "x-trellis-validation": {
            "label": "Items",
            "issues": {
              "minItems": {
                "code": "rpc.items.required",
                "message": "Add at least one item."
              }
            }
          }
        },
        "name": { "type": "string", "minLength": 3 }
      }
    }"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
}

#[derive(Debug)]
struct ObservedRpcRequest {
    subject: String,
    required_capabilities: Option<Vec<String>>,
    caller: Option<trellis_rs::service::VerifiedCaller>,
    session_key: Option<String>,
    request_id: Option<String>,
    traceparent: Option<String>,
}

struct AbortOnDrop<T> {
    handle: Option<JoinHandle<T>>,
}

impl<T> AbortOnDrop<T> {
    fn new(handle: JoinHandle<T>) -> Self {
        Self {
            handle: Some(handle),
        }
    }

    async fn abort_and_wait(mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            let _ = handle.await;
        }
    }
}

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.abort();
        }
    }
}

type RpcServiceRuntime = ConnectedServiceRuntime<RpcServiceContract>;

async fn connect_rpc_service(
    trellis_url: &str,
    key: &trellis_test::TrellisTestServiceKey,
) -> RpcServiceRuntime {
    trellis_test::connect_service_runtime::<RpcServiceContract>(trellis_url, key)
        .await
        .expect("connect live Rust RPC service runtime")
}

#[tokio::test]
async fn rpc_client_calls_service_success() {
    assert_case_registered("rpc.client-calls-service-success", "rpc", "rpc");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        RPC_SERVICE_ID,
        RPC_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build RPC service test contract");
    let client_contract =
        rpc_client_contract(&service_contract).expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let trellis_url = runtime.trellis_url().to_string();
    let mut service: RpcServiceRuntime = connect_rpc_service(&trellis_url, &service_key).await;

    let observed_requests = Arc::new(tokio::sync::Mutex::new(Vec::<ObservedRpcRequest>::new()));
    let handler_observed_requests = Arc::clone(&observed_requests);
    service.register_rpc::<EntityGetRpc, _, _>(move |context, input| {
        let observed_requests = Arc::clone(&handler_observed_requests);
        async move {
            observed_requests.lock().await.push(ObservedRpcRequest {
                subject: context.request().subject.clone(),
                required_capabilities: context.request().required_capabilities.clone(),
                caller: None,
                session_key: None,
                request_id: None,
                traceparent: None,
            });
            Ok(EntityGetOutput {
                id: input.id,
                found: true,
            })
        }
    });

    let service_subjects = service
        .registered_subjects()
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust RPC client");
    let client_subject = EntityGetRpc::SUBJECT;
    let client_capability = RPC_READ_CAPABILITY;
    assert_eq!(service_subjects, [client_subject]);
    let output = call_entity_get_with_retry(&client, "entity-1").await;

    service_task.abort_and_wait().await;
    let observed_requests = observed_requests.lock().await;
    assert_eq!(observed_requests.len(), 1);
    assert_eq!(observed_requests[0].subject, client_subject);
    assert_eq!(
        observed_requests[0].required_capabilities,
        Some(vec![client_capability.to_owned()])
    );
    assert_eq!(
        output,
        EntityGetOutput {
            id: "entity-1".to_string(),
            found: true,
        }
    );
    drop(observed_requests);
}

#[tokio::test]
async fn auth_post_commit_event_publish_uses_jetstream_puback() {
    assert_runtime_case_registered(
        "auth-post-commit.event-publish-uses-jetstream-puback",
        "auth-post-commit",
        "rpc",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut target_admin = runtime.admin();
    let target_session_id = {
        let target_contract =
            rpc_unauthorized_client_contract().expect("build target client contract");
        let (_, target) = target_admin
            .connect_client_with_session_seed_reconnectable(
                &bootstrap_url,
                &target_contract,
                trellis_rs::auth::generate_session_keypair().0,
            )
            .await
            .expect("connect target client");
        target.session_id().to_owned()
    };

    let ack_observer = runtime
        .start_jetstream_publish_ack_observer()
        .await
        .expect("start JetStream publication ACK observer");
    let event_observer = runtime
        .start_nats_message_observer("events.v1.Auth.Sessions.Revoked")
        .await
        .expect("start auth event observer");

    let mut admin = runtime.admin();
    admin
        .revoke_session(
            &bootstrap_url,
            &trellis_runtime_apis::auth::AuthSessionsRevokeRequest {
                session_id: target_session_id.clone(),
                expected_version: None,
                reason: Some("integration test revocation".to_string()),
                idempotency_key: ulid::Ulid::new().to_string(),
            },
        )
        .await
        .expect("revoke target admin session");

    let deadline = Instant::now() + Duration::from_secs(5);
    let event = loop {
        let event = event_observer.frames().into_iter().find_map(|frame| {
            let value: Value = serde_json::from_str(&frame.payload).ok()?;
            (value.get("sessionId").and_then(Value::as_str) == Some(target_session_id.as_str()))
                .then_some(value)
        });
        if event.is_some() {
            break event;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for Auth.Sessions.Revoked event"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    let event = event.expect("event found before timeout");

    let ack = loop {
        let ack = ack_observer.frames().into_iter().find_map(|frame| {
            let value: Value = serde_json::from_str(&frame.payload).ok()?;
            (value.get("stream").and_then(Value::as_str) == Some("trellis")).then_some(value)
        });
        if ack.is_some() {
            break ack;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for Auth post-commit JetStream PubAck"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    };

    assert!(event["eventId"]
        .as_str()
        .is_some_and(|id| id.starts_with("evt_")));
    assert!(ack.is_some(), "publication ACK found before timeout");
    assert_eq!(ack_observer.errors(), Vec::<String>::new());
    event_observer.stop().await;
    ack_observer.stop().await;
}

#[tokio::test]
async fn authorization_registry_provider_cache_is_nats_local_and_revocation_live() {
    assert_case_registered(
        "authorization-registry.provider-cache",
        "authorization-registry",
        "rpc",
    );

    let options = trellis_test::TrellisTestRuntimeOptions {
        rotatable_nats_proxy: true,
        ..Default::default()
    };
    let mut runtime = trellis_test::TrellisTestRuntime::start(options)
        .await
        .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        RPC_SERVICE_ID,
        RPC_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build RPC service test contract");
    let client_contract =
        rpc_client_contract(&service_contract).expect("build RPC client test contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let mut service = connect_rpc_service(runtime.trellis_url(), &service_key).await;
    service.register_rpc::<EntityGetRpc, _, _>(|_context, input| async move {
        Ok(EntityGetOutput {
            id: input.id,
            found: true,
        })
    });
    let provider = service.integration_test_authorization_provider();
    let service_nats = service.integration_test_nats();
    let service_lifecycle = service_nats.statistics();
    let service_caller = service.caller().clone();
    let before = provider.integration_test_io_counters();
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &client_contract,
            trellis_rs::auth::generate_session_keypair().0,
        )
        .await
        .expect("connect live Rust RPC client");
    let context = client
        .refresh_authorization_context()
        .await
        .expect("refresh live caller context");
    let context = trellis_protocol::parse_authorization_context(&context.context)
        .expect("parse refreshed caller context");
    let context_digest = context.digest().expect("digest refreshed caller context");

    let first = call_entity_get_with_retry(&client, "registry-first").await;
    assert_eq!(first.id, "registry-first");
    let first_io = provider.integration_test_io_counters();
    assert_eq!(first_io.context_gets - before.context_gets, 1);
    assert_eq!(first_io.context_resolves - before.context_resolves, 1);
    assert!(
        first_io.trust_gets - before.trust_gets <= 2,
        "first miss used more than two exact trust reads: before={before:?} after={first_io:?}"
    );

    let second = call_entity_get_with_retry(&client, "registry-hit").await;
    assert_eq!(second.id, "registry-hit");
    assert_eq!(provider.integration_test_io_counters(), first_io);

    let ((retired_url, _), _) = runtime
        .stage_nats_proxy_rotation()
        .await
        .expect("rotate provider-cache NATS endpoint");
    service_caller
        .integration_test_refresh_authorization_context()
        .await
        .expect("refresh service through endpoint B");
    client
        .refresh_authorization_context()
        .await
        .expect("refresh caller through endpoint B");
    assert!(Arc::ptr_eq(
        &service_lifecycle,
        &service_caller.integration_test_nats().statistics()
    ));
    // Reconnect recreates watches and their initial state before readiness returns.
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let current = provider.integration_test_io_counters();
        if current.revocation_watch_initializations > first_io.revocation_watch_initializations
            && provider.integration_test_provider_ready()
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "provider did not become ready after reconnect: before={first_io:?} after={current:?}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let client_js = async_nats::jetstream::new(client.integration_test_nats());
    let client_registry = client_js
        .get_key_value("trellis_authorization_contexts")
        .await
        .expect("open context registry through issued client JWT");
    assert!(client_registry
        .get(&context_digest)
        .await
        .expect("read own context through issued client JWT")
        .is_some());
    assert!(
        client_registry
            .put(
                format!("forbidden.{context_digest}"),
                bytes::Bytes::from_static(b"forbidden"),
            )
            .await
            .is_err(),
        "issued client JWT unexpectedly wrote the context registry"
    );

    admin
        .revoke_session(
            &bootstrap_url,
            &trellis_runtime_apis::auth::AuthSessionsRevokeRequest {
                session_id: client_reconnect.session_id().to_owned(),
                expected_version: None,
                reason: Some("integration test revocation".to_owned()),
                idempotency_key: ulid::Ulid::new().to_string(),
            },
        )
        .await
        .expect("revoke caller session through Auth admin RPC");
    runtime.retire_staged_nats_proxies();
    assert!(
        tokio::net::TcpStream::connect(retired_url.trim_start_matches("nats://"))
            .await
            .is_err(),
        "retired endpoint A remained usable"
    );

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let error = client
            .call::<EntityGetRpc>(&EntityGetInput {
                id: "registry-revoked".to_owned(),
            })
            .await;
        if error.is_err() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "revocation watch did not deny caller"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn rpc_service_receives_caller_context() {
    assert_case_registered("rpc.service-receives-caller-context", "rpc", "rpc");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        RPC_SERVICE_ID,
        RPC_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build RPC service test contract");
    let client_contract =
        rpc_client_contract(&service_contract).expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let trellis_url = runtime.trellis_url().to_string();
    let mut service: RpcServiceRuntime = connect_rpc_service(&trellis_url, &service_key).await;

    let observed_requests = Arc::new(tokio::sync::Mutex::new(Vec::<ObservedRpcRequest>::new()));
    let handler_observed_requests = Arc::clone(&observed_requests);
    service.register_rpc::<EntityGetRpc, _, _>(move |context, input| {
        let observed_requests = Arc::clone(&handler_observed_requests);
        async move {
            let req = context.request();
            observed_requests.lock().await.push(ObservedRpcRequest {
                subject: req.subject.clone(),
                required_capabilities: req.required_capabilities.clone(),
                caller: req.caller.clone(),
                session_key: req.session_key.clone(),
                request_id: req.request_id.clone(),
                traceparent: req.traceparent.clone(),
            });
            Ok(EntityGetOutput {
                id: input.id,
                found: true,
            })
        }
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust RPC client");
    let _output = call_entity_get_with_retry(&client, "entity-1").await;

    service_task.abort_and_wait().await;
    let observed_requests = observed_requests.lock().await;
    assert_eq!(observed_requests.len(), 1);
    assert!(observed_requests[0].caller.is_some());
    assert!(observed_requests[0].session_key.is_some());
    assert!(observed_requests[0]
        .session_key
        .as_ref()
        .is_some_and(|s| !s.is_empty()));
    assert!(observed_requests[0].request_id.is_some());
    assert!(observed_requests[0]
        .request_id
        .as_ref()
        .is_some_and(|s| !s.is_empty()));
    if let Some(traceparent) = &observed_requests[0].traceparent {
        assert!(!traceparent.is_empty());
    }
}

#[tokio::test]
async fn rpc_client_receives_declared_error() {
    assert_case_registered("rpc.client-receives-declared-error", "rpc", "rpc");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        RPC_SERVICE_ID,
        RPC_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build RPC service test contract");
    let client_contract =
        rpc_client_contract(&service_contract).expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let trellis_url = runtime.trellis_url().to_string();
    let mut service: RpcServiceRuntime = connect_rpc_service(&trellis_url, &service_key).await;

    service.register_rpc::<EntityGetRpc, _, _>(move |_context, input| async move {
        Err(ServerError::DeclaredRpc(DeclaredRpcError::new(
            "NOT_FOUND",
            "entity not found",
            [("data", serde_json::json!({ "id": input.id }))],
        )))
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust RPC client");
    let client_subject = EntityGetRpc::SUBJECT;
    let result = call_entity_get_expecting_error(&client, "entity-1").await;
    assert_eq!(result.error_type(), Some("NOT_FOUND"));
    let value = result.value().expect("declared error payload is JSON");
    let context = value
        .get("context")
        .and_then(Value::as_object)
        .expect("declared error payload has handler context");
    assert_eq!(
        context.get("method").and_then(Value::as_str),
        client_subject.strip_prefix("rpc.v1.")
    );
    assert_eq!(
        context.get("service").and_then(Value::as_str),
        Some(service_key.participant_id.as_str())
    );
    assert_eq!(
        context.get("contractId").and_then(Value::as_str),
        Some(service_key.participant_id.as_str())
    );
    assert_eq!(
        context.get("contractDigest").and_then(Value::as_str),
        Some(service_key.participant_digest.as_str())
    );
    assert!(context
        .get("requestId")
        .and_then(Value::as_str)
        .is_some_and(|request_id| !request_id.is_empty()));
    assert!(!context.contains_key("subject"));

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn rpc_denies_client_without_call_authority() {
    assert_case_registered("rpc.denies-client-without-call-authority", "rpc", "rpc");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        RPC_SERVICE_ID,
        RPC_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build RPC service test contract");
    let client_contract =
        rpc_unauthorized_client_contract().expect("build unauthorized RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let trellis_url = runtime.trellis_url().to_string();
    let mut service: RpcServiceRuntime = connect_rpc_service(&trellis_url, &service_key).await;

    service.register_rpc::<EntityGetRpc, _, _>(move |_context, input| async move {
        Ok(EntityGetOutput {
            id: input.id,
            found: true,
        })
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust RPC client");
    let result = client
        .call::<EntityGetRpc>(&EntityGetInput {
            id: "entity-1".to_string(),
        })
        .await;
    assert!(
        result.is_err(),
        "expected unauthorized client to receive error"
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn rpc_invalid_annotated_input_schema_validation() {
    assert_case_registered(
        "rpc.invalid-annotated-input-schema-validation",
        "rpc",
        "rpc",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        RPC_SERVICE_ID,
        RPC_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build RPC service test contract");
    let client_contract =
        rpc_client_contract(&service_contract).expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let trellis_url = runtime.trellis_url().to_string();
    let mut service: RpcServiceRuntime = connect_rpc_service(&trellis_url, &service_key).await;

    let handler_call_count = Arc::new(AtomicUsize::new(0));
    let handler_counter = Arc::clone(&handler_call_count);
    service.register_rpc::<AnnotatedValidationRpc, _, _>(move |_context, _input| {
        let handler_counter = Arc::clone(&handler_counter);
        async move {
            handler_counter.fetch_add(1, Ordering::SeqCst);
            Ok(ValidationOutput { success: true })
        }
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust RPC client");
    let payload = call_rpc_expecting_error_with_retry::<AnnotatedValidationRpc>(
        &client,
        &AnnotatedValidationInput { items: Vec::new() },
    )
    .await;
    let error = payload
        .decode_schema_validation()
        .expect("decode SchemaValidationError payload")
        .expect("expected SchemaValidationError payload");

    service_task.abort_and_wait().await;
    assert_eq!(error.error_type, "SchemaValidationError");
    assert_eq!(error.issues.len(), 1);
    assert_eq!(error.issues[0].code, "rpc.items.required");
    assert_eq!(handler_call_count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rpc_invalid_mixed_input_validation() {
    assert_case_registered("rpc.invalid-mixed-input-validation", "rpc", "rpc");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        RPC_SERVICE_ID,
        RPC_SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build RPC service test contract");
    let client_contract =
        rpc_client_contract(&service_contract).expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let trellis_url = runtime.trellis_url().to_string();
    let mut service: RpcServiceRuntime = connect_rpc_service(&trellis_url, &service_key).await;

    let handler_call_count = Arc::new(AtomicUsize::new(0));
    let handler_counter = Arc::clone(&handler_call_count);
    service.register_rpc::<MixedValidationRpc, _, _>(move |_context, _input| {
        let handler_counter = Arc::clone(&handler_counter);
        async move {
            handler_counter.fetch_add(1, Ordering::SeqCst);
            Ok(ValidationOutput { success: true })
        }
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust RPC client");
    let payload = call_rpc_expecting_error_with_retry::<MixedValidationRpc>(
        &client,
        &MixedValidationInput {
            items: Vec::new(),
            name: "ab".to_string(),
        },
    )
    .await;

    assert!(
        payload
            .decode_schema_validation()
            .expect("decode SchemaValidationError probe")
            .is_none(),
        "expected ValidationError, not SchemaValidationError"
    );
    let error = payload
        .decode_validation()
        .expect("decode ValidationError payload")
        .expect("expected ValidationError payload");

    service_task.abort_and_wait().await;
    assert_eq!(error.error_type, "ValidationError");
    assert_eq!(handler_call_count.load(Ordering::SeqCst), 0);
}

async fn call_entity_get_with_retry(
    client: &trellis_rs::generated::Caller,
    id: &str,
) -> EntityGetOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<EntityGetRpc>(&EntityGetInput { id: id.to_string() })
            .await
        {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Entity.Get RPC: {error}"),
        }
    }
}

async fn call_entity_get_expecting_error(
    client: &trellis_rs::generated::Caller,
    id: &str,
) -> trellis_rs::client::RpcErrorPayload {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<EntityGetRpc>(&EntityGetInput { id: id.to_string() })
            .await
        {
            Ok(_output) => {
                panic!("expected error but call succeeded");
            }
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(trellis_rs::generated::TrellisClientError::RpcError(payload)) => return payload,
            Err(error) => panic!("expected declared RPC error, got: {error}"),
        }
    }
}

async fn call_rpc_expecting_error_with_retry<D>(
    client: &trellis_rs::generated::Caller,
    input: &D::Input,
) -> trellis_rs::client::RpcErrorPayload
where
    D: RpcDescriptor,
{
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client.call::<D>(input).await {
            Ok(_output) => panic!("expected error but call succeeded"),
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(trellis_rs::generated::TrellisClientError::RpcError(payload)) => return payload,
            Err(error) => panic!("expected RPC validation error, got: {error}"),
        }
    }
}

fn is_retryable_service_startup_error(error: &trellis_rs::generated::TrellisClientError) -> bool {
    match error {
        trellis_rs::generated::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::generated::TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn rpc_client_contract(
    service_contract: &trellis_test::TrellisTestContract,
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractBuilder::authoring(
        RPC_CLIENT_ID,
        RPC_CLIENT_ID,
        "1.0.0",
        "Trellis Integration RPC Client",
        "App/client participant for the RPC integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "rpcService",
        trellis_rs::contracts::use_contract(RPC_SERVICE_ID).with_rpc_call([
            "Entity.Get",
            "Validation.Annotated",
            "Validation.Mixed",
        ]),
    );

    trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
        manifest,
        &[service_contract],
    )
}

fn rpc_unauthorized_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractBuilder::authoring(
        RPC_UNAUTHORIZED_CLIENT_ID,
        RPC_UNAUTHORIZED_CLIENT_ID,
        "1.0.0",
        "Trellis Integration Unauthorized RPC Client",
        "App/client without rpc.call authority for Entity.Get.",
        trellis_rs::contracts::ContractKind::App,
    );

    trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(manifest, &[])
}
