use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use trellis_rs::client::RpcDescriptor;
use trellis_rs::service::GeneratedServiceContract;

use crate::support::assertions::assert_case_registered;

const RPC_SERVICE_ID: &str = "trellis.integration.rpc-service@v1";
const RPC_CLIENT_ID: &str = "trellis.integration.rpc-client@v1";
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
      "capabilities": { "call": ["trellis.integration.rpc-service::read"] }
    }
  }
}"#;

struct RpcServiceContract;

impl trellis_rs::service::GeneratedServiceContract for RpcServiceContract {
    const CONTRACT_ID: &'static str = RPC_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "y2lpc8Io-6ZzgG-2nBbKxKPIOzRHJo_14DNY-VAq_y4";
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

struct EntityGetRpc;

impl trellis_rs::client::RpcDescriptor for EntityGetRpc {
    type Input = EntityGetInput;
    type Output = EntityGetOutput;

    const KEY: &'static str = "Entity.Get";
    const SUBJECT: &'static str = "rpc.v1.Entity.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[RPC_READ_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
}

#[derive(Debug)]
struct ObservedRpcRequest {
    subject: String,
    required_capabilities: Option<Vec<String>>,
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

#[tokio::test]
#[ignore]
async fn rpc_client_calls_service() {
    assert_case_registered("rpc.client-calls-service", "rpc", "rpc");

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
    assert_eq!(
        service_contract.digest(),
        RpcServiceContract::CONTRACT_DIGEST
    );
    let client_contract = rpc_client_contract().expect("build RPC client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live RPC service instance");
    let mut service = trellis_rs::service::ConnectedServiceRuntime::<RpcServiceContract>::connect(
        runtime.service_connect_options("rpc-fixture-service", &service_key),
    )
    .await
    .expect("connect live Rust RPC service");
    let observed_requests = Arc::new(tokio::sync::Mutex::new(Vec::<ObservedRpcRequest>::new()));
    let handler_observed_requests = Arc::clone(&observed_requests);
    service.register_rpc::<EntityGetRpc, _, _>(move |context, input| {
        let observed_requests = Arc::clone(&handler_observed_requests);
        async move {
            observed_requests.lock().await.push(ObservedRpcRequest {
                subject: context.request().subject.clone(),
                required_capabilities: context.request().required_capabilities.clone(),
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
        trellis_rs::contracts::use_contract(RPC_SERVICE_ID).with_rpc_call(["Entity.Get"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
