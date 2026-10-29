use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rusqlite::params;
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
const LIFECYCLE_SERVICE_ID: &str = "trellis.integration.user-lifecycle-service-automation@v1";
const LIFECYCLE_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.user-lifecycle-service-automation@v1",
  "displayName": "User Lifecycle Automation Integration Service",
  "description": "Exercises exact identity lifecycle automation without admin authority.",
  "kind": "service",
  "uses": {
    "required": {
      "trellis.auth@v1": {
        "contract": "trellis.auth@v1",
        "rpc": {
          "call": [
            "Auth.UserLifecycle.Deactivate",
            "Auth.UserLifecycle.Inspect",
            "Auth.UserLifecycle.Unlink"
          ]
        }
      }
    }
  }
}"#;

struct LifecycleAutomationServiceContract;

impl GeneratedServiceContract for LifecycleAutomationServiceContract {
    const CONTRACT_ID: &'static str = LIFECYCLE_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "runtime";
    const CONTRACT_JSON: &'static str = LIFECYCLE_SERVICE_CONTRACT_JSON;
}

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
      "auth": {
        "contract": "trellis.auth@v1",
        "rpc": { "call": ["Auth.Sessions.Me"] }
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
    const CONTRACT_DIGEST: &'static str = "_S-nK_6ABg0LGC21T3UeH5XkTqxNmzOoSteAMIyZXJ4";
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
    service_caller: trellis_rs::generated::Caller,
    service_session_key: String,
    #[allow(dead_code)]
    service_task: AbortOnDrop<Result<(), ServiceRuntimeError>>,
}

async fn setup_app_identity_environment() -> AppIdentityFixture {
    setup_app_identity_environment_with_options(trellis_test::TrellisTestRuntimeOptions::default())
        .await
}

async fn setup_app_identity_environment_with_options(
    options: trellis_test::TrellisTestRuntimeOptions,
) -> AppIdentityFixture {
    let runtime = trellis_test::TrellisTestRuntime::start(options)
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
    let service_caller = service.caller().clone();
    let service_session_key = service_key.session_key;

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    AppIdentityFixture {
        runtime,
        admin,
        bootstrap_url,
        client_contract,
        service_caller,
        service_session_key,
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

    drop(client);
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

    let auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&client));
    let me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as approved app client");

    assert_eq!(me.participant_kind.as_str(), "app");
    let user = me
        .user
        .as_ref()
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
async fn auth_portal_route_selection_and_policy_drive_browser_flow() {
    let mut options = trellis_test::TrellisTestRuntimeOptions::default();
    options.oauth_providers.insert(
        "github".to_string(),
        json!({
            "type": "github",
            "clientId": "github-client",
            "clientSecret": "github-secret",
            "displayName": "GitHub"
        }),
    );
    options.oauth_providers.insert(
        "google".to_string(),
        json!({
            "type": "oidc",
            "issuer": "https://accounts.google.example",
            "clientId": "google-client",
            "clientSecret": "google-secret",
            "displayName": "Google"
        }),
    );
    let mut fixture = setup_app_identity_environment_with_options(options).await;
    let client_contract = auth_local_login_client_contract()
        .expect("build auth portal route selection client contract");
    let client_contract_id = "trellis.integration.auth-local-login-client@v1";
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth portal route selection admin contract");
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth portal admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    let trellis_url = fixture.runtime.trellis_url();
    let app_origin = reqwest::Url::parse(trellis_url)
        .expect("parse runtime URL")
        .origin()
        .ascii_serialization();
    let portal_id = "rust-auth-portal-route-selection";
    let default_portal_id = "rust-auth-portal-route-selection-default";
    let custom_entry_url = "https://custom.portal.example/_trellis/login";
    let default_entry_url = "https://default.portal.example/_trellis/login";

    auth.rpc()
        .auth()
        .portals_put(&trellis_rs::sdk::auth::types::AuthPortalsPutRequest {
            disabled: None,
            display_name: "Rust Default Route Selection Portal".to_string(),
            entry_url: default_entry_url.to_string(),
            portal_id: default_portal_id.to_string(),
        })
        .await
        .expect("put default login portal");
    auth.rpc()
        .auth()
        .portals_routes_put(&trellis_rs::sdk::auth::types::AuthPortalsRoutesPutRequest {
            contract_id: Some(None),
            disabled: None,
            origin: Some(None),
            portal_id: default_portal_id.to_string(),
        })
        .await
        .expect("put default login portal route");
    auth.rpc()
        .auth()
        .portals_put(&trellis_rs::sdk::auth::types::AuthPortalsPutRequest {
            disabled: None,
            display_name: "Rust Custom Route Selection Portal".to_string(),
            entry_url: custom_entry_url.to_string(),
            portal_id: portal_id.to_string(),
        })
        .await
        .expect("put custom login portal");
    auth.rpc()
        .auth()
        .portals_login_settings_update(
            &trellis_rs::sdk::auth::types::AuthPortalsLoginSettingsUpdateRequest {
                allowed_federated_providers: Some(vec!["github".to_string()]),
                default_capabilities: vec![],
                default_capability_groups: vec![],
                federated_registration_enabled: true,
                local_registration_enabled: false,
                portal_id: portal_id.to_string(),
                self_registered_account_active: false,
            },
        )
        .await
        .expect("update custom login portal settings");
    put_custom_portal_route(&auth, portal_id, client_contract_id, &app_origin, false).await;

    let (custom_flow_id, custom_login_url) = start_browser_flow(
        trellis_url,
        &format!("{app_origin}/return"),
        &client_contract,
    )
    .await;
    assert_eq!(
        reqwest::Url::parse(&custom_login_url)
            .expect("parse custom login URL")
            .origin()
            .ascii_serialization(),
        "https://custom.portal.example"
    );
    assert_eq!(
        custom_login_url,
        format!("{custom_entry_url}?flowId={custom_flow_id}")
    );
    assert_flow_uses_portal(
        trellis_url,
        &custom_flow_id,
        portal_id,
        json!([
            { "id": "local", "displayName": "Username and password" },
            { "id": "github", "displayName": "GitHub" }
        ]),
        Some((false, true)),
    )
    .await;

    put_custom_portal_route(&auth, portal_id, client_contract_id, &app_origin, true).await;
    let (disabled_flow_id, disabled_login_url) = start_browser_flow(
        trellis_url,
        &format!("{app_origin}/disabled"),
        &client_contract,
    )
    .await;
    assert_eq!(
        reqwest::Url::parse(&disabled_login_url)
            .expect("parse disabled fallback login URL")
            .origin()
            .ascii_serialization(),
        "https://default.portal.example"
    );
    assert_flow_uses_portal(
        trellis_url,
        &disabled_flow_id,
        default_portal_id,
        json!([
            { "id": "local", "displayName": "Username and password" },
            { "id": "github", "displayName": "GitHub" },
            { "id": "google", "displayName": "Google" }
        ]),
        None,
    )
    .await;

    put_custom_portal_route(&auth, portal_id, client_contract_id, &app_origin, false).await;
    auth.rpc()
        .auth()
        .portals_routes_remove(
            &trellis_rs::sdk::auth::types::AuthPortalsRoutesRemoveRequest {
                contract_id: Some(Some(client_contract_id.to_string())),
                origin: Some(Some(app_origin.clone())),
                portal_id: portal_id.to_string(),
            },
        )
        .await
        .expect("remove custom login portal route");
    let (removed_flow_id, removed_login_url) = start_browser_flow(
        trellis_url,
        &format!("{app_origin}/removed"),
        &client_contract,
    )
    .await;
    assert_eq!(
        reqwest::Url::parse(&removed_login_url)
            .expect("parse removed fallback login URL")
            .origin()
            .ascii_serialization(),
        "https://default.portal.example"
    );
    assert_flow_uses_portal(
        trellis_url,
        &removed_flow_id,
        default_portal_id,
        json!([
            { "id": "local", "displayName": "Username and password" },
            { "id": "github", "displayName": "GitHub" },
            { "id": "google", "displayName": "Google" }
        ]),
        None,
    )
    .await;
}

#[tokio::test]
async fn auth_portal_admin_protects_built_in_and_route_conflicts() {
    let mut fixture = setup_app_identity_environment().await;
    let client_contract_id = "trellis.integration.auth-local-login-client@v1";
    let admin_contract =
        auth_session_revoke_admin_contract().expect("build auth portal admin conflicts contract");
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth portal admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    let app_origin = reqwest::Url::parse(fixture.runtime.trellis_url())
        .expect("parse runtime URL")
        .origin()
        .ascii_serialization();
    let built_in_portal_id = "trellis.builtin.login";
    let portal_id = "rust-auth-portal-admin-conflicts";
    let conflict_portal_id = "rust-auth-portal-admin-conflicts-alt";

    auth.rpc()
        .auth()
        .portals_list(&trellis_rs::sdk::auth::types::AuthPortalsListRequest {
            limit: 10,
            offset: None,
        })
        .await
        .expect("list portals to project built-in login portal");
    assert_validation_rpc_error(
        auth.rpc()
            .auth()
            .portals_put(&trellis_rs::sdk::auth::types::AuthPortalsPutRequest {
                disabled: None,
                display_name: "Blocked Built-in Portal Update".to_string(),
                entry_url: "https://portal-admin-conflicts.example/_trellis/login".to_string(),
                portal_id: built_in_portal_id.to_string(),
            })
            .await,
    );
    assert_validation_rpc_error(
        auth.rpc()
            .auth()
            .portals_remove(&trellis_rs::sdk::auth::types::AuthPortalsRemoveRequest {
                portal_id: built_in_portal_id.to_string(),
            })
            .await,
    );

    auth.rpc()
        .auth()
        .portals_put(&trellis_rs::sdk::auth::types::AuthPortalsPutRequest {
            disabled: None,
            display_name: "Rust Portal Admin Conflicts".to_string(),
            entry_url: "https://portal-admin-conflicts.example/_trellis/login".to_string(),
            portal_id: portal_id.to_string(),
        })
        .await
        .expect("put custom portal");
    auth.rpc()
        .auth()
        .portals_put(&trellis_rs::sdk::auth::types::AuthPortalsPutRequest {
            disabled: None,
            display_name: "Rust Portal Admin Conflicts Alt".to_string(),
            entry_url: "https://portal-admin-conflicts-alt.example/_trellis/login".to_string(),
            portal_id: conflict_portal_id.to_string(),
        })
        .await
        .expect("put conflicting custom portal");
    put_custom_portal_route(&auth, portal_id, client_contract_id, &app_origin, false).await;

    assert_validation_rpc_error(
        auth.rpc()
            .auth()
            .portals_routes_put(&trellis_rs::sdk::auth::types::AuthPortalsRoutesPutRequest {
                contract_id: Some(Some(client_contract_id.to_string())),
                disabled: None,
                origin: Some(Some(app_origin.clone())),
                portal_id: conflict_portal_id.to_string(),
            })
            .await,
    );
    assert_validation_rpc_error(
        auth.rpc()
            .auth()
            .portals_remove(&trellis_rs::sdk::auth::types::AuthPortalsRemoveRequest {
                portal_id: portal_id.to_string(),
            })
            .await,
    );

    let removed_route = auth
        .rpc()
        .auth()
        .portals_routes_remove(
            &trellis_rs::sdk::auth::types::AuthPortalsRoutesRemoveRequest {
                contract_id: Some(Some(client_contract_id.to_string())),
                origin: Some(Some(app_origin.clone())),
                portal_id: portal_id.to_string(),
            },
        )
        .await
        .expect("remove targeted portal route");
    assert!(removed_route.success);
    let removed_portal = auth
        .rpc()
        .auth()
        .portals_remove(&trellis_rs::sdk::auth::types::AuthPortalsRemoveRequest {
            portal_id: portal_id.to_string(),
        })
        .await
        .expect("remove untargeted custom portal");
    assert!(removed_portal.success);
}

#[tokio::test]
async fn auth_grant_overrides_bind_without_user_capability() {
    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth grant override client contract");
    let admin_contract =
        auth_session_revoke_admin_contract().expect("build auth grant override admin contract");
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth grant override admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    let user = admin_auth
        .rpc()
        .auth()
        .users_create(&trellis_rs::sdk::auth::types::AuthUsersCreateRequest {
            active: Some(true),
            capabilities: Some(vec![]),
            capability_groups: Some(vec![]),
            email: Some("rust-auth-grant-overrides@example.test".to_string()),
            name: Some("Rust Grant Override Local Login User".to_string()),
            username: Some("rust-auth-grant-overrides".to_string()),
        })
        .await
        .expect("create grant override local-login user");
    let reset = admin_auth
        .rpc()
        .auth()
        .users_password_reset_create(
            &trellis_rs::sdk::auth::types::AuthUsersPasswordResetCreateRequest {
                expires_in_seconds: None,
                user_id: user.user.user_id.clone(),
            },
        )
        .await
        .expect("create grant override local-login password reset");
    complete_local_password_account_flow(
        fixture.runtime.trellis_url(),
        &reset.flow_id,
        "rust-auth-grant-overrides",
        "trellis-integration-rust-auth-grant-overrides-password-2026",
    )
    .await;

    let deployment_id = "test";
    let trellis_origin = reqwest::Url::parse(fixture.runtime.trellis_url())
        .expect("parse runtime URL")
        .origin()
        .ascii_serialization();
    let web_row = json!({
        "deploymentId": deployment_id,
        "identityKind": "web",
        "grantKind": "capability",
        "contractId": "trellis.integration.auth-local-login-client@v1",
        "origin": trellis_origin,
        "sessionPublicKey": Value::Null,
        "capability": APPROVED_PING_CAPABILITY,
        "capabilityGroupKey": Value::Null,
    });
    let mut wrong_origin_row = web_row.clone();
    wrong_origin_row["origin"] = json!("https://wrong.example");
    put_grant_override(&admin_auth, deployment_id, &wrong_origin_row).await;
    assert_listed_grant_override(&admin_auth, deployment_id, Some(&wrong_origin_row)).await;
    assert!(matches!(
        bind_plain_local_password(
            fixture.runtime.trellis_url(),
            &client_contract,
            &trellis_rs::auth::generate_session_keypair().0,
            "rust-auth-grant-overrides",
            "trellis-integration-rust-auth-grant-overrides-password-2026",
            &format!(
                "{}/_trellis/test/auth-local-login",
                fixture.runtime.trellis_url()
            )
        )
        .await,
        BindFlowResponse::InsufficientCapabilities
    ));

    put_grant_override(&admin_auth, deployment_id, &web_row).await;
    assert_listed_grant_override(&admin_auth, deployment_id, Some(&web_row)).await;
    let web_client = connect_plain_local_password(
        fixture.runtime.trellis_url(),
        &client_contract,
        &trellis_rs::auth::generate_session_keypair().0,
        "rust-auth-grant-overrides",
        "trellis-integration-rust-auth-grant-overrides-password-2026",
        &format!(
            "{}/_trellis/test/auth-local-login",
            fixture.runtime.trellis_url()
        ),
    )
    .await;
    let me = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&web_client))
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("grant override app can call Auth.Sessions.Me");
    assert_eq!(
        me.user
            .as_ref()
            .and_then(|user| user.get("capabilities"))
            .and_then(Value::as_array)
            .expect("grant override user should include capabilities")
            .len(),
        0
    );
    assert_eq!(
        call_grant_ping_with_retry(&web_client, "auth-grant-overrides-web").await,
        GrantPingOutput {
            message: "auth-grant-overrides-web".to_string(),
            approved: true,
        }
    );

    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::auth::session_public_key(&session_seed)
        .expect("derive grant override session key");
    let session_row = json!({
        "deploymentId": deployment_id,
        "identityKind": "session",
        "grantKind": "capability",
        "contractId": "trellis.integration.auth-local-login-client@v1",
        "origin": Value::Null,
        "sessionPublicKey": session_key,
        "capability": APPROVED_PING_CAPABILITY,
        "capabilityGroupKey": Value::Null,
    });
    put_grant_override(&admin_auth, deployment_id, &session_row).await;
    assert_listed_grant_override(&admin_auth, deployment_id, Some(&session_row)).await;
    assert!(matches!(
        bind_plain_local_password(
            fixture.runtime.trellis_url(),
            &client_contract,
            &trellis_rs::auth::generate_session_keypair().0,
            "rust-auth-grant-overrides",
            "trellis-integration-rust-auth-grant-overrides-password-2026",
            "/_trellis/test/auth-local-login"
        )
        .await,
        BindFlowResponse::InsufficientCapabilities
    ));
    let session_client = connect_plain_local_password(
        fixture.runtime.trellis_url(),
        &client_contract,
        &session_seed,
        "rust-auth-grant-overrides",
        "trellis-integration-rust-auth-grant-overrides-password-2026",
        "/_trellis/test/auth-local-login",
    )
    .await;
    assert_eq!(
        call_grant_ping_with_retry(&session_client, "auth-grant-overrides-session").await,
        GrantPingOutput {
            message: "auth-grant-overrides-session".to_string(),
            approved: true,
        }
    );

    let removed = admin_auth
        .rpc()
        .auth()
        .deployment_authority_grant_overrides_remove(
            &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityGrantOverridesRemoveRequest {
                deployment_id: deployment_id.to_string(),
                overrides: vec![trellis_rs::sdk::auth::types::AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItem::CapabilitySession {
                    capability: APPROVED_PING_CAPABILITY.to_string(),
                    capability_group_key: Value::Null,
                    contract_id: "trellis.integration.auth-local-login-client@v1".to_string(),
                    deployment_id: deployment_id.to_string(),
                    grant_kind: trellis_rs::sdk::auth::types::AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionGrantKind::Capability,
                    identity_kind: trellis_rs::sdk::auth::types::AuthDeploymentAuthorityGrantOverridesRemoveRequestOverridesItemCapabilitySessionIdentityKind::Session,
                    origin: Value::Null,
                    session_public_key: session_key,
                }],
            },
        )
        .await
        .expect("remove exact grant override row");
    assert!(removed.grant_overrides.is_empty());
    assert_listed_grant_override(&admin_auth, deployment_id, None).await;
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

    let client_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&client));
    client_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me before revocation");

    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
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
async fn auth_sessions_logout_deletes_session_and_connections() {
    assert_case_registered(
        "auth.sessions-logout-deletes-session-and-connections",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth sessions logout client contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth sessions logout connection admin contract");
    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&session_seed)
        .expect("derive auth sessions logout session key")
        .session_key;

    let client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, session_seed)
        .await
        .expect("connect live Rust auth sessions logout client");
    call_grant_ping_with_retry(&client, "auth-sessions-logout").await;
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth sessions logout admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    app_session_for_key(&admin_auth, &session_key).await;
    wait_for_single_connection(&admin_auth, &session_key).await;

    let client_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&client));
    let logout = client_auth
        .rpc()
        .auth()
        .sessions_logout()
        .await
        .expect("logout app session through Auth.Sessions.Logout");
    assert!(logout.success);

    wait_for_session_absent(&admin_auth, &session_key).await;
    wait_for_connections_absent(&admin_auth, &session_key).await;
    wait_for_sessions_me_denied(&client_auth).await;
}

#[tokio::test]
async fn auth_sessions_logout_cleans_connections_after_kick_failure() {
    assert_case_registered(
        "auth.sessions-logout-cleans-connections-after-kick-failure",
        "auth",
        "app_identity_approval",
    );

    let mut options = trellis_test::TrellisTestRuntimeOptions::default();
    options
        .fail_once_hooks
        .push("auth.sessions.logout.kickRuntimeAccess".to_string());
    let mut fixture = setup_app_identity_environment_with_options(options).await;
    let client_contract = auth_local_login_client_contract()
        .expect("build auth sessions logout kick failure client contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth sessions logout kick failure admin contract");
    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&session_seed)
        .expect("derive auth sessions logout kick failure session key")
        .session_key;

    let client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, session_seed)
        .await
        .expect("connect live Rust auth sessions logout kick failure client");
    call_grant_ping_with_retry(&client, "auth-sessions-logout-kick-failure").await;
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth sessions logout kick failure admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    app_session_for_key(&admin_auth, &session_key).await;
    wait_for_single_connection(&admin_auth, &session_key).await;

    let logout = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&client))
        .rpc()
        .auth()
        .sessions_logout()
        .await
        .expect("logout app session while kick hook rejects");
    assert!(logout.success);

    wait_for_session_absent(&admin_auth, &session_key).await;
    wait_for_connections_absent(&admin_auth, &session_key).await;
}

#[tokio::test]
async fn auth_sessions_me_reports_app_envelope() {
    assert_case_registered(
        "auth.sessions-me-reports-app-envelope",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth sessions me client contract");
    let client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust auth sessions me client");
    let me = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&client))
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as app");

    assert_eq!(me.participant_kind.as_str(), "app");
    let user = me.user.as_ref().expect("app session should include user");
    assert_eq!(user.get("active").and_then(Value::as_bool), Some(true));
    assert!(user
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("user should include capabilities")
        .iter()
        .any(|capability| capability.as_str() == Some("admin")));
    assert!(me.device.is_none());
    assert!(me.service.is_none());
}

#[tokio::test]
async fn auth_sessions_me_reports_service_envelope_and_current_user_state() {
    assert_case_registered(
        "auth.sessions-me-reports-service-envelope-and-current-user-state",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract =
        auth_local_login_client_contract().expect("build auth sessions me current client contract");
    let client_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&client_seed)
        .expect("derive auth sessions me current session key")
        .session_key;
    let client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, client_seed)
        .await
        .expect("connect live Rust auth sessions me current client");
    let client_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&client));
    let first = client_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me before current user mutations");
    let user = first
        .user
        .as_ref()
        .expect("app session should include user");
    assert_eq!(user.get("active").and_then(Value::as_bool), Some(true));
    assert!(user
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("user should include capabilities")
        .iter()
        .any(|capability| capability.as_str() == Some("admin")));
    let original_capabilities = user
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("user should include capabilities")
        .iter()
        .map(|capability| {
            capability
                .as_str()
                .expect("capability should be a string")
                .to_string()
        })
        .collect::<Vec<_>>();

    let sqlite = fixture.runtime.control_plane_sqlite();
    let user_id = session_user_id(&sqlite, &session_key);
    sqlite
        .execute(
            "UPDATE users SET capabilities = ?, capability_groups = ? WHERE user_id = ?",
            params![
                serde_json::to_string(&original_capabilities).expect("serialize capabilities"),
                json!(["admin"]).to_string(),
                user_id.as_str()
            ],
        )
        .expect("update user capability groups");
    let grouped = client_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me after group capability mutation");
    assert!(grouped
        .user
        .as_ref()
        .expect("grouped session should include user")
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("grouped user should include capabilities")
        .iter()
        .any(|capability| capability.as_str() == Some("trellis.auth::device.review")));

    let service_session_key = fixture.service_session_key.clone();
    let session_rows = sqlite
        .query(
            "SELECT session FROM sessions WHERE session_key = ?",
            [&service_session_key],
        )
        .expect("query service session");
    let mut service_session: Value = serde_json::from_str(
        session_rows
            .first()
            .and_then(|row| row.get("session"))
            .and_then(Value::as_str)
            .expect("service session JSON should exist"),
    )
    .expect("parse service session JSON");
    let stale_deployment = format!(
        "{}.stale",
        service_session
            .get("deploymentId")
            .and_then(Value::as_str)
            .expect("service session deployment id")
    );
    service_session["deploymentId"] = Value::String(stale_deployment.clone());
    sqlite
        .execute(
            "UPDATE sessions SET deployment_id = ?, session = ? WHERE session_key = ?",
            params![
                stale_deployment,
                service_session.to_string(),
                service_session_key.as_str()
            ],
        )
        .expect("make stored service session deployment stale");
    sqlite
        .execute(
            "UPDATE service_instances SET capabilities = ? WHERE instance_key = ?",
            params![
                json!(["service.current"]).to_string(),
                service_session_key.as_str()
            ],
        )
        .expect("update current service instance capabilities");

    let service_auth = trellis_rs::sdk::auth::AuthClient::new(&fixture.service_caller);
    let service_me = service_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as service");
    assert_eq!(service_me.participant_kind.as_str(), "service");
    let service = service_me
        .service
        .as_ref()
        .expect("service session should include service envelope");
    assert_eq!(service.get("active").and_then(Value::as_bool), Some(true));
    assert!(service
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("service should include capabilities")
        .iter()
        .any(|capability| capability.as_str() == Some("service.current")));
    assert!(service_me.user.is_none());
    assert!(service_me.device.is_none());

    let mut inactive_capabilities = original_capabilities.clone();
    inactive_capabilities.push("users.write".to_string());
    sqlite
        .execute(
            "UPDATE users SET active = 0, capabilities = ?, capability_groups = ? WHERE user_id = ?",
            params![
                serde_json::to_string(&inactive_capabilities).expect("serialize capabilities"),
                json!([]).to_string(),
                user_id.as_str()
            ],
        )
        .expect("update user active and capabilities");
    assert!(client_auth.rpc().auth().sessions_me().await.is_err());
}

#[tokio::test]
async fn auth_sessions_list_and_connections_list_report_participant_metadata() {
    assert_case_registered(
        "auth.sessions-list-and-connections-list-report-participant-metadata",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract = auth_local_login_client_contract()
        .expect("build auth sessions list metadata client contract");
    let agent_contract = auth_local_login_agent_contract()
        .expect("build auth sessions list metadata agent contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth sessions list metadata admin contract");
    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&session_seed)
        .expect("derive auth sessions list metadata session key")
        .session_key;
    let agent_seed = trellis_rs::auth::generate_session_keypair().0;
    let agent_session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&agent_seed)
        .expect("derive auth sessions list metadata agent session key")
        .session_key;

    let client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, session_seed)
        .await
        .expect("connect live Rust auth sessions list metadata client");
    call_grant_ping_with_retry(&client, "auth-list-metadata").await;
    let agent = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &agent_contract, agent_seed)
        .await
        .expect("connect live Rust auth sessions list metadata agent");
    call_grant_ping_with_retry(&agent, "auth-list-metadata-agent").await;
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth sessions list metadata admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));

    let sessions = admin_auth
        .rpc()
        .auth()
        .sessions_list(&auth_sessions_list_request())
        .await
        .expect("list auth sessions with metadata");
    let app_session = sessions
        .entries
        .iter()
        .find_map(|entry| match entry {
            trellis_rs::sdk::auth::types::AuthSessionsListResponseEntriesItem::App {
                contract_display_name,
                contract_id,
                principal,
                session_key: entry_session_key,
                ..
            } if entry_session_key == &session_key => {
                Some((contract_display_name, contract_id, principal))
            }
            _ => None,
        })
        .expect("Auth.Sessions.List should include app metadata row");
    assert_eq!(app_session.2.r#type.as_str(), "user");
    assert!(!app_session.2.user_id.is_empty());
    assert_eq!(
        app_session.1,
        "trellis.integration.auth-local-login-client@v1"
    );
    assert_eq!(app_session.0, "Trellis Integration Auth Local Login Client");

    let agent_session = sessions
        .entries
        .iter()
        .find_map(|entry| match entry {
            trellis_rs::sdk::auth::types::AuthSessionsListResponseEntriesItem::Agent {
                contract_display_name,
                contract_id,
                principal,
                session_key: entry_session_key,
                ..
            } if entry_session_key == &agent_session_key => {
                Some((contract_display_name, contract_id, principal))
            }
            _ => None,
        })
        .expect("Auth.Sessions.List should include agent metadata row");
    assert_eq!(agent_session.2.r#type.as_str(), "user");
    assert!(!agent_session.2.user_id.is_empty());
    assert_eq!(
        agent_session.1,
        "trellis.integration.auth-local-login-agent@v1"
    );
    assert_eq!(
        agent_session.0,
        "Trellis Integration Auth Local Login Agent"
    );

    let service_session = sessions
        .entries
        .iter()
        .find_map(|entry| match entry {
            trellis_rs::sdk::auth::types::AuthSessionsListResponseEntriesItem::Service {
                principal,
                ..
            } => Some(principal),
            _ => None,
        })
        .expect("Auth.Sessions.List should include service metadata row");
    assert_eq!(service_session.r#type.as_str(), "service");
    assert!(!service_session.instance_id.is_empty());
    assert!(!service_session.deployment_id.is_empty());

    let connection = wait_for_single_connection(&admin_auth, &session_key).await;
    assert_eq!(string_path(&connection, &["principal", "type"]), "user");
    assert!(!string_path(&connection, &["principal", "userId"]).is_empty());
    assert_eq!(
        string_field(&connection, "contractId"),
        "trellis.integration.auth-local-login-client@v1"
    );
    assert_eq!(
        string_field(&connection, "contractDisplayName"),
        "Trellis Integration Auth Local Login Client",
    );
    assert!(!string_field(&connection, "userNkey").is_empty());

    let agent_connection =
        wait_for_single_connection_for_kind(&admin_auth, &agent_session_key, "agent").await;
    assert_eq!(
        string_path(&agent_connection, &["principal", "type"]),
        "user"
    );
    assert!(!string_path(&agent_connection, &["principal", "userId"]).is_empty());
    assert_eq!(
        string_field(&agent_connection, "contractId"),
        "trellis.integration.auth-local-login-agent@v1"
    );
    assert_eq!(
        string_field(&agent_connection, "contractDisplayName"),
        "Trellis Integration Auth Local Login Agent",
    );
    assert!(!string_field(&agent_connection, "userNkey").is_empty());
}

#[tokio::test]
async fn auth_connections_list_skips_malformed_connection_entries() {
    assert_case_registered(
        "auth.connections-list-skips-malformed-connection-entries",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract = auth_local_login_client_contract()
        .expect("build auth connections malformed client contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth connections malformed admin contract");
    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&session_seed)
        .expect("derive auth connections malformed session key")
        .session_key;

    let client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, session_seed)
        .await
        .expect("connect live Rust auth connections malformed client");
    call_grant_ping_with_retry(&client, "auth-connections-malformed").await;
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth connections malformed admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    let valid = wait_for_single_connection(&admin_auth, &session_key).await;
    let user_nkey = string_field(&valid, "userNkey");
    let user_id = string_path(&valid, &["principal", "userId"]);

    fixture
        .runtime
        .seed_raw_auth_connection_presence(trellis_test::TrellisRawAuthConnectionPresence {
            key: connection_presence_key(&session_key, &user_id, &format!("{user_nkey}_malformed")),
            value: json!({
                "serverId": "malformed-server",
                "connectedAt": "2026-04-10T00:00:00.000Z"
            }),
        })
        .await
        .expect("seed malformed auth connection presence");

    let listed = admin_auth
        .rpc()
        .auth()
        .connections_list(&auth_connections_list_request(Some(session_key)))
        .await
        .expect("list auth connections with malformed presence");
    assert_eq!(listed.count, 1);
    assert_eq!(listed.entries.len(), 1);
    let trellis_rs::sdk::auth::types::AuthConnectionsListResponseEntriesItem::App {
        user_nkey: listed_user_nkey,
        ..
    } = &listed.entries[0]
    else {
        panic!("expected app connection");
    };
    assert_eq!(listed_user_nkey, &user_nkey);
}

#[tokio::test]
async fn auth_sessions_me_rejects_stale_user_principals() {
    assert_case_registered(
        "auth.sessions-me-rejects-stale-user-principals",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract = auth_local_login_client_contract()
        .expect("build auth sessions me stale user client contract");
    let session_seed = trellis_rs::auth::generate_session_keypair().0;
    let session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&session_seed)
        .expect("derive auth sessions me stale user session key")
        .session_key;
    let client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, session_seed)
        .await
        .expect("connect live Rust auth sessions me stale user client");
    let client_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&client));
    client_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me before stale user mutations");

    let sqlite = fixture.runtime.control_plane_sqlite();
    let snapshot = sqlite
        .take_session(&session_key)
        .expect("delete app session row")
        .expect("app session row should exist");
    assert!(client_auth.rpc().auth().sessions_me().await.is_err());
    snapshot.restore().expect("restore app session row");

    let user_id = session_user_id(&sqlite, &session_key);
    sqlite
        .execute("DELETE FROM users WHERE user_id = ?", params![user_id])
        .expect("delete app session user projection");
    assert!(client_auth.rpc().auth().sessions_me().await.is_err());
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
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
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

    let rebound_auth =
        trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&rebound_client));
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
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
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

    let replacement_auth =
        trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&replacement_client));
    let me = replacement_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as replacement client");
    assert_eq!(
        me.user
            .as_ref()
            .and_then(|user| user.get("userId"))
            .and_then(Value::as_str),
        Some(replacement.user.user_id.as_str())
    );
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
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
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
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&client),
    ))
    .await;
}

#[tokio::test]
async fn auth_sessions_revoke_cascades_app_grants() {
    assert_case_registered(
        "auth.sessions-revoke-cascades-app-grants",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let client_contract = auth_local_login_client_contract()
        .expect("build auth sessions revoke cascade client contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth sessions revoke cascade admin contract");
    let first_seed = trellis_rs::auth::generate_session_keypair().0;
    let first_session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&first_seed)
        .expect("derive first cascade session key")
        .session_key;
    let second_seed = trellis_rs::auth::generate_session_keypair().0;
    let second_session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&second_seed)
        .expect("derive second cascade session key")
        .session_key;

    let first_client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, first_seed)
        .await
        .expect("connect first live Rust auth sessions revoke cascade client");
    let second_client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, second_seed)
        .await
        .expect("connect second live Rust auth sessions revoke cascade client");
    call_grant_ping_with_retry(&first_client, "auth-session-revoke-cascade-1").await;
    call_grant_ping_with_retry(&second_client, "auth-session-revoke-cascade-2").await;

    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth sessions revoke cascade admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    app_session_for_key(&admin_auth, &first_session_key).await;
    app_session_for_key(&admin_auth, &second_session_key).await;
    wait_for_single_connection(&admin_auth, &first_session_key).await;
    wait_for_single_connection(&admin_auth, &second_session_key).await;

    let sqlite = fixture.runtime.control_plane_sqlite();
    let identity_grant_id =
        shared_identity_grant_id(&sqlite, &first_session_key, &second_session_key);
    assert!(identity_grant_exists(&sqlite, &identity_grant_id));

    let revoked = admin_auth
        .rpc()
        .auth()
        .sessions_revoke(&trellis_rs::sdk::auth::types::AuthSessionsRevokeRequest {
            session_key: first_session_key.clone(),
        })
        .await
        .expect("revoke app session through Auth.Sessions.Revoke");
    assert!(revoked.success);

    wait_for_session_absent(&admin_auth, &first_session_key).await;
    wait_for_session_absent(&admin_auth, &second_session_key).await;
    wait_for_connections_absent(&admin_auth, &first_session_key).await;
    wait_for_connections_absent(&admin_auth, &second_session_key).await;
    assert!(!identity_grant_exists(&sqlite, &identity_grant_id));
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&first_client),
    ))
    .await;
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&second_client),
    ))
    .await;
}

#[tokio::test]
async fn auth_identity_grants_revoke_removes_authority_and_live_sessions() {
    let mut fixture = setup_app_identity_environment().await;
    let client_contract = auth_local_login_client_contract()
        .expect("build auth identity grants revoke client contract");
    let agent_contract = auth_local_login_agent_contract()
        .expect("build auth identity grants revoke agent contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth identity grants revoke admin contract");
    let first_app_seed = trellis_rs::auth::generate_session_keypair().0;
    let first_app_session_key =
        trellis_rs::client::SessionAuth::from_seed_base64url(&first_app_seed)
            .expect("derive first identity grant revoke session key")
            .session_key;
    let second_app_seed = trellis_rs::auth::generate_session_keypair().0;
    let second_app_session_key =
        trellis_rs::client::SessionAuth::from_seed_base64url(&second_app_seed)
            .expect("derive second identity grant revoke session key")
            .session_key;
    let first_agent_seed = trellis_rs::auth::generate_session_keypair().0;
    let first_agent_session_key =
        trellis_rs::client::SessionAuth::from_seed_base64url(&first_agent_seed)
            .expect("derive first agent identity grant revoke session key")
            .session_key;
    let second_agent_seed = trellis_rs::auth::generate_session_keypair().0;
    let second_agent_session_key =
        trellis_rs::client::SessionAuth::from_seed_base64url(&second_agent_seed)
            .expect("derive second agent identity grant revoke session key")
            .session_key;

    let first_app_client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, first_app_seed)
        .await
        .expect("connect first live Rust auth identity grant revoke client");
    let second_app_client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &client_contract, second_app_seed)
        .await
        .expect("connect second live Rust auth identity grant revoke client");
    let first_agent_client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &agent_contract, first_agent_seed)
        .await
        .expect("connect first live Rust auth identity grant revoke agent");
    let second_agent_client = fixture
        .admin
        .connect_client_with_session_seed(
            &fixture.bootstrap_url,
            &agent_contract,
            second_agent_seed,
        )
        .await
        .expect("connect second live Rust auth identity grant revoke agent");
    call_grant_ping_with_retry(&first_app_client, "auth-identity-grant-revoke-app-1").await;
    call_grant_ping_with_retry(&second_app_client, "auth-identity-grant-revoke-app-2").await;
    call_grant_ping_with_retry(&first_agent_client, "auth-identity-grant-revoke-agent-1").await;
    call_grant_ping_with_retry(&second_agent_client, "auth-identity-grant-revoke-agent-2").await;

    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth identity grant revoke admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    app_session_for_key(&admin_auth, &first_app_session_key).await;
    app_session_for_key(&admin_auth, &second_app_session_key).await;
    user_session_for_key(&admin_auth, &first_agent_session_key, "agent").await;
    user_session_for_key(&admin_auth, &second_agent_session_key, "agent").await;
    wait_for_single_connection(&admin_auth, &first_app_session_key).await;
    wait_for_single_connection(&admin_auth, &second_app_session_key).await;
    wait_for_single_connection_for_kind(&admin_auth, &first_agent_session_key, "agent").await;
    wait_for_single_connection_for_kind(&admin_auth, &second_agent_session_key, "agent").await;

    let sqlite = fixture.runtime.control_plane_sqlite();
    let app_identity_grant_id =
        shared_identity_grant_id(&sqlite, &first_app_session_key, &second_app_session_key);
    let agent_identity_grant_id =
        shared_identity_grant_id(&sqlite, &first_agent_session_key, &second_agent_session_key);
    assert!(identity_grant_exists(&sqlite, &app_identity_grant_id));
    assert!(identity_grant_exists(&sqlite, &agent_identity_grant_id));
    assert!(identity_grant_listed(&admin_auth, &app_identity_grant_id).await);
    assert!(identity_grant_listed(&admin_auth, &agent_identity_grant_id).await);

    let non_owner = admin_auth
        .rpc()
        .auth()
        .users_create(&trellis_rs::sdk::auth::types::AuthUsersCreateRequest {
            active: Some(true),
            capabilities: None,
            capability_groups: Some(vec!["admin".to_string()]),
            email: Some("rust-auth-identity-grants-non-owner@example.test".to_string()),
            name: Some("Rust Identity Grant Revoke Non Owner".to_string()),
            username: Some("rust-auth-identity-grants-non-owner".to_string()),
        })
        .await
        .expect("create identity grant revoke non-owner user");
    let reset = admin_auth
        .rpc()
        .auth()
        .users_password_reset_create(
            &trellis_rs::sdk::auth::types::AuthUsersPasswordResetCreateRequest {
                expires_in_seconds: None,
                user_id: non_owner.user.user_id.clone(),
            },
        )
        .await
        .expect("create identity grant revoke non-owner password reset");
    complete_local_password_account_flow(
        fixture.runtime.trellis_url(),
        &reset.flow_id,
        "rust-auth-identity-grants-non-owner",
        "trellis-integration-rust-auth-identity-grants-non-owner-password-2026",
    )
    .await;
    let non_owner_seed = trellis_rs::auth::generate_session_keypair().0;
    let non_owner_client = connect_with_local_password(
        fixture.runtime.trellis_url(),
        &admin_contract,
        &non_owner_seed,
        "rust-auth-identity-grants-non-owner",
        "trellis-integration-rust-auth-identity-grants-non-owner-password-2026",
        &admin_auth,
        &non_owner.user.user_id,
    )
    .await;
    let non_owner_auth =
        trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&non_owner_client));
    assert!(non_owner_auth
        .rpc()
        .auth()
        .identity_grants_revoke(
            &trellis_rs::sdk::auth::types::AuthIdentityGrantsRevokeRequest {
                identity_grant_id: app_identity_grant_id.clone(),
                user: None,
            },
        )
        .await
        .is_err());

    let app_revoked = admin_auth
        .rpc()
        .auth()
        .identity_grants_revoke(
            &trellis_rs::sdk::auth::types::AuthIdentityGrantsRevokeRequest {
                identity_grant_id: app_identity_grant_id.clone(),
                user: None,
            },
        )
        .await
        .expect("revoke app identity grant through Auth.IdentityGrants.Revoke");
    assert!(app_revoked.success);
    let agent_revoked = admin_auth
        .rpc()
        .auth()
        .identity_grants_revoke(
            &trellis_rs::sdk::auth::types::AuthIdentityGrantsRevokeRequest {
                identity_grant_id: agent_identity_grant_id.clone(),
                user: None,
            },
        )
        .await
        .expect("revoke agent identity grant through Auth.IdentityGrants.Revoke");
    assert!(agent_revoked.success);

    wait_for_session_absent(&admin_auth, &first_app_session_key).await;
    wait_for_session_absent(&admin_auth, &second_app_session_key).await;
    wait_for_session_absent(&admin_auth, &first_agent_session_key).await;
    wait_for_session_absent(&admin_auth, &second_agent_session_key).await;
    wait_for_connections_absent(&admin_auth, &first_app_session_key).await;
    wait_for_connections_absent(&admin_auth, &second_app_session_key).await;
    wait_for_connections_absent(&admin_auth, &first_agent_session_key).await;
    wait_for_connections_absent(&admin_auth, &second_agent_session_key).await;
    wait_for_identity_grant_absent(&admin_auth, &app_identity_grant_id).await;
    wait_for_identity_grant_absent(&admin_auth, &agent_identity_grant_id).await;
    assert!(!identity_grant_exists(&sqlite, &app_identity_grant_id));
    assert!(!identity_grant_exists(&sqlite, &agent_identity_grant_id));
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&first_app_client),
    ))
    .await;
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&second_app_client),
    ))
    .await;
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&first_agent_client),
    ))
    .await;
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&second_agent_client),
    ))
    .await;
}

#[tokio::test]
async fn auth_capability_groups_and_last_admin_guard_are_enforced() {
    let mut fixture = setup_app_identity_environment().await;
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth capability group guard admin contract");
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth capability group guard admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    let group_key = "rust-auth-capability-group-guard";
    let me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me for admin user");
    let admin_user_id = me
        .user
        .as_ref()
        .and_then(|user| user.get("userId"))
        .and_then(Value::as_str)
        .expect("admin session should include userId")
        .to_string();

    let put = auth
        .rpc()
        .auth()
        .capability_groups_put(
            &trellis_rs::sdk::auth::types::AuthCapabilityGroupsPutRequest {
                capabilities: Some(vec![APPROVED_PING_CAPABILITY.to_string()]),
                description: "Grants the auth local-login fixture capability.".to_string(),
                display_name: "Rust Integration Capability Group".to_string(),
                group_key: group_key.to_string(),
                included_groups: None,
            },
        )
        .await
        .expect("put custom capability group");
    assert_eq!(put.group.group_key, group_key);
    assert!(put
        .group
        .capabilities
        .iter()
        .any(|capability| capability == APPROVED_PING_CAPABILITY));

    let listed = auth
        .rpc()
        .auth()
        .capability_groups_list(
            &trellis_rs::sdk::auth::types::AuthCapabilityGroupsListRequest {
                limit: 500,
                offset: None,
            },
        )
        .await
        .expect("list capability groups");
    assert!(listed
        .entries
        .iter()
        .any(|group| group.group_key == group_key));
    let got = auth
        .rpc()
        .auth()
        .capability_groups_get(
            &trellis_rs::sdk::auth::types::AuthCapabilityGroupsGetRequest {
                group_key: group_key.to_string(),
            },
        )
        .await
        .expect("get custom capability group");
    assert_eq!(got.group.group_key, group_key);

    auth.rpc()
        .auth()
        .users_update(&trellis_rs::sdk::auth::types::AuthUsersUpdateRequest {
            active: None,
            capabilities: Some(vec!["admin".to_string()]),
            capability_groups: Some(vec![group_key.to_string()]),
            email: None,
            name: None,
            user_id: admin_user_id.clone(),
        })
        .await
        .expect("assign custom capability group to admin user");
    let grouped_me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me after group assignment");
    assert!(grouped_me
        .user
        .as_ref()
        .expect("grouped session should include user")
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("grouped user should include capabilities")
        .iter()
        .any(|capability| capability.as_str() == Some(APPROVED_PING_CAPABILITY)));

    expect_auth_client_reason(
        auth.rpc()
            .auth()
            .capability_groups_put(
                &trellis_rs::sdk::auth::types::AuthCapabilityGroupsPutRequest {
                    capabilities: Some(vec![format!("{APPROVED_PING_CAPABILITY}.unknown")]),
                    description: "References an unknown capability.".to_string(),
                    display_name: "Invalid Rust Capability Group".to_string(),
                    group_key: format!("{group_key}.invalid"),
                    included_groups: None,
                },
            )
            .await,
        "invalid_request",
    );
    expect_auth_client_reason(
        auth.rpc()
            .auth()
            .capability_groups_put(
                &trellis_rs::sdk::auth::types::AuthCapabilityGroupsPutRequest {
                    capabilities: None,
                    description: "Built-in group mutation must fail.".to_string(),
                    display_name: "Blocked Admin Group".to_string(),
                    group_key: "admin".to_string(),
                    included_groups: None,
                },
            )
            .await,
        "invalid_request",
    );
    expect_auth_client_reason(
        auth.rpc()
            .auth()
            .capability_groups_delete(
                &trellis_rs::sdk::auth::types::AuthCapabilityGroupsDeleteRequest {
                    group_key: "admin".to_string(),
                },
            )
            .await,
        "invalid_request",
    );

    expect_auth_client_reason(
        auth.rpc()
            .auth()
            .users_update(&trellis_rs::sdk::auth::types::AuthUsersUpdateRequest {
                active: Some(false),
                capabilities: None,
                capability_groups: None,
                email: None,
                name: None,
                user_id: admin_user_id.clone(),
            })
            .await,
        "last_admin_required",
    );
    expect_auth_client_reason(
        auth.rpc()
            .auth()
            .users_update(&trellis_rs::sdk::auth::types::AuthUsersUpdateRequest {
                active: None,
                capabilities: Some(vec![]),
                capability_groups: Some(vec![group_key.to_string()]),
                email: None,
                name: None,
                user_id: admin_user_id.clone(),
            })
            .await,
        "last_admin_required",
    );

    let admin_user = auth
        .rpc()
        .auth()
        .users_get(&trellis_rs::sdk::auth::types::AuthUsersGetRequest {
            user_id: admin_user_id.clone(),
        })
        .await
        .expect("get admin user identities");
    let identity_id = admin_user
        .user
        .identities
        .first()
        .expect("admin user should have an identity")
        .identity_id
        .clone();
    expect_auth_client_reason(
        auth.rpc()
            .auth()
            .user_identities_unlink(
                &trellis_rs::sdk::auth::types::AuthUserIdentitiesUnlinkRequest {
                    identity_id,
                    user_id: admin_user_id.clone(),
                },
            )
            .await,
        "last_admin_required",
    );

    auth.rpc()
        .auth()
        .users_create(&trellis_rs::sdk::auth::types::AuthUsersCreateRequest {
            active: Some(true),
            capabilities: None,
            capability_groups: Some(vec!["admin".to_string()]),
            email: Some("rust-auth-capability-second-admin@example.test".to_string()),
            name: Some("Rust Capability Group Second Admin".to_string()),
            username: Some("rust-auth-capability-second-admin".to_string()),
        })
        .await
        .expect("create second admin user");
    let permitted = auth
        .rpc()
        .auth()
        .users_update(&trellis_rs::sdk::auth::types::AuthUsersUpdateRequest {
            active: None,
            capabilities: Some(vec![]),
            capability_groups: Some(vec![group_key.to_string()]),
            email: None,
            name: None,
            user_id: admin_user_id,
        })
        .await
        .expect("remove original admin authority after adding second admin");
    assert!(permitted.success);
}

#[tokio::test]
async fn auth_users_identities_admin_surfaces_page_and_scope() {
    let mut fixture = setup_app_identity_environment().await;
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth users identities admin surfaces contract");
    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth users identities admin client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));

    let target = auth
        .rpc()
        .auth()
        .users_create(&trellis_rs::sdk::auth::types::AuthUsersCreateRequest {
            active: Some(true),
            capabilities: None,
            capability_groups: None,
            email: Some("rust-auth-users-identities-target@example.test".to_string()),
            name: Some("Rust Users Identities Target".to_string()),
            username: Some("rust-auth-users-identities-target".to_string()),
        })
        .await
        .expect("create target user");
    let observer_user = auth
        .rpc()
        .auth()
        .users_create(&trellis_rs::sdk::auth::types::AuthUsersCreateRequest {
            active: Some(true),
            capabilities: None,
            capability_groups: None,
            email: Some("rust-auth-users-identities-observer@example.test".to_string()),
            name: Some("Rust Users Identities Observer".to_string()),
            username: Some("rust-auth-users-identities-observer".to_string()),
        })
        .await
        .expect("create observer user");
    let reset = auth
        .rpc()
        .auth()
        .users_password_reset_create(
            &trellis_rs::sdk::auth::types::AuthUsersPasswordResetCreateRequest {
                expires_in_seconds: None,
                user_id: observer_user.user.user_id,
            },
        )
        .await
        .expect("create observer password reset");
    complete_local_password_account_flow(
        fixture.runtime.trellis_url(),
        &reset.flow_id,
        "rust-auth-users-identities-observer",
        "trellis-integration-rust-auth-users-identities-observer-password-2026",
    )
    .await;
    let sqlite = fixture.runtime.control_plane_sqlite();
    let extra_identity_id = format!("idn_extra_{}", target.user.user_id);
    sqlite
        .execute(
            "INSERT INTO user_identities
                (id, identity_id, user_id, provider, subject, display_name, email, email_verified, linked_at, last_login_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                extra_identity_id.as_str(),
                extra_identity_id.as_str(),
                target.user.user_id.as_str(),
                "integration",
                target.user.user_id.as_str(),
                "Extra Identity",
                "rust-auth-users-identities-extra@example.test",
                1,
                "1970-01-01T00:00:00.000Z",
                Option::<String>::None,
            ],
        )
        .expect("seed extra target identity");

    let first_page = auth
        .rpc()
        .auth()
        .users_list(&trellis_rs::sdk::auth::types::AuthUsersListRequest {
            limit: 1,
            offset: None,
        })
        .await
        .expect("list first user page");
    assert!(first_page.count >= 3);
    assert_eq!(first_page.offset, 0);
    assert_eq!(first_page.limit, 1);
    assert_eq!(first_page.entries.len(), 1);
    assert_eq!(first_page.next_offset, Some(1));
    let repeated_first_page = auth
        .rpc()
        .auth()
        .users_list(&trellis_rs::sdk::auth::types::AuthUsersListRequest {
            limit: 1,
            offset: None,
        })
        .await
        .expect("repeat first user page");
    assert_eq!(repeated_first_page.entries[0], first_page.entries[0]);
    let second_page = auth
        .rpc()
        .auth()
        .users_list(&trellis_rs::sdk::auth::types::AuthUsersListRequest {
            limit: 1,
            offset: Some(1),
        })
        .await
        .expect("list second user page");
    assert_eq!(second_page.offset, 1);
    assert_eq!(second_page.limit, 1);
    assert_eq!(second_page.entries.len(), 1);
    assert!(first_page.entries[0].user_id < second_page.entries[0].user_id);

    let got = auth
        .rpc()
        .auth()
        .users_get(&trellis_rs::sdk::auth::types::AuthUsersGetRequest {
            user_id: target.user.user_id.clone(),
        })
        .await
        .expect("get target user");
    assert_eq!(got.user.user_id, target.user.user_id);
    assert!(got.user.identities.len() >= 2);

    let identities = auth
        .rpc()
        .auth()
        .user_identities_list(
            &trellis_rs::sdk::auth::types::AuthUserIdentitiesListRequest {
                limit: 1,
                offset: None,
                user_id: target.user.user_id.clone(),
            },
        )
        .await
        .expect("list target identities");
    assert_eq!(identities.count as usize, got.user.identities.len());
    assert_eq!(identities.offset, 0);
    assert_eq!(identities.limit, 1);
    assert_eq!(identities.entries.len(), 1);
    assert_eq!(identities.next_offset, Some(1));
    assert_eq!(
        identities
            .entries
            .first()
            .map(|identity| &identity.identity_id),
        got.user
            .identities
            .first()
            .map(|identity| &identity.identity_id)
    );
    let next_identities = auth
        .rpc()
        .auth()
        .user_identities_list(
            &trellis_rs::sdk::auth::types::AuthUserIdentitiesListRequest {
                limit: 1,
                offset: Some(1),
                user_id: target.user.user_id.clone(),
            },
        )
        .await
        .expect("list second target identity page");
    assert_eq!(next_identities.count as usize, got.user.identities.len());
    assert_eq!(next_identities.offset, 1);
    assert_eq!(next_identities.limit, 1);
    assert_eq!(next_identities.entries.len(), 1);
    assert_eq!(
        next_identities
            .entries
            .first()
            .map(|identity| &identity.identity_id),
        got.user
            .identities
            .get(1)
            .map(|identity| &identity.identity_id)
    );

    expect_auth_client_reason(
        auth.rpc()
            .auth()
            .user_identities_unlink(
                &trellis_rs::sdk::auth::types::AuthUserIdentitiesUnlinkRequest {
                    identity_id: format!("{}:missing", target.user.user_id),
                    user_id: target.user.user_id.clone(),
                },
            )
            .await,
        "identity_not_found",
    );

    let observer_seed = trellis_rs::auth::generate_session_keypair().0;
    let missing_capabilities = match connect_local_password_without_grant(
        fixture.runtime.trellis_url(),
        &admin_contract,
        &observer_seed,
        "rust-auth-users-identities-observer",
        "trellis-integration-rust-auth-users-identities-observer-password-2026",
    )
    .await
    {
        Ok(_) => panic!("non-admin observer unexpectedly bound admin user surface contract"),
        Err(missing_capabilities) => missing_capabilities,
    };
    assert!(missing_capabilities
        .iter()
        .any(|capability| capability == "admin"));
}

#[tokio::test]
async fn auth_user_lifecycle_service_automation() {
    assert_case_registered(
        "auth.user-lifecycle-service-automation",
        "auth",
        "app_identity_approval",
    );
    let mut fixture = setup_app_identity_environment().await;
    let admin_contract =
        auth_session_revoke_admin_contract().expect("build lifecycle target admin contract");
    let target = {
        let admin_client = fixture
            .admin
            .connect_client(&fixture.bootstrap_url, &admin_contract)
            .await
            .expect("connect lifecycle admin client");
        let auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
        auth.rpc()
            .auth()
            .users_create(&trellis_rs::sdk::auth::types::AuthUsersCreateRequest {
                active: Some(true),
                capabilities: None,
                capability_groups: None,
                email: Some("rust-lifecycle-target@example.test".to_string()),
                name: Some("Rust Lifecycle Target".to_string()),
                username: Some("rust-lifecycle-target".to_string()),
            })
            .await
            .expect("create lifecycle target user")
    };
    let contract =
        trellis_test::TrellisTestContract::from_manifest_json(LIFECYCLE_SERVICE_CONTRACT_JSON)
            .expect("build lifecycle service contract");
    let service_key = fixture
        .admin
        .provision_service_instance(
            &fixture.bootstrap_url,
            &contract,
            Some("lifecycle-automation"),
            None,
        )
        .await
        .expect("provision lifecycle service");
    let service = trellis_test::connect_service_runtime::<LifecycleAutomationServiceContract>(
        fixture.runtime.trellis_url(),
        LIFECYCLE_SERVICE_ID,
        contract.digest(),
        LIFECYCLE_SERVICE_CONTRACT_JSON,
        &service_key.seed,
    )
    .await
    .expect("connect lifecycle service");
    let auth = trellis_rs::sdk::auth::AuthClient::new(service.caller());
    let selector = trellis_rs::sdk::auth::types::AuthUserLifecycleInspectRequest {
        provider: "local".to_string(),
        subject: "rust-lifecycle-target".to_string(),
    };
    let inspected = auth
        .rpc()
        .auth()
        .user_lifecycle_inspect(&selector)
        .await
        .expect("inspect exact lifecycle identity");
    assert!(inspected.found);
    assert_eq!(
        inspected.user_id.as_deref(),
        Some(target.user.user_id.as_str())
    );
    assert_eq!(inspected.active, Some(true));

    let exact = trellis_rs::sdk::auth::types::AuthUserLifecycleDeactivateRequest {
        provider: selector.provider.clone(),
        subject: selector.subject.clone(),
        user_id: target.user.user_id.clone(),
    };
    let deactivated = auth
        .rpc()
        .auth()
        .user_lifecycle_deactivate(&exact)
        .await
        .expect("deactivate exact lifecycle identity");
    assert!(deactivated.deactivated);
    let already_deactivated = auth
        .rpc()
        .auth()
        .user_lifecycle_deactivate(&exact)
        .await
        .expect("retry lifecycle deactivation");
    assert!(!already_deactivated.deactivated);
    assert_eq!(already_deactivated.revoked_sessions, 0);

    let unlink = trellis_rs::sdk::auth::types::AuthUserLifecycleUnlinkRequest {
        provider: selector.provider.clone(),
        subject: selector.subject.clone(),
        user_id: target.user.user_id,
    };
    let unlinked = auth
        .rpc()
        .auth()
        .user_lifecycle_unlink(&unlink)
        .await
        .expect("unlink exact lifecycle identity");
    assert!(unlinked.unlinked);
    let already_unlinked = auth
        .rpc()
        .auth()
        .user_lifecycle_unlink(&unlink)
        .await
        .expect("retry lifecycle unlink");
    assert!(!already_unlinked.unlinked);

    assert!(
        auth.rpc()
            .auth()
            .capabilities_list(&trellis_rs::sdk::auth::types::AuthCapabilitiesListRequest {
                limit: 1,
                offset: None,
            },)
            .await
            .is_err(),
        "lifecycle service must not receive undeclared admin directory access"
    );
}

#[tokio::test]
async fn auth_sessions_revoke_cascades_agent_grants() {
    assert_case_registered(
        "auth.sessions-revoke-cascades-agent-grants",
        "auth",
        "app_identity_approval",
    );

    let mut fixture = setup_app_identity_environment().await;
    let agent_contract = auth_local_login_agent_contract()
        .expect("build auth sessions revoke agent cascade contract");
    let admin_contract = auth_session_revoke_admin_contract()
        .expect("build auth sessions revoke agent cascade admin contract");
    let first_seed = trellis_rs::auth::generate_session_keypair().0;
    let first_session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&first_seed)
        .expect("derive first agent cascade session key")
        .session_key;
    let second_seed = trellis_rs::auth::generate_session_keypair().0;
    let second_session_key = trellis_rs::client::SessionAuth::from_seed_base64url(&second_seed)
        .expect("derive second agent cascade session key")
        .session_key;

    let first_client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &agent_contract, first_seed)
        .await
        .expect("connect first live Rust auth sessions revoke agent cascade client");
    let second_client = fixture
        .admin
        .connect_client_with_session_seed(&fixture.bootstrap_url, &agent_contract, second_seed)
        .await
        .expect("connect second live Rust auth sessions revoke agent cascade client");
    call_grant_ping_with_retry(&first_client, "auth-session-revoke-agent-cascade-1").await;
    call_grant_ping_with_retry(&second_client, "auth-session-revoke-agent-cascade-2").await;

    let admin_client = fixture
        .admin
        .connect_client(&fixture.bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust auth sessions revoke agent cascade admin client");
    let admin_auth = trellis_rs::sdk::auth::AuthClient::new(crate::generated_caller(&admin_client));
    user_session_for_key(&admin_auth, &first_session_key, "agent").await;
    user_session_for_key(&admin_auth, &second_session_key, "agent").await;
    wait_for_single_connection_for_kind(&admin_auth, &first_session_key, "agent").await;
    wait_for_single_connection_for_kind(&admin_auth, &second_session_key, "agent").await;

    let sqlite = fixture.runtime.control_plane_sqlite();
    let identity_grant_id =
        shared_identity_grant_id(&sqlite, &first_session_key, &second_session_key);
    assert!(identity_grant_exists(&sqlite, &identity_grant_id));

    let revoked = admin_auth
        .rpc()
        .auth()
        .sessions_revoke(&trellis_rs::sdk::auth::types::AuthSessionsRevokeRequest {
            session_key: first_session_key.clone(),
        })
        .await
        .expect("revoke agent session through Auth.Sessions.Revoke");
    assert!(revoked.success);

    wait_for_session_absent(&admin_auth, &first_session_key).await;
    wait_for_session_absent(&admin_auth, &second_session_key).await;
    wait_for_connections_absent(&admin_auth, &first_session_key).await;
    wait_for_connections_absent(&admin_auth, &second_session_key).await;
    assert!(!identity_grant_exists(&sqlite, &identity_grant_id));
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&first_client),
    ))
    .await;
    wait_for_sessions_me_denied(&trellis_rs::sdk::auth::AuthClient::new(
        crate::generated_caller(&second_client),
    ))
    .await;
}

async fn call_grant_ping_with_retry(
    client: &trellis_rs::generated::Caller,
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

fn is_retryable_service_startup_error(error: &trellis_rs::generated::TrellisClientError) -> bool {
    match error {
        trellis_rs::generated::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::generated::TrellisClientError::Timeout => true,
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
            .with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "grantService",
        trellis_rs::contracts::use_contract(SERVICE_ID).with_rpc_call(["Grant.Ping"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn auth_local_login_agent_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.auth-local-login-agent@v1",
        "Trellis Integration Auth Local Login Agent",
        "Agent participant for the auth local-login binding fixture.",
        trellis_rs::contracts::ContractKind::Agent,
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
            "Auth.CapabilityGroups.Delete",
            "Auth.CapabilityGroups.Get",
            "Auth.CapabilityGroups.List",
            "Auth.CapabilityGroups.Put",
            "Auth.DeploymentAuthority.GrantOverrides.List",
            "Auth.DeploymentAuthority.GrantOverrides.Put",
            "Auth.DeploymentAuthority.GrantOverrides.Remove",
            "Auth.IdentityGrants.List",
            "Auth.IdentityGrants.Revoke",
            "Auth.Portals.LoginSettings.Update",
            "Auth.Portals.List",
            "Auth.Portals.Put",
            "Auth.Portals.Remove",
            "Auth.Portals.Routes.Put",
            "Auth.Portals.Routes.Remove",
            "Auth.Sessions.List",
            "Auth.Sessions.Me",
            "Auth.Sessions.Revoke",
            "Auth.UserIdentities.List",
            "Auth.UserIdentities.Unlink",
            "Auth.Users.Create",
            "Auth.Users.Get",
            "Auth.Users.List",
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

async fn put_grant_override(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    deployment_id: &str,
    row: &Value,
) {
    let put = auth
        .rpc()
        .auth()
        .deployment_authority_grant_overrides_put(
            &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityGrantOverridesPutRequest {
                deployment_id: deployment_id.to_string(),
                overrides: vec![crate::wire(row)],
            },
        )
        .await
        .expect("put exact grant override row");
    assert_eq!(
        crate::wire::<Vec<Value>, _>(put.grant_overrides),
        vec![row.clone()]
    );
}

async fn assert_listed_grant_override(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    deployment_id: &str,
    row: Option<&Value>,
) {
    let listed = auth
        .rpc()
        .auth()
        .deployment_authority_grant_overrides_list(
            &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityGrantOverridesListRequest {
                limit: 500,
                offset: None,
            },
        )
        .await
        .expect("list grant override rows");
    let rows: Vec<Value> = listed
        .entries
        .into_iter()
        .map(crate::wire::<Value, _>)
        .filter(|entry| entry.get("deploymentId").and_then(Value::as_str) == Some(deployment_id))
        .collect::<Vec<_>>();
    assert_eq!(
        rows,
        row.map(|value| vec![value.clone()]).unwrap_or_default()
    );
}

fn connection_presence_key(session_key: &str, scope_id: &str, user_nkey: &str) -> String {
    format!(
        "{session_key}.b64_{}.{user_nkey}",
        URL_SAFE_NO_PAD.encode(scope_id.as_bytes())
    )
}

async fn app_session_for_key(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) -> Value {
    user_session_for_key(auth, session_key, "app").await
}

async fn user_session_for_key(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
    participant_kind: &str,
) -> Value {
    auth.rpc()
        .auth()
        .sessions_list(&auth_sessions_list_request())
        .await
        .expect("list app sessions")
        .entries
        .into_iter()
        .map(crate::wire::<Value, _>)
        .find(|entry| {
            entry.get("participantKind").and_then(Value::as_str) == Some(participant_kind)
                && entry.get("sessionKey").and_then(Value::as_str) == Some(session_key)
        })
        .unwrap_or_else(|| panic!("Auth.Sessions.List should include {participant_kind} session"))
}

async fn wait_for_single_connection(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
) -> Value {
    wait_for_single_connection_for_kind(auth, session_key, "app").await
}

async fn wait_for_single_connection_for_kind(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    session_key: &str,
    participant_kind: &str,
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
            let connection: Value = connections
                .entries
                .into_iter()
                .next()
                .map(crate::wire)
                .expect("one connection");
            assert_eq!(
                connection.get("participantKind").and_then(Value::as_str),
                Some(participant_kind)
            );
            assert_eq!(
                connection.get("sessionKey").and_then(Value::as_str),
                Some(session_key)
            );
            return connection;
        }
        if Instant::now() >= deadline {
            panic!(
                "expected exactly one runtime connection for {participant_kind} session {session_key}"
            );
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
    sessions.entries.iter().find_map(|entry| match entry {
        trellis_rs::sdk::auth::types::AuthSessionsListResponseEntriesItem::App {
            contract_id: entry_contract_id,
            session_key,
            ..
        } if entry_contract_id == contract_id => Some(session_key.clone()),
        _ => None,
    })
}

fn session_user_id(sqlite: &trellis_test::TrellisControlPlaneSqlite, session_key: &str) -> String {
    let rows = sqlite
        .query(
            "SELECT trellis_id AS trellisId FROM sessions WHERE session_key = ?",
            [session_key],
        )
        .expect("query session user id");
    rows.first()
        .and_then(|row| row.get("trellisId"))
        .and_then(Value::as_str)
        .expect("session row should include trellis id")
        .to_string()
}

fn shared_identity_grant_id(
    sqlite: &trellis_test::TrellisControlPlaneSqlite,
    first_session_key: &str,
    second_session_key: &str,
) -> String {
    let rows = sqlite
        .query(
            "SELECT DISTINCT identity_grant_id AS identityGrantId FROM sessions WHERE session_key IN (?, ?)",
            params![first_session_key, second_session_key],
        )
        .expect("query sibling app session grant ids");
    assert_eq!(rows.len(), 1);
    rows[0]
        .get("identityGrantId")
        .and_then(Value::as_str)
        .expect("sibling app sessions should share an identity grant")
        .to_string()
}

fn identity_grant_exists(
    sqlite: &trellis_test::TrellisControlPlaneSqlite,
    identity_grant_id: &str,
) -> bool {
    !sqlite
        .query(
            "SELECT identity_grant_id FROM identity_grants WHERE identity_grant_id = ?",
            [identity_grant_id],
        )
        .expect("query identity grant")
        .is_empty()
}

fn expect_auth_client_reason<T, E: trellis_rs::client::DeclaredError>(
    result: Result<T, trellis_rs::client::CallError<E>>,
    expected_reason: &str,
) {
    let Err(trellis_rs::client::CallError::Declared(error)) = result else {
        panic!("expected AuthError reason {expected_reason}");
    };
    assert_eq!(
        trellis_rs::client::DeclaredError::auth_error_reason(&error),
        Some(expected_reason)
    );
}

async fn identity_grant_listed(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    identity_grant_id: &str,
) -> bool {
    auth.rpc()
        .auth()
        .identity_grants_list(
            &trellis_rs::sdk::auth::types::AuthIdentityGrantsListRequest {
                limit: 500,
                offset: None,
                user: None,
            },
        )
        .await
        .expect("list identity grants")
        .entries
        .iter()
        .any(|entry| entry.identity_grant_id == identity_grant_id)
}

async fn wait_for_identity_grant_absent(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    identity_grant_id: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if !identity_grant_listed(auth, identity_grant_id).await {
            return;
        }
        if Instant::now() >= deadline {
            panic!("revoked identity grant remained visible in Auth.IdentityGrants.List");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
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
            let entry: Value = crate::wire(entry);
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
) -> trellis_rs::generated::Caller {
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
    trellis_rs::generated::Caller::connect_user(trellis_rs::generated::UserConnectOptions::new(
        &native.servers.join(","),
        &sentinel.jwt,
        &sentinel.seed,
        session_seed,
        contract.digest(),
        5_000,
    ))
    .await
    .expect("connect bound local password client")
}

async fn connect_local_password_without_grant(
    trellis_url: &str,
    contract: &trellis_test::TrellisTestContract,
    session_seed: &str,
    username: &str,
    password: &str,
) -> Result<trellis_rs::generated::Caller, Vec<String>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)
        .expect("build session auth for observer local password login");
    let redirect_to = format!(
        "{}/_trellis/test/auth-users-identities",
        trellis_url.trim_end_matches('/')
    );
    let flow_id = start_local_auth_flow(trellis_url, &redirect_to, &auth, contract).await;
    let _: Value = post_json_success(
        &format!("{}/auth/login/local", trellis_url.trim_end_matches('/')),
        &json!({ "flowId": flow_id, "username": username, "password": password }),
    )
    .await;
    let state: Value = fetch_json(&format!(
        "{}/auth/flow/{}",
        trellis_url.trim_end_matches('/'),
        flow_id
    ))
    .await;
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
        Some("insufficient_capabilities") => return Err(missing_capabilities(&state)),
        status => panic!("unexpected observer local auth flow status: {status:?}"),
    }
    let BindFlowResponse::Bound {
        sentinel,
        transports,
    } = bind_flow(trellis_url, &auth, &flow_id).await
    else {
        panic!("observer local login flow did not bind after approval");
    };
    let native = transports
        .native
        .expect("bind response should include native transport");
    trellis_rs::generated::Caller::connect_user(trellis_rs::generated::UserConnectOptions::new(
        &native.servers.join(","),
        &sentinel.jwt,
        &sentinel.seed,
        session_seed,
        contract.digest(),
        5_000,
    ))
    .await
    .map_err(|error| vec![error.to_string()])
}

fn missing_capabilities(state: &Value) -> Vec<String> {
    state
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
        .collect()
}

async fn connect_plain_local_password(
    trellis_url: &str,
    contract: &trellis_test::TrellisTestContract,
    session_seed: &str,
    username: &str,
    password: &str,
    redirect_to: &str,
) -> trellis_rs::generated::Caller {
    let BindFlowResponse::Bound {
        sentinel,
        transports,
    } = bind_plain_local_password(
        trellis_url,
        contract,
        session_seed,
        username,
        password,
        redirect_to,
    )
    .await
    else {
        panic!("plain local login flow did not bind through grant override");
    };
    let native = transports
        .native
        .expect("bind response should include native transport");
    trellis_rs::generated::Caller::connect_user(trellis_rs::generated::UserConnectOptions::new(
        &native.servers.join(","),
        &sentinel.jwt,
        &sentinel.seed,
        session_seed,
        contract.digest(),
        5_000,
    ))
    .await
    .expect("connect grant override local password client")
}

async fn bind_plain_local_password(
    trellis_url: &str,
    contract: &trellis_test::TrellisTestContract,
    session_seed: &str,
    username: &str,
    password: &str,
    redirect_to: &str,
) -> BindFlowResponse {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)
        .expect("build session auth for plain local password login");
    let flow_id = start_local_auth_flow(trellis_url, redirect_to, &auth, contract).await;
    let _: Value = post_json_success(
        &format!("{}/auth/login/local", trellis_url.trim_end_matches('/')),
        &json!({ "flowId": flow_id, "username": username, "password": password }),
    )
    .await;
    bind_flow(trellis_url, &auth, &flow_id).await
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

async fn start_browser_flow(
    trellis_url: &str,
    redirect_to: &str,
    contract: &trellis_test::TrellisTestContract,
) -> (String, String) {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(
        &trellis_rs::auth::generate_session_keypair().0,
    )
    .expect("build session auth for portal route selection flow");
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
        trellis_rs::auth::AuthStartResponse::FlowStarted { flow_id, login_url } => {
            (flow_id, login_url)
        }
        trellis_rs::auth::AuthStartResponse::Bound { .. } => {
            panic!("portal route selection auth request unexpectedly returned bound")
        }
    }
}

async fn put_custom_portal_route(
    auth: &trellis_rs::sdk::auth::AuthClient<'_>,
    portal_id: &str,
    contract_id: &str,
    origin: &str,
    disabled: bool,
) {
    auth.rpc()
        .auth()
        .portals_routes_put(&trellis_rs::sdk::auth::types::AuthPortalsRoutesPutRequest {
            contract_id: Some(Some(contract_id.to_string())),
            disabled: Some(disabled),
            origin: Some(Some(origin.to_string())),
            portal_id: portal_id.to_string(),
        })
        .await
        .expect("put custom login portal route");
}

fn assert_validation_rpc_error<T, E: std::fmt::Debug>(
    result: Result<T, trellis_rs::client::CallError<E>>,
) {
    match result {
        Err(
            trellis_rs::client::CallError::Validation(_)
            | trellis_rs::client::CallError::Declared(_),
        ) => {}
        Ok(_) => panic!("expected auth portal ValidationError"),
        Err(error) => panic!("expected auth portal ValidationError, got {error}"),
    }
}

async fn assert_flow_uses_portal(
    trellis_url: &str,
    flow_id: &str,
    expected_portal_id: &str,
    expected_providers: Value,
    expected_registration: Option<(bool, bool)>,
) {
    let state = fetch_json(&format!(
        "{}/auth/flow/{}",
        trellis_url.trim_end_matches('/'),
        flow_id
    ))
    .await;
    assert_eq!(
        state.get("status").and_then(Value::as_str),
        Some("choose_provider")
    );
    assert_eq!(
        state
            .get("portal")
            .and_then(|portal| portal.get("portalId"))
            .and_then(Value::as_str),
        Some(expected_portal_id)
    );
    assert_eq!(state.get("providers"), Some(&expected_providers));
    if let Some((local, federated)) = expected_registration {
        assert_eq!(
            state
                .get("registration")
                .and_then(|registration| registration.get("localIdentity"))
                .and_then(|local_identity| local_identity.get("available"))
                .and_then(Value::as_bool),
            Some(local)
        );
        assert_eq!(
            state
                .get("registration")
                .and_then(|registration| registration.get("federatedIdentity"))
                .and_then(|federated_identity| federated_identity.get("available"))
                .and_then(Value::as_bool),
            Some(federated)
        );
        assert_eq!(
            state
                .get("registration")
                .and_then(|registration| registration.get("federatedIdentity"))
                .and_then(|federated_identity| federated_identity.get("providers")),
            Some(&json!([{ "id": "github", "displayName": "GitHub" }]))
        );
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
