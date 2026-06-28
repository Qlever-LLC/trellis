use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::task::JoinHandle;
use trellis_rs::client::{RpcDescriptor, ServiceConnectWithContractOptions, TrellisClient};
use trellis_rs::service::{
    ConnectedServiceRuntime, DeclaredRpcError, GeneratedServiceContract, ServerError,
};

use crate::support::assertions::assert_case_registered;

const RPC_SERVICE_ID: &str = "trellis.integration.rpc-service@v1";
const RPC_CLIENT_ID: &str = "trellis.integration.rpc-client@v1";
const RPC_UNAUTHORIZED_CLIENT_ID: &str = "trellis.integration.rpc-unauthorized-client@v1";
const RPC_READ_CAPABILITY: &str = "trellis.integration.rpc-service::read";

const RPC_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.rpc-service@v1",
  "displayName": "Trellis Integration RPC Service",
  "description": "Exercises client-to-service RPC through generated surfaces.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.rpc-service::read": {
      "displayName": "Read entities",
      "description": "Read entity records in the RPC integration fixture."
    }
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
      "type": "NOT_FOUND",
      "schema": { "schema": "EntityGetInput" }
    }
  },
  "uses": {
    "required": {
      "health": {
        "contract": "trellis.health@v1",
        "events": { "publish": ["Health.Heartbeat"] }
      }
    }
  },
  "rpc": {
    "Entity.Get": {
      "version": "v1",
      "subject": "rpc.v1.Entity.Get",
      "input": { "schema": "EntityGetInput" },
      "output": { "schema": "EntityGetOutput" },
      "capabilities": { "call": ["trellis.integration.rpc-service::read"] },
      "errors": [{ "type": "NOT_FOUND" }]
    },
    "Validation.Annotated": {
      "version": "v1",
      "subject": "rpc.v1.Validation.Annotated",
      "input": { "schema": "AnnotatedValidationInput" },
      "output": { "schema": "ValidationOutput" },
      "capabilities": { "call": ["trellis.integration.rpc-service::read"] },
      "errors": []
    },
    "Validation.Mixed": {
      "version": "v1",
      "subject": "rpc.v1.Validation.Mixed",
      "input": { "schema": "MixedValidationInput" },
      "output": { "schema": "ValidationOutput" },
      "capabilities": { "call": ["trellis.integration.rpc-service::read"] },
      "errors": []
    }
  }
}"#;

struct RpcServiceContract;

impl GeneratedServiceContract for RpcServiceContract {
    const CONTRACT_ID: &'static str = RPC_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = RPC_SERVICE_CONTRACT_JSON;
}

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
    caller: Option<Value>,
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

fn service_name() -> &'static str {
    "rpc-fixture-service"
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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RpcServiceContract::CONTRACT_JSON)
            .expect("build RPC service test contract");
    let client_contract = rpc_client_contract().expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let contract_digest = service_contract.digest().to_string();

    let trellis_url = runtime.trellis_url().to_string();
    let seed = service_key.seed.clone();
    let mut service: RpcServiceRuntime = ConnectedServiceRuntime::from_connected_client(
        service_name(),
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &trellis_url,
                contract_id: RPC_SERVICE_ID,
                contract_digest: &contract_digest,
                contract_json: RPC_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust RPC service"),
        ),
    )
    .expect("build connected service runtime");

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

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust RPC client");
    let output = call_entity_get_with_retry(&client, "entity-1").await;

    service_task.abort_and_wait().await;
    let observed_requests = observed_requests.lock().await;
    assert_eq!(observed_requests.len(), 1);
    assert_eq!(observed_requests[0].subject, EntityGetRpc::SUBJECT);
    assert_eq!(
        observed_requests[0].required_capabilities,
        Some(vec![RPC_READ_CAPABILITY.to_string()])
    );
    assert_eq!(
        output,
        EntityGetOutput {
            id: "entity-1".to_string(),
            found: true,
        }
    );
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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RpcServiceContract::CONTRACT_JSON)
            .expect("build RPC service test contract");
    let client_contract = rpc_client_contract().expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let contract_digest = service_contract.digest().to_string();

    let trellis_url = runtime.trellis_url().to_string();
    let seed = service_key.seed.clone();
    let mut service: RpcServiceRuntime = ConnectedServiceRuntime::from_connected_client(
        service_name(),
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &trellis_url,
                contract_id: RPC_SERVICE_ID,
                contract_digest: &contract_digest,
                contract_json: RPC_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust RPC service"),
        ),
    )
    .expect("build connected service runtime");

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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RpcServiceContract::CONTRACT_JSON)
            .expect("build RPC service test contract");
    let client_contract = rpc_client_contract().expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let contract_digest = service_contract.digest().to_string();

    let trellis_url = runtime.trellis_url().to_string();
    let seed = service_key.seed.clone();
    let mut service: RpcServiceRuntime = ConnectedServiceRuntime::from_connected_client(
        service_name(),
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &trellis_url,
                contract_id: RPC_SERVICE_ID,
                contract_digest: &contract_digest,
                contract_json: RPC_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust RPC service"),
        ),
    )
    .expect("build connected service runtime");

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
    let result = call_entity_get_expecting_error(&client, "entity-1").await;
    assert_eq!(result.error_type(), Some("NOT_FOUND"));
    let value = result.value().expect("declared error payload is JSON");
    let context = value
        .get("context")
        .and_then(Value::as_object)
        .expect("declared error payload has handler context");
    assert_eq!(
        context.get("method").and_then(Value::as_str),
        Some("Entity.Get")
    );
    assert_eq!(
        context.get("service").and_then(Value::as_str),
        Some(service_name())
    );
    assert_eq!(
        context.get("contractId").and_then(Value::as_str),
        Some(RPC_SERVICE_ID)
    );
    assert_eq!(
        context.get("contractDigest").and_then(Value::as_str),
        Some(contract_digest.as_str())
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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RpcServiceContract::CONTRACT_JSON)
            .expect("build RPC service test contract");
    let client_contract =
        rpc_unauthorized_client_contract().expect("build unauthorized RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let contract_digest = service_contract.digest().to_string();

    let trellis_url = runtime.trellis_url().to_string();
    let seed = service_key.seed.clone();
    let mut service: RpcServiceRuntime = ConnectedServiceRuntime::from_connected_client(
        service_name(),
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &trellis_url,
                contract_id: RPC_SERVICE_ID,
                contract_digest: &contract_digest,
                contract_json: RPC_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust RPC service"),
        ),
    )
    .expect("build connected service runtime");

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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RpcServiceContract::CONTRACT_JSON)
            .expect("build RPC service test contract");
    let client_contract = rpc_client_contract().expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let contract_digest = service_contract.digest().to_string();

    let trellis_url = runtime.trellis_url().to_string();
    let seed = service_key.seed.clone();
    let mut service: RpcServiceRuntime = ConnectedServiceRuntime::from_connected_client(
        service_name(),
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &trellis_url,
                contract_id: RPC_SERVICE_ID,
                contract_digest: &contract_digest,
                contract_json: RPC_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust RPC service"),
        ),
    )
    .expect("build connected service runtime");

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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RpcServiceContract::CONTRACT_JSON)
            .expect("build RPC service test contract");
    let client_contract = rpc_client_contract().expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let contract_digest = service_contract.digest().to_string();

    let trellis_url = runtime.trellis_url().to_string();
    let seed = service_key.seed.clone();
    let mut service: RpcServiceRuntime = ConnectedServiceRuntime::from_connected_client(
        service_name(),
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &trellis_url,
                contract_id: RPC_SERVICE_ID,
                contract_digest: &contract_digest,
                contract_json: RPC_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust RPC service"),
        ),
    )
    .expect("build connected service runtime");

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

#[tokio::test]
async fn rpc_auth_validation_retries_transient_session_not_found() {
    assert_case_registered(
        "rpc.auth-validation-retries-transient-session-not-found",
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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RpcServiceContract::CONTRACT_JSON)
            .expect("build RPC service test contract");
    let client_contract = rpc_client_contract().expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let contract_digest = service_contract.digest().to_string();

    let trellis_url = runtime.trellis_url().to_string();
    let seed = service_key.seed.clone();
    let mut service: RpcServiceRuntime = ConnectedServiceRuntime::from_connected_client(
        service_name(),
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &trellis_url,
                contract_id: RPC_SERVICE_ID,
                contract_digest: &contract_digest,
                contract_json: RPC_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust RPC service"),
        ),
    )
    .expect("build connected service runtime");

    let handler_call_count = Arc::new(AtomicUsize::new(0));
    let handler_counter = Arc::clone(&handler_call_count);
    service.register_rpc::<EntityGetRpc, _, _>(move |_context, input| {
        let handler_counter = Arc::clone(&handler_counter);
        async move {
            handler_counter.fetch_add(1, Ordering::SeqCst);
            Ok(EntityGetOutput {
                id: input.id,
                found: true,
            })
        }
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let (client_seed, client_session_key) = trellis_rs::auth::generate_session_keypair();
    let client = admin
        .connect_client_with_session_seed(&bootstrap_url, &client_contract, client_seed)
        .await
        .expect("connect live Rust RPC client");
    let observer = runtime
        .start_nats_message_observer("rpc.v1.Auth.Requests.Validate")
        .await
        .expect("start auth validation NATS observer");
    let auth_reply_observer = runtime
        .start_nats_message_observer(format!("_INBOX.{}.>", &service_key.session_key[..16]))
        .await
        .expect("start auth validation reply NATS observer");
    let session_snapshot = runtime
        .control_plane_sqlite()
        .take_session(&client_session_key)
        .expect("take client session row")
        .expect("client session row exists");

    let call_task = tokio::spawn(async move {
        client
            .call::<EntityGetRpc>(&EntityGetInput {
                id: "entity-1".to_string(),
            })
            .await
    });

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let frames = auth_reply_observer.frames();
        if frames.iter().any(|frame| {
            let Ok(value) = serde_json::from_str::<Value>(&frame.payload) else {
                return false;
            };
            value.get("type").and_then(Value::as_str) == Some("AuthError")
                && value.get("reason").and_then(Value::as_str) == Some("session_not_found")
        }) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for session_not_found AuthError reply; frames: {frames:?}"
        );
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    session_snapshot
        .restore()
        .expect("restore client session row");

    let output = call_task
        .await
        .expect("join live Rust RPC call")
        .expect("call live Entity.Get RPC after transient missing session");
    service_task.abort_and_wait().await;
    assert_eq!(
        output,
        EntityGetOutput {
            id: "entity-1".to_string(),
            found: true,
        }
    );
    assert_eq!(handler_call_count.load(Ordering::SeqCst), 1);
    assert_eq!(observer.frames().len(), 2);
    auth_reply_observer.stop().await;
    observer.stop().await;
}

async fn call_entity_get_with_retry(
    client: &trellis_rs::client::TrellisClient,
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
    client: &trellis_rs::client::TrellisClient,
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
            Err(trellis_rs::client::TrellisClientError::RpcError(payload)) => return payload,
            Err(error) => panic!("expected declared RPC error, got: {error}"),
        }
    }
}

async fn call_rpc_expecting_error_with_retry<D>(
    client: &trellis_rs::client::TrellisClient,
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
            Err(trellis_rs::client::TrellisClientError::RpcError(payload)) => return payload,
            Err(error) => panic!("expected RPC validation error, got: {error}"),
        }
    }
}

fn is_retryable_service_startup_error(error: &trellis_rs::client::TrellisClientError) -> bool {
    match error {
        trellis_rs::client::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::client::TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn rpc_client_contract() -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError>
{
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        RPC_CLIENT_ID,
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
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn rpc_unauthorized_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        RPC_UNAUTHORIZED_CLIENT_ID,
        "Trellis Integration Unauthorized RPC Client",
        "App/client without rpc.call authority for Entity.Get.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "rpcService",
        trellis_rs::contracts::use_contract(RPC_SERVICE_ID),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
