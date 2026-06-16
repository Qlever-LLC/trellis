use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use trellis_rs::client::RpcDescriptor;
use trellis_rs::service::GeneratedServiceContract;

use crate::support::assertions::assert_case_registered;

const SERVICE_ID: &str = "trellis.integration.app-identity-approval-service@v1";
const CLIENT_ID: &str = "trellis.integration.app-identity-approval-client@v1";
const APPROVED_PING_CAPABILITY: &str =
    "trellis.integration.app-identity-approval-service::approvedPing";

const SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.app-identity-approval-service@v1",
  "displayName": "Trellis Integration App Identity Approval Service",
  "description": "Exercises an approved app identity grant with a service RPC.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.app-identity-approval-service::approvedPing": {
      "displayName": "Call approved ping",
      "description": "Call the app identity approval fixture RPC."
    }
  },
  "schemas": {
    "GrantPingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "GrantPingOutput": {
      "type": "object",
      "required": ["message", "approved"],
      "properties": {
        "message": { "type": "string" },
        "approved": { "type": "boolean" }
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
    "Grant.Ping": {
      "version": "v1",
      "subject": "rpc.v1.Grant.Ping",
      "input": { "schema": "GrantPingInput" },
      "output": { "schema": "GrantPingOutput" },
      "capabilities": { "call": ["trellis.integration.app-identity-approval-service::approvedPing"] }
    }
  }
}"#;

struct GrantPingServiceContract;

impl GeneratedServiceContract for GrantPingServiceContract {
    const CONTRACT_ID: &'static str = SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "JtPh4OFtf1x3P0C9B_SSS4bFrBLDdv_XlIMODqV6OS0";
    const CONTRACT_JSON: &'static str = SERVICE_CONTRACT_JSON;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GrantPingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GrantPingOutput {
    message: String,
    approved: bool,
}

struct GrantPingRpc;

impl RpcDescriptor for GrantPingRpc {
    type Input = GrantPingInput;
    type Output = GrantPingOutput;

    const KEY: &'static str = "Grant.Ping";
    const SUBJECT: &'static str = "rpc.v1.Grant.Ping";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[APPROVED_PING_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
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
async fn app_identity_approval_client_obtains_approved_grant() {
    assert_case_registered(
        "app-identity-approval.client-obtains-approved-grant",
        "app-identity-approval",
        "app_identity_approval",
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
        trellis_test::TrellisTestContract::from_manifest_json(SERVICE_CONTRACT_JSON)
            .expect("build app identity approval service test contract");
    assert_eq!(
        service_contract.digest(),
        GrantPingServiceContract::CONTRACT_DIGEST
    );
    let client_contract =
        app_identity_client_contract().expect("build app identity approval client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live app identity approval service instance");
    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<GrantPingServiceContract>::connect(
            runtime.service_connect_options("app-identity-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust app identity approval service");
    service.register_rpc::<GrantPingRpc, _, _>(|_context, input| async move {
        Ok(GrantPingOutput {
            message: input.message,
            approved: true,
        })
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust app identity approval client");
    let output = call_grant_ping_with_retry(&client, "app-approved").await;

    service_task.abort_and_wait().await;
    assert_eq!(
        output,
        GrantPingOutput {
            message: "app-approved".to_string(),
            approved: true,
        }
    );
}

async fn call_grant_ping_with_retry(
    client: &trellis_rs::client::TrellisClient,
    message: &str,
) -> GrantPingOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<GrantPingRpc>(&GrantPingInput {
                message: message.to_string(),
            })
            .await
        {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Grant.Ping RPC: {error}"),
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

fn app_identity_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CLIENT_ID,
        "Trellis Integration App Identity Approval Client",
        "App/client participant for the app identity approval fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "grantService",
        trellis_rs::contracts::use_contract(SERVICE_ID).with_rpc_call(["Grant.Ping"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
