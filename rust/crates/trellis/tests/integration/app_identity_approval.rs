use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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

#[tokio::test]
async fn auth_local_login_rebinds_existing_session_with_updated_authority() {
    assert_case_registered(
        "auth.local-login-rebinds-existing-session-with-updated-authority",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth local-login client test contract");
    let updated_client_contract = auth_local_login_updated_client_contract()
        .expect("build updated auth local-login client test contract");
    let admin_contract =
        auth_session_revoke_admin_contract().expect("build auth local-login rebind admin contract");
    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&session_seed)
        .expect("derive local-login session key")
        .session_key;

    let original_client = fixture
        .admin
        .connect_client_with_session_seed(
            &fixture.bootstrap_url,
            &client_contract,
            session_seed.clone(),
        )
        .await
        .expect("connect original live Rust auth local-login client");
    call_grant_ping_with_retry(&original_client, "auth-local-login-rebind").await;
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth local-login rebind admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let before_session = app_session_for_key(&admin_auth, &session_key).await;
    let before_created_at = string_field(&before_session, "createdAt");
    let before_user_id = string_path(&before_session, &["principal", "userId"]);
    let rebound_client = fixture
        .admin
        .connect_client_with_session_seed(
            &fixture.bootstrap_url,
            &updated_client_contract,
            session_seed,
        )
        .await
        .expect("connect rebound live Rust auth local-login client");
    let after_session = app_session_for_key(&admin_auth, &session_key).await;
    assert_eq!(string_field(&after_session, "createdAt"), before_created_at);
    assert_eq!(
        string_path(&after_session, &["principal", "userId"]),
        before_user_id
    );
    assert_eq!(
        string_field(&after_session, "contractDisplayName"),
        "Trellis Integration Auth Local Login Client Updated",
    );

    let rebound_auth = trellis_rs::sdk::auth::AuthClient::new(&rebound_client);
    let allowed = rebound_auth
        .rpc()
        .auth()
        .connections_list(&auth_connections_list_request(Some(session_key.clone())))
        .await
        .expect("updated client can call Auth.Connections.List");
    assert!(!allowed.entries.is_empty());
    drop(original_client);
}

#[tokio::test]
async fn auth_local_login_replaces_session_when_identity_changes() {
    assert_case_registered(
        "auth.local-login-replaces-session-when-identity-changes",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth local-login client test contract");
    let updated_client_contract = auth_local_login_updated_client_contract()
        .expect("build updated auth local-login client test contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth local-login replacement admin contract");
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth local-login replacement admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let replacement = admin_auth
        .rpc()
        .auth()
        .users_create(&trellis_rs::sdk::auth::types::AuthUsersCreateRequest {
            active: Some(true),
            capabilities: None,
            capability_groups: Some(vec!["admin".to_string()]),
            email: Some("rust-auth-local-login-replacement@example.test".to_string()),
            name: Some("Rust Replacement Local Login Admin".to_string()),
            username: Some("rust-auth-local-login-replacement".to_string()),
        })
        .await
        .expect("create replacement local-login user");
    let reset = admin_auth
        .rpc()
        .auth()
        .users_password_reset_create(
            &trellis_rs::sdk::auth::types::AuthUsersPasswordResetCreateRequest {
                expires_in_seconds: None,
                user_id: replacement.user.user_id.clone(),
            },
        )
        .await
        .expect("create replacement local-login password reset");
    complete_local_password_account_flow(
        fixture.runtime.trellis_url(),
        &reset.flow_id,
        "rust-auth-local-login-replacement",
        "trellis-integration-rust-auth-local-login-replacement-password-2026",
    )
    .await;

    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&session_seed)
        .expect("derive local-login replacement session key")
        .session_key;
    let _original_client = fixture
        .admin
        .connect_client_with_session_seed(
            &fixture.bootstrap_url,
            &client_contract,
            session_seed.clone(),
        )
        .await
        .expect("connect original live Rust auth local-login replacement client");
    let before_session = app_session_for_key(&admin_auth, &session_key).await;

    let replacement_client = connect_with_local_password(
        fixture.runtime.trellis_url(),
        &updated_client_contract,
        &session_seed,
        "rust-auth-local-login-replacement",
        "trellis-integration-rust-auth-local-login-replacement-password-2026",
        &admin_auth,
        &replacement.user.user_id,
    )
    .await;
    let after_session =
        wait_for_session_principal(&admin_auth, &session_key, &replacement.user.user_id).await;
    assert_eq!(
        string_field(&after_session, "sessionKey"),
        string_field(&before_session, "sessionKey")
    );
    assert_ne!(
        string_path(&after_session, &["principal", "userId"]),
        string_path(&before_session, &["principal", "userId"]),
    );
    assert_eq!(
        string_field(&after_session, "contractDisplayName"),
        "Trellis Integration Auth Local Login Client Updated",
    );

    let replacement_auth = trellis_rs::sdk::auth::AuthClient::new(&replacement_client);
    let me = replacement_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as replacement client");
    assert_eq!(string_path(&me.user, &["userId"]), replacement.user.user_id);
}

#[tokio::test]
async fn auth_session_revoke_cleans_runtime_connection_presence() {
    assert_case_registered(
        "auth.session-revoke-cleans-runtime-connection-presence",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth session revoke client contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth session revoke connection admin contract");
    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&session_seed)
        .expect("derive auth session revoke session key")
        .session_key;

    let client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, session_seed)
        .await
        .expect("connect live Rust auth session revoke connection client");
    call_grant_ping_with_retry(&client, "auth-session-revoke-connection").await;
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth session revoke connection admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    app_session_for_key(&admin_auth, &session_key).await;
    wait_for_single_connection(&admin_auth, &session_key).await;

    let revoked = admin_auth
        .rpc()
        .auth()
        .sessions_revoke(&trellis_rs::sdk::auth::types::AuthSessionsRevokeRequest {
            session_key: session_key.clone(),
        })
        .await
        .expect("revoke app session through Auth.Sessions.Revoke");
    assert!(revoked.success);

    wait_for_session_absent(&admin_auth, &session_key).await;
    wait_for_connections_absent(&admin_auth, &session_key).await;
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(&client)).await;
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

fn auth_local_login_updated_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.auth-local-login-client@v1",
        "Trellis Integration Auth Local Login Client Updated",
        "Updated app/client participant for auth local-login rebinding fixtures.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.Me", "Auth.Connections.List"]),
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
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID).with_rpc_call([
            "Auth.Connections.List",
            "Auth.Sessions.List",
            "Auth.Sessions.Revoke",
            "Auth.Users.Create",
            "Auth.Users.PasswordReset.Create",
            "Auth.Users.Update",
        ]),
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

fn auth_connections_list_request(
    session_key: Option<String>,
) -> trellis_rs::sdk::auth::types::AuthConnectionsListRequest {
    trellis_rs::sdk::auth::types::AuthConnectionsListRequest {
        limit: 500,
        offset: None,
        session_key,
        user: None,
    }
}

async fn app_session_for_key(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) -> Value {
    auth.rpc()
        .auth()
        .sessions_list(&auth_sessions_list_request())
        .await
        .expect("list app sessions")
        .entries
        .into_iter()
        .find(|entry| {
            entry.get("participantKind").and_then(Value::as_str) == Some("app")
                && entry.get("sessionKey").and_then(Value::as_str) == Some(session_key)
        })
        .expect("Auth.Sessions.List should include app session")
}

async fn wait_for_single_connection(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let connections = auth
            .rpc()
            .auth()
            .connections_list(&auth_connections_list_request(Some(
                session_key.to_string(),
            )))
            .await
            .expect("list app connections");
        if connections.entries.len() == 1 {
            let connection = connections
                .entries
                .into_iter()
                .next()
                .expect("one connection");
            assert_eq!(
                connection.get("participantKind").and_then(Value::as_str),
                Some("app")
            );
            assert_eq!(
                connection.get("sessionKey").and_then(Value::as_str),
                Some(session_key)
            );
            return connection;
        }
        if Instant::now() >= deadline {
            panic!("expected exactly one runtime connection for app session {session_key}");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_connections_absent(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let connections = auth
            .rpc()
            .auth()
            .connections_list(&auth_connections_list_request(Some(
                session_key.to_string(),
            )))
            .await
            .expect("list app connections after revocation");
        if connections.entries.is_empty() {
            return;
        }
        if Instant::now() >= deadline {
            panic!("revoked app session kept runtime connection presence");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_session_principal(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
    user_id: &str,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let session = app_session_for_key(auth, session_key).await;
        if string_path(&session, &["principal", "userId"]) == user_id {
            return session;
        }
        if Instant::now() >= deadline {
            panic!("app session principal did not change to replacement user");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn string_field(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("expected string field {field}"))
        .to_string()
}

fn string_path(value: &Value, path: &[&str]) -> String {
    let mut current = value;
    for field in path {
        current = current
            .get(*field)
            .unwrap_or_else(|| panic!("expected field {field}"));
    }
    current
        .as_str()
        .unwrap_or_else(|| panic!("expected string at path {}", path.join(".")))
        .to_string()
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

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum BindFlowResponse {
    Bound {
        sentinel: trellis_rs::auth::SentinelCredsRecord,
        transports: trellis_rs::auth::ClientTransportsRecord,
    },
    ApprovalRequired,
    ApprovalDenied,
    InsufficientCapabilities,
}

async fn complete_local_password_account_flow(
    trellis_url: &str,
    flow_id: &str,
    username: &str,
    password: &str,
) {
    let response: Value = post_json_success(
        &format!(
            "{}/auth/account-flow/{}/local-password",
            trellis_url.trim_end_matches('/'),
            flow_id
        ),
        &json!({ "username": username, "password": password }),
    )
    .await;
    assert_eq!(
        response.get("status").and_then(Value::as_str),
        Some("created")
    );
}

async fn connect_with_local_password(
    trellis_url: &str,
    contract: &trellis_test::TrellisTestContract,
    session_seed: &str,
    username: &str,
    password: &str,
    admin_auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    user_id: &str,
) -> trellis_rs::client::TrellisClient {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)
        .expect("build session auth for local password login");
    let redirect_to = format!(
        "{}/_trellis/test/auth-local-login",
        trellis_url.trim_end_matches('/')
    );
    let flow_id = start_local_auth_flow(trellis_url, &redirect_to, &auth, contract).await;
    let _: Value = post_json_success(
        &format!("{}/auth/login/local", trellis_url.trim_end_matches('/')),
        &json!({ "flowId": flow_id, "username": username, "password": password }),
    )
    .await;
    approve_flow_if_needed(trellis_url, &flow_id, admin_auth, user_id).await;
    let BindFlowResponse::Bound {
        sentinel,
        transports,
    } = bind_flow(trellis_url, &auth, &flow_id).await
    else {
        panic!("local login flow did not bind after approval");
    };
    let native = transports
        .native
        .expect("bind response should include native transport");
    trellis_rs::client::TrellisClient::connect_user(trellis_rs::client::UserConnectOptions {
        servers: &native.nats_servers.join(","),
        sentinel_jwt: &sentinel.jwt,
        sentinel_seed: &sentinel.seed,
        session_key_seed_base64url: session_seed,
        contract_digest: contract.digest(),
        timeout_ms: 5_000,
    })
    .await
    .expect("connect bound local password client")
}

async fn start_local_auth_flow(
    trellis_url: &str,
    redirect_to: &str,
    auth: &trellis_rs::client::SessionAuth,
    contract: &trellis_test::TrellisTestContract,
) -> String {
    let sig = auth.sign_sha256_domain(
        "oauth-init",
        &auth_start_signature_payload(redirect_to, contract.manifest()),
    );
    let started: trellis_rs::auth::AuthStartResponse = post_json_success(
        &format!("{}/auth/requests", trellis_url.trim_end_matches('/')),
        &trellis_rs::auth::AuthStartRequest {
            provider: None,
            redirect_to: redirect_to.to_string(),
            session_key: auth.session_key.clone(),
            sig,
            contract: contract_manifest_map(contract),
            context: None,
        },
    )
    .await;
    match started {
        trellis_rs::auth::AuthStartResponse::FlowStarted { login_url, .. } => {
            flow_id_from_url(&login_url)
        }
        trellis_rs::auth::AuthStartResponse::Bound { .. } => {
            panic!("updated local-login auth request unexpectedly returned bound")
        }
    }
}

fn auth_start_signature_payload(redirect_to: &str, contract: &Value) -> String {
    format!(
        "{}:{}:{}:{}",
        redirect_to,
        "",
        trellis_rs::contracts::canonicalize_json(contract)
            .expect("canonicalize auth start contract"),
        trellis_rs::contracts::canonicalize_json(&Value::Null)
            .expect("canonicalize auth start context"),
    )
}

fn contract_manifest_map(contract: &trellis_test::TrellisTestContract) -> BTreeMap<String, Value> {
    let Value::Object(map) = contract.manifest() else {
        panic!("contract manifest must be a JSON object");
    };
    map.clone().into_iter().collect()
}

async fn approve_flow_if_needed(
    trellis_url: &str,
    flow_id: &str,
    admin_auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    user_id: &str,
) {
    let mut state: Value = fetch_json(&format!(
        "{}/auth/flow/{}",
        trellis_url.trim_end_matches('/'),
        flow_id
    ))
    .await;
    if state.get("status").and_then(Value::as_str) == Some("insufficient_capabilities") {
        let mut capabilities = state
            .get("missingCapabilities")
            .and_then(Value::as_array)
            .expect("insufficient capabilities response should include missingCapabilities")
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .expect("missing capability should be a string")
                    .to_string()
            })
            .collect::<Vec<_>>();
        capabilities.push("admin".to_string());
        capabilities.sort();
        capabilities.dedup();
        admin_auth
            .rpc()
            .auth()
            .users_update(&trellis_rs::sdk::auth::types::AuthUsersUpdateRequest {
                active: None,
                capabilities: Some(capabilities),
                capability_groups: None,
                email: None,
                name: None,
                user_id: user_id.to_string(),
            })
            .await
            .expect("grant replacement user missing capabilities");
        state = fetch_json(&format!(
            "{}/auth/flow/{}",
            trellis_url.trim_end_matches('/'),
            flow_id
        ))
        .await;
    }
    match state.get("status").and_then(Value::as_str) {
        Some("redirect") => {}
        Some("approval_required") => {
            let approved: Value = post_json_success(
                &format!(
                    "{}/auth/flow/{}/approval",
                    trellis_url.trim_end_matches('/'),
                    flow_id
                ),
                &json!({ "approved": true }),
            )
            .await;
            assert_eq!(
                approved.get("status").and_then(Value::as_str),
                Some("redirect")
            );
        }
        status => panic!("unexpected local auth flow status: {status:?}"),
    }
}

async fn bind_flow(
    trellis_url: &str,
    auth: &trellis_rs::client::SessionAuth,
    flow_id: &str,
) -> BindFlowResponse {
    post_json_success(
        &format!(
            "{}/auth/flow/{}/bind",
            trellis_url.trim_end_matches('/'),
            flow_id
        ),
        &json!({
            "sessionKey": auth.session_key.clone(),
            "sig": auth.sign_sha256_domain("bind-flow", flow_id),
        }),
    )
    .await
}

async fn fetch_json(url: &str) -> Value {
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("build HTTP client")
        .get(url)
        .send()
        .await
        .expect("send JSON GET");
    decode_json_response(url, response).await
}

async fn post_json_success<T>(url: &str, body: &impl Serialize) -> T
where
    T: for<'de> Deserialize<'de>,
{
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("build HTTP client")
        .post(url)
        .json(body)
        .send()
        .await
        .expect("send JSON POST");
    decode_json_response(url, response).await
}

async fn decode_json_response<T>(url: &str, response: reqwest::Response) -> T
where
    T: for<'de> Deserialize<'de>,
{
    let status = response.status();
    let body = response.text().await.expect("read HTTP body");
    assert!(
        status.is_success(),
        "HTTP request failed ({}) for {url}: {body}",
        status.as_u16()
    );
    serde_json::from_str(&body).expect("decode JSON response")
}

fn flow_id_from_url(url: &str) -> String {
    reqwest::Url::parse(url)
        .expect("parse auth URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| panic!("Trellis auth URL is missing flowId: {url}"))
}
