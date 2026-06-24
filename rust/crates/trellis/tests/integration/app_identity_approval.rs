use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use trellis_rs::client::RpcDescriptor;
use trellis_rs::service::{GeneratedServiceContract, ServiceRuntimeError};

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
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
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
}

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.abort();
        }
    }
}

struct AppIdentityFixture {
    #[allow(dead_code)]
    runtime: trellis_test::TrellisTestRuntime,
    admin: trellis_test::TrellisTestAdmin,
    bootstrap_url: String,
    client_contract: trellis_test::TrellisTestContract,
    #[allow(dead_code)]
    service_task: AbortOnDrop<Result<(), ServiceRuntimeError>>,
}

async fn setup_app_identity_environment() -> AppIdentityFixture {
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

    AppIdentityFixture {
        runtime,
        admin,
        bootstrap_url,
        client_contract,
        service_task,
    }
}

#[tokio::test]
async fn app_identity_approval_connect_requires_auth_flow() {
    assert_case_registered(
        "app-identity-approval.connect-requires-auth-flow",
        "app-identity-approval",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;

    let _client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &fixture.client_contract)
        .await
        .expect("connect live Rust app identity approval client");
}

#[tokio::test]
async fn app_identity_approval_approved_client_connects() {
    assert_case_registered(
        "app-identity-approval.approved-client-connects",
        "app-identity-approval",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;

    let client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &fixture.client_contract)
        .await
        .expect("connect live Rust app identity approval client");

    client
        .flush()
        .await
        .expect("connected client should flush without error");
}

#[tokio::test]
async fn app_identity_approval_approved_client_calls_service() {
    assert_case_registered(
        "app-identity-approval.approved-client-calls-service",
        "app-identity-approval",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;

    let client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &fixture.client_contract)
        .await
        .expect("connect live Rust app identity approval client");

    let output = call_grant_ping_with_retry(&client, "app-approved").await;
    assert_eq!(
        output,
        GrantPingOutput {
            message: "app-approved".to_string(),
            approved: true,
        }
    );
}

#[tokio::test]
async fn auth_local_login_binds_approved_client() {
    assert_case_registered(
        "auth.local-login-binds-approved-client",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth local-login client test contract");

    let client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust auth local-login client");

    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as approved app client");

    assert_eq!(me.participant_kind.as_str(), Some("app"));
    let user = me
        .user
        .as_object()
        .expect("approved app session should have a user");
    assert_eq!(
        user.get("active").and_then(serde_json::Value::as_bool),
        Some(true)
    );
    let capabilities = user
        .get("capabilities")
        .and_then(serde_json::Value::as_array)
        .expect("approved app session user should include capabilities")
        .iter()
        .filter_map(serde_json::Value::as_str)
        .collect::<Vec<_>>();
    assert!(
        capabilities.contains(&"admin"),
        "approved app session user should keep admin capability"
    );

    let output = call_grant_ping_with_retry(&client, "auth-local-login").await;
    assert_eq!(
        output,
        GrantPingOutput {
            message: "auth-local-login".to_string(),
            approved: true,
        }
    );
}

#[tokio::test]
async fn auth_session_revoke_denies_reconnect() {
    assert_case_registered(
        "auth.session-revoke-denies-reconnect",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth session revoke client contract");
    let admin_contract =
        auth_session_revoke_admin_contract().expect("build auth session revoke admin contract");

    let client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust auth session revoke client");
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth session revoke admin client");

    let client_auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    client_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me before revocation");

    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let session_key = find_session_key_for_contract(
        &admin_auth
            .rpc()
            .auth()
            .sessions_list(&auth_sessions_list_request())
            .await
            .expect("list sessions before revocation"),
        "trellis.integration.auth-local-login-client@v1",
    )
    .expect("Auth.Sessions.List should include target app session");

    let revoked = admin_auth
        .rpc()
        .auth()
        .sessions_revoke(&trellis_rs::sdk::auth::types::AuthSessionsRevokeRequest {
            session_key: session_key.clone(),
        })
        .await
        .expect("revoke target app session through Auth.Sessions.Revoke");
    assert!(revoked.success);

    wait_for_session_absent(&admin_auth, &session_key).await;
    wait_for_sessions_me_denied(&client_auth).await;
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

fn auth_local_login_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.auth-local-login-client@v1",
        "Trellis Integration Auth Local Login Client",
        "App/client participant for the auth local-login binding fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.Me"]),
    )
    .use_ref(
        "grantService",
        trellis_rs::contracts::use_contract(SERVICE_ID).with_rpc_call(["Grant.Ping"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn auth_session_revoke_admin_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.auth-session-revoke-admin@v1",
        "Trellis Integration Auth Session Revoke Admin",
        "Admin participant for revoking app sessions through public Auth RPCs.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.List", "Auth.Sessions.Revoke"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn auth_sessions_list_request() -> trellis_rs::sdk::auth::types::AuthSessionsListRequest {
    trellis_rs::sdk::auth::types::AuthSessionsListRequest {
        limit: 500,
        offset: None,
        user: None,
    }
}

fn find_session_key_for_contract(
    sessions: &trellis_rs::sdk::auth::types::AuthSessionsListResponse,
    contract_id: &str,
) -> Option<String> {
    sessions.entries.iter().find_map(|entry| {
        let object = entry.as_object()?;
        if object.get("participantKind")?.as_str()? != "app" {
            return None;
        }
        if object.get("contractId")?.as_str()? != contract_id {
            return None;
        }
        object.get("sessionKey")?.as_str().map(str::to_string)
    })
}

async fn wait_for_session_absent(auth: &trellis_rs::sdk::auth::AuthClient<'_>, session_key: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let sessions = auth
            .rpc()
            .auth()
            .sessions_list(&auth_sessions_list_request())
            .await
            .expect("list sessions after revocation");
        let still_present = sessions.entries.iter().any(|entry| {
            entry
                .as_object()
                .and_then(|object| object.get("sessionKey"))
                .and_then(serde_json::Value::as_str)
                == Some(session_key)
        });
        if !still_present {
            return;
        }
        if Instant::now() >= deadline {
            panic!("revoked app session remained visible in Auth.Sessions.List");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_sessions_me_denied(auth: &trellis_rs::sdk::auth::AuthClient<'_>) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if auth.rpc().auth().sessions_me().await.is_err() {
            return;
        }
        if Instant::now() >= deadline {
            panic!("revoked app session continued to call Auth.Sessions.Me");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
