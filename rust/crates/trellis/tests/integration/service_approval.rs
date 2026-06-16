use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use trellis_rs::client::{ServiceConnectWithContractOptions, TrellisClient, TrellisClientError};

use crate::support::assertions::assert_case_registered;

const SERVICE_CONTRACT_ID: &str = "trellis.integration.service-approval-service@v1";
const SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.service-approval-service@v1",
  "displayName": "Trellis Integration Service Approval Service",
  "description": "Exercises service startup waiting for deployment authority approval.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.service-approval-service::ping": {
      "displayName": "Ping approval service",
      "description": "Call the service after startup approval completes."
    }
  },
  "schemas": {
    "StartupPingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "StartupPingOutput": {
      "type": "object",
      "required": ["message", "approved"],
      "properties": {
        "message": { "type": "string" },
        "approved": { "type": "boolean" }
      }
    }
  },
  "rpc": {
    "Startup.Ping": {
      "version": "v1",
      "subject": "rpc.v1.Startup.Ping",
      "input": { "schema": "StartupPingInput" },
      "output": { "schema": "StartupPingOutput" },
      "capabilities": { "call": ["trellis.integration.service-approval-service::ping"] },
      "errors": []
    }
  }
}"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StartupPingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StartupPingOutput {
    message: String,
    approved: bool,
}

struct StartupPingRpc;

impl trellis_rs::client::RpcDescriptor for StartupPingRpc {
    type Input = StartupPingInput;
    type Output = StartupPingOutput;

    const KEY: &'static str = "Startup.Ping";
    const SUBJECT: &'static str = "rpc.v1.Startup.Ping";
    const CALLER_CAPABILITIES: &'static [&'static str] =
        &["trellis.integration.service-approval-service::ping"];
    const ERRORS: &'static [&'static str] = &[];
}

struct ServiceApprovalContract;

struct AbortOnDrop {
    handle: Option<JoinHandle<()>>,
}

impl AbortOnDrop {
    fn new(handle: JoinHandle<()>) -> Self {
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

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.abort();
        }
    }
}

#[tokio::test]
#[ignore]
async fn service_approval_service_startup_awaits_approval() {
    assert_case_registered(
        "service-approval.service-startup-awaits-approval",
        "service-approval",
        "service_approval",
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

    admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client for direct Auth RPCs");

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(SERVICE_CONTRACT_JSON)
            .expect("build service approval service contract");

    admin
        .create_deployment(&bootstrap_url, None, None)
        .await
        .expect("create deployment");

    let seed = trellis_rs::auth::generate_session_keypair().0;
    let auth_material = trellis_rs::client::SessionAuth::from_seed_base64url(&seed)
        .expect("build session auth from seed");

    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("get admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(admin_client);
    auth.rpc()
        .auth()
        .service_instances_provision(
            &trellis_rs::sdk::auth::types::AuthServiceInstancesProvisionRequest {
                deployment_id: "test".to_string(),
                instance_key: auth_material.session_key.clone(),
            },
        )
        .await
        .expect("provision service instance key before authority approval");

    let connect_trellis_url = runtime.trellis_url().to_string();
    let connect_seed = seed.clone();
    let contract_digest = service_contract.digest().to_string();

    let (connected_tx, connected_rx) = oneshot::channel::<()>();
    let connect_handle: JoinHandle<
        trellis_rs::service::ConnectedServiceRuntime<ServiceApprovalContract>,
    > = tokio::spawn(async move {
        let client =
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: &connect_trellis_url,
                contract_id: SERVICE_CONTRACT_ID,
                contract_digest: &contract_digest,
                contract_json: SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &connect_seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("service connect should succeed after approval");
        let service =
            trellis_rs::service::ConnectedServiceRuntime::<ServiceApprovalContract>::from_connected_client(
                "service-approval-fixture-service",
                Arc::new(client),
            )
            .expect("build connected service runtime from client");
        let _ = connected_tx.send(());
        service
    });

    let pending = tokio::time::timeout(Duration::from_millis(500), connected_rx).await;
    match pending {
        Err(_) => {}
        Ok(Ok(())) => {
            panic!("service connected before deployment authority approval");
        }
        Ok(Err(_)) => {
            panic!("service connect task failed before approval");
        }
    }

    admin
        .approve_contract(&bootstrap_url, &service_contract, None, &[])
        .await
        .expect("approve service contract");

    let mut service = tokio::time::timeout(Duration::from_secs(10), connect_handle)
        .await
        .expect("timed out waiting for service connect after approval")
        .expect("service connect task panicked");

    service.register_rpc::<StartupPingRpc, _, _>(|_context, input| async move {
        Ok(StartupPingOutput {
            message: input.message,
            approved: true,
        })
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move {
        service.run().await.expect("service runtime loop failed")
    }));

    let client_contract = {
        let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
            "trellis.integration.service-approval-client@v1",
            "Trellis Integration Service Approval Client",
            "App/client participant for the service approval fixture.",
            trellis_rs::contracts::ContractKind::App,
        )
        .use_ref(
            "approvalService",
            trellis_rs::contracts::use_contract(SERVICE_CONTRACT_ID)
                .with_rpc_call(["Startup.Ping"]),
        )
        .build()
        .expect("build service approval client contract manifest");
        trellis_test::TrellisTestContract::from_manifest_value(
            serde_json::to_value(manifest).expect("serialize client contract manifest"),
        )
        .expect("build test contract from manifest")
    };

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect client");

    let output = call_startup_ping_with_retry(&client, "approved-startup").await;

    service_task.abort_and_wait().await;

    assert_eq!(
        output,
        StartupPingOutput {
            message: "approved-startup".to_string(),
            approved: true,
        }
    );
}

async fn call_startup_ping_with_retry(
    client: &trellis_rs::client::TrellisClient,
    message: &str,
) -> StartupPingOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<StartupPingRpc>(&StartupPingInput {
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
            Err(error) => panic!("call live Startup.Ping RPC: {error}"),
        }
    }
}

fn is_retryable_service_startup_error(error: &TrellisClientError) -> bool {
    match error {
        TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        TrellisClientError::Timeout => true,
        _ => false,
    }
}
