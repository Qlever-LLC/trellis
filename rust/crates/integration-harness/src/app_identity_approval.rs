use std::sync::Arc;
use std::time::Duration;

use miette::{miette, IntoDiagnostic, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use trellis::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis::client::{SessionAuth, TrellisClient, UserConnectOptions};
use trellis::contracts::{
    digest_contract_json, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis::sdk::auth::AuthClient as SdkAuthClient;
use trellis::service::{ConnectedServiceRuntime, HandlerResult, ServerError};

use crate::app::admin_setup_contract_json;
use crate::browser::{approve_current_flow, complete_local_login_until_approval, BrowserContainer};
use crate::deployment_authority::plan_accept_reconcile_deployment_authority;
use crate::rpc::{
    assert_rust_client_ping, connect_service_with_retry, expect_rust_client_call_denied,
    harness_service_contract_json, reauth_contract, HarnessPingResponse, HarnessRustPingRpc,
    HarnessTsPingRpc, HARNESS_CONTRACT_ID,
};

const APP_APPROVAL_DEPLOYMENT_ID: &str = "harness.app-identity-approval";
const APP_APPROVAL_RUST_SERVICE_NAME: &str = "harness-app-approval-rust";

pub(crate) async fn run_app_identity_approval_fixture(
    trellis_url: &str,
    app_origin: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_contract_json = admin_setup_contract_json()?;
    let setup_login = reauth_contract(
        &admin_login.state,
        &setup_contract_json,
        trellis_url,
        browser,
    )
    .await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis::auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(APP_APPROVAL_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let service_contract_json = harness_service_contract_json()?;
    let service_contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    plan_accept_reconcile_deployment_authority(
        &SdkAuthClient::new(&admin_client),
        APP_APPROVAL_DEPLOYMENT_ID,
        &service_contract_json,
        &service_contract_digest,
        "integration harness app identity approval service setup",
    )
    .await?;

    let (service_seed, service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: APP_APPROVAL_DEPLOYMENT_ID.to_string(),
            instance_key: service_key,
        })
        .await
        .into_diagnostic()?;

    let service_client = Arc::new(
        connect_service_with_retry(trellis_url, &service_contract_digest, &service_seed)
            .await
            .into_diagnostic()?,
    );
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        APP_APPROVAL_RUST_SERVICE_NAME,
        Arc::clone(&service_client),
    )
    .map_err(|error| miette!("failed to create app approval service runtime: {error}"))?;
    service.register_rpc::<HarnessRustPingRpc, _, _>(|_ctx, input| async move {
        Ok::<_, ServerError>(HarnessPingResponse {
            message: input.message,
        }) as HandlerResult<HarnessPingResponse>
    });
    let service_task = tokio::spawn(async move { service.run().await });

    let result = async {
        let app_contract_json = harness_app_contract_json()?;
        let app_contract_digest = digest_contract_json(&app_contract_json).into_diagnostic()?;

        let pending_flow = start_app_flow(trellis_url, app_origin, &app_contract_json).await?;
        login_until_approval(browser, &pending_flow.login_url).await?;
        expect_bind_approval_required(trellis_url, &pending_flow).await?;

        let approved_flow = start_app_flow(trellis_url, app_origin, &app_contract_json).await?;
        approve_flow(browser, &approved_flow.login_url).await?;
        let bound = bind_app_flow(trellis_url, &approved_flow).await?;
        let app_client = TrellisClient::connect_user(UserConnectOptions {
            servers: &bound.nats_servers,
            sentinel_jwt: &bound.sentinel.jwt,
            sentinel_seed: &bound.sentinel.seed,
            session_key_seed_base64url: &approved_flow.session_seed,
            contract_digest: &app_contract_digest,
            timeout_ms: 5_000,
        })
        .await
        .into_diagnostic()?;
        assert_rust_client_ping::<HarnessRustPingRpc>(&app_client, "app-approved-rust").await?;
        expect_rust_client_call_denied::<HarnessTsPingRpc>(
            &app_client,
            "app-unapproved-ts",
            "approved app identity grant unexpectedly allowed Harness.Ts.Ping",
        )
        .await?;

        let stale_contract_json = harness_stale_app_contract_json()?;
        let stale_flow = start_app_flow(trellis_url, app_origin, &stale_contract_json).await?;
        login_until_approval(browser, &stale_flow.login_url).await?;
        expect_bind_approval_required(trellis_url, &stale_flow).await?;

        revoke_app_identity_approval(
            &auth_client,
            &setup_login.user.user_id,
            &app_contract_digest,
            app_origin,
        )
        .await?;
        let revoked_flow = start_app_flow(trellis_url, app_origin, &app_contract_json).await?;
        login_until_approval(browser, &revoked_flow.login_url).await?;
        expect_bind_approval_required(trellis_url, &revoked_flow).await?;

        Ok(6)
    }
    .await;
    service_task.abort();
    result
}

fn harness_app_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-rpc-app@v1",
        "Trellis Integration RPC App",
        "Verify app identity grant approval for a narrow harness RPC caller.",
        ContractKind::App,
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID).with_rpc_call(["Harness.Rust.Ping"]),
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Users.List"]),
    )
    .build()
    .map_err(|error| miette!("failed to build app identity approval contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize app identity approval contract: {error}"))
}

fn harness_stale_app_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-rpc-app@v1",
        "Trellis Integration RPC App",
        "Verify stale app identity grant approval does not cover broader RPC access.",
        ContractKind::App,
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID).with_rpc_call(["Harness.Rust.Ping", "Harness.Ts.Ping"]),
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Users.List"]),
    )
    .build()
    .map_err(|error| miette!("failed to build stale app identity approval contract: {error}"))?;

    serde_json::to_string(&manifest).map_err(|error| {
        miette!("failed to serialize stale app identity approval contract: {error}")
    })
}

struct AppFlow {
    flow_id: String,
    login_url: String,
    session_seed: String,
    auth: SessionAuth,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum AuthStartResponse {
    Bound,
    FlowStarted {
        #[serde(rename = "flowId")]
        flow_id: String,
        #[serde(rename = "loginUrl")]
        login_url: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum BindResponse {
    Bound {
        sentinel: trellis::auth::SentinelCredsRecord,
        transports: trellis::auth::ClientTransportsRecord,
    },
}

#[derive(Debug)]
struct BoundAppSession {
    nats_servers: String,
    sentinel: trellis::auth::SentinelCredsRecord,
}

async fn start_app_flow(
    trellis_url: &str,
    app_origin: &str,
    contract_json: &str,
) -> Result<AppFlow> {
    let (session_seed, _session_key) = generate_session_keypair();
    let auth = SessionAuth::from_seed_base64url(&session_seed).into_diagnostic()?;
    let contract_value: Value = serde_json::from_str(contract_json).into_diagnostic()?;
    let contract = contract_value
        .as_object()
        .cloned()
        .ok_or_else(|| miette!("app contract JSON must be an object"))?;
    let redirect_to = format!("{}/harness/app-return", app_origin.trim_end_matches('/'));
    let sig = auth.sign_sha256_domain(
        "oauth-init",
        &auth_start_signature_payload(&redirect_to, None, &Value::Object(contract.clone()), None)?,
    );
    let response = reqwest::Client::new()
        .post(format!(
            "{}/auth/requests",
            trellis_url.trim_end_matches('/')
        ))
        .json(&trellis::auth::AuthStartRequest {
            provider: None,
            redirect_to,
            session_key: auth.session_key.clone(),
            sig,
            contract: contract.into_iter().collect(),
            context: None,
        })
        .send()
        .await
        .into_diagnostic()?;
    let status = response.status();
    let text = response.text().await.into_diagnostic()?;
    if !status.is_success() {
        return Err(miette!("app auth request failed with {status}: {text}"));
    }
    match serde_json::from_str::<AuthStartResponse>(&text).into_diagnostic()? {
        AuthStartResponse::FlowStarted { flow_id, login_url } => Ok(AppFlow {
            flow_id,
            login_url,
            session_seed,
            auth,
        }),
        AuthStartResponse::Bound => Err(miette!(
            "fresh app auth request was bound before browser approval"
        )),
    }
}

async fn login_until_approval(browser: &BrowserContainer, login_url: &str) -> Result<()> {
    let driver = browser.driver().await?;
    let login_result =
        complete_local_login_until_approval(&driver, login_url, "admin", "trellis-admin-password")
            .await;
    let quit_result = driver
        .quit()
        .await
        .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
    login_result?;
    quit_result
}

async fn approve_flow(browser: &BrowserContainer, login_url: &str) -> Result<()> {
    let driver = browser.driver().await?;
    let approve_result: Result<()> = async {
        complete_local_login_until_approval(&driver, login_url, "admin", "trellis-admin-password")
            .await?;
        approve_current_flow(&driver).await?;
        tokio::time::sleep(Duration::from_millis(500)).await;
        Ok(())
    }
    .await;
    let quit_result = driver
        .quit()
        .await
        .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
    approve_result?;
    quit_result
}

async fn bind_app_flow(trellis_url: &str, flow: &AppFlow) -> Result<BoundAppSession> {
    let sig = flow.auth.sign_sha256_domain("bind-flow", &flow.flow_id);
    let response = reqwest::Client::new()
        .post(format!(
            "{}/auth/flow/{}/bind",
            trellis_url.trim_end_matches('/'),
            flow.flow_id
        ))
        .json(&json!({
            "sessionKey": &flow.auth.session_key,
            "sig": sig,
        }))
        .send()
        .await
        .into_diagnostic()?;
    let status = response.status();
    let text = response.text().await.into_diagnostic()?;
    if !status.is_success() {
        return Err(miette!("app bind failed with {status}: {text}"));
    }
    let BindResponse::Bound {
        sentinel,
        transports,
    } = serde_json::from_str::<BindResponse>(&text).into_diagnostic()?;
    let native = transports
        .native
        .ok_or_else(|| miette!("app bind response missing native transport"))?;
    if native.nats_servers.is_empty() {
        return Err(miette!("app bind response native transport had no servers"));
    }
    Ok(BoundAppSession {
        nats_servers: native.nats_servers.join(","),
        sentinel,
    })
}

async fn expect_bind_approval_required(trellis_url: &str, flow: &AppFlow) -> Result<()> {
    let sig = flow.auth.sign_sha256_domain("bind-flow", &flow.flow_id);
    let response = reqwest::Client::new()
        .post(format!(
            "{}/auth/flow/{}/bind",
            trellis_url.trim_end_matches('/'),
            flow.flow_id
        ))
        .json(&json!({
            "sessionKey": &flow.auth.session_key,
            "sig": sig,
        }))
        .send()
        .await
        .into_diagnostic()?;
    let status = response.status();
    let text = response.text().await.into_diagnostic()?;
    if status.as_u16() == 403 && text.contains("approval_required") {
        Ok(())
    } else {
        Err(miette!(
            "bind before app approval returned {status} instead of 403 approval_required: {text}"
        ))
    }
}

async fn revoke_app_identity_approval(
    auth_client: &trellis::auth::AuthClient<'_>,
    user_id: &str,
    contract_digest: &str,
    app_origin: &str,
) -> Result<()> {
    let identity_grants = auth_client
        .list_identity_grants(Some(user_id), Some(contract_digest))
        .await
        .into_diagnostic()?;
    let identity_grant = identity_grants
        .iter()
        .find(|entry| {
            entry.contract_evidence.contract_digest == contract_digest
                && entry.identity_anchor.get("kind") == Some(&json!("web"))
                && entry.identity_anchor.get("origin") == Some(&json!(app_origin))
        })
        .ok_or_else(|| miette!("app identity grant was not stored after approval"))?;
    let revoked = auth_client
        .revoke_identity_grant(&identity_grant.identity_grant_id, Some(user_id))
        .await
        .into_diagnostic()?;
    if revoked {
        Ok(())
    } else {
        Err(miette!("Auth.IdentityGrants.Revoke returned success=false"))
    }
}

fn auth_start_signature_payload(
    redirect_to: &str,
    provider: Option<&str>,
    contract: &Value,
    context: Option<&Value>,
) -> Result<String> {
    Ok(format!(
        "{}:{}:{}:{}",
        redirect_to,
        provider.unwrap_or_default(),
        canonicalize_json_value(contract)?,
        canonicalize_json_value(context.unwrap_or(&Value::Null))?,
    ))
}

fn canonicalize_json_value(value: &Value) -> Result<String> {
    match value {
        Value::Null => Ok("null".to_string()),
        Value::Bool(value) => Ok(if *value { "true" } else { "false" }.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::String(value) => serde_json::to_string(value).into_diagnostic(),
        Value::Array(values) => {
            let mut canonical = String::from("[");
            for (index, entry) in values.iter().enumerate() {
                if index > 0 {
                    canonical.push(',');
                }
                canonical.push_str(&canonicalize_json_value(entry)?);
            }
            canonical.push(']');
            Ok(canonical)
        }
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));

            let mut canonical = String::from("{");
            for (index, (key, entry)) in entries.into_iter().enumerate() {
                if index > 0 {
                    canonical.push(',');
                }
                canonical.push_str(&serde_json::to_string(key).into_diagnostic()?);
                canonical.push(':');
                canonical.push_str(&canonicalize_json_value(entry)?);
            }
            canonical.push('}');
            Ok(canonical)
        }
    }
}
