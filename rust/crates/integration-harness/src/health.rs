use std::collections::BTreeMap;
use std::time::Duration;

use futures_util::StreamExt;
use miette::{miette, IntoDiagnostic, Result};
use serde_json::json;
use trellis::auth::{connect_admin_client_async, AdminLoginOutcome};
use trellis::client::TrellisClient;
use trellis::contracts::{
    digest_contract_json, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis::sdk::health::client::HealthClient as SdkHealthClient;
use trellis::sdk::health::events::HealthHeartbeatEventDescriptor;
use trellis::sdk::health::types::{
    HealthHeartbeatEvent, HealthHeartbeatEventChecksItem, HealthHeartbeatEventHeader,
    HealthHeartbeatEventService,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};

const HEALTH_CALLER_CONTRACT_ID: &str = "trellis.integration-health-agent@v1";
const HEALTH_SUBSCRIBE_ONLY_CONTRACT_ID: &str = "trellis.integration-health-subscribe-agent@v1";

pub(crate) async fn run_health_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let caller_contract_json = health_caller_contract_json()?;
    let caller_login = reauth_contract(
        &setup_login.state,
        &caller_contract_json,
        trellis_url,
        browser,
    )
    .await?;
    let caller_client = connect_admin_client_async(&caller_login.state)
        .await
        .into_diagnostic()?;

    assert_generated_health_publish_subscribe(&caller_client)
        .await
        .map_err(|error| miette!("generated Health.Heartbeat publish/subscribe failed: {error}"))?;

    let subscribe_only_login = reauth_contract(
        &caller_login.state,
        &health_subscribe_only_contract_json()?,
        trellis_url,
        browser,
    )
    .await?;
    let subscribe_only_client = connect_admin_client_async(&subscribe_only_login.state)
        .await
        .into_diagnostic()?;
    assert_generated_health_denied_publish(&subscribe_only_client)
        .await
        .map_err(|error| miette!("generated Health.Heartbeat denied publish failed: {error}"))?;

    Ok(2)
}

async fn assert_generated_health_publish_subscribe(client: &TrellisClient) -> Result<()> {
    let mut events = client
        .subscribe::<HealthHeartbeatEventDescriptor>()
        .await
        .into_diagnostic()?;
    client.nats().flush().await.into_diagnostic()?;

    let heartbeat = heartbeat_event("health-sdk-positive")?;
    SdkHealthClient::new(client)
        .publish_health_heartbeat(&heartbeat)
        .await
        .into_diagnostic()?;
    client.nats().flush().await.into_diagnostic()?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(miette!("Health.Heartbeat subscription timed out"));
        }
        let received = tokio::time::timeout(remaining, events.next())
            .await
            .map_err(|_| miette!("Health.Heartbeat subscription timed out"))?
            .ok_or_else(|| miette!("Health.Heartbeat subscription ended before event"))?
            .into_diagnostic()?;
        if received.header.id == heartbeat.header.id
            && received.service.name == heartbeat.service.name
        {
            break;
        }
    }

    Ok(())
}

async fn assert_generated_health_denied_publish(client: &TrellisClient) -> Result<()> {
    let result = async {
        SdkHealthClient::new(client)
            .publish_health_heartbeat(&heartbeat_event("health-sdk-denied")?)
            .await
            .into_diagnostic()?;
        client.nats().flush().await.into_diagnostic()
    }
    .await;
    if result.is_ok() {
        return Err(miette!(
            "Health.Heartbeat publish unexpectedly succeeded without publish permission"
        ));
    }
    Ok(())
}

fn health_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        HEALTH_CALLER_CONTRACT_ID,
        "Trellis Integration Health Agent",
        "Verify generated Rust health heartbeat event publishing and subscribing.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "health",
        use_contract("trellis.health@v1")
            .with_event_publish(["Health.Heartbeat"])
            .with_event_subscribe(["Health.Heartbeat"]),
    )
    .build()
    .map_err(|error| miette!("failed to build health harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize health harness caller contract: {error}"))
}

fn health_subscribe_only_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        HEALTH_SUBSCRIBE_ONLY_CONTRACT_ID,
        "Trellis Integration Health Subscriber",
        "Verify health heartbeat publish is denied without publish permission.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "health",
        use_contract("trellis.health@v1").with_event_subscribe(["Health.Heartbeat"]),
    )
    .build()
    .map_err(|error| miette!("failed to build health subscribe-only contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize health subscribe-only contract: {error}"))
}

fn heartbeat_event(id: &str) -> Result<HealthHeartbeatEvent> {
    Ok(HealthHeartbeatEvent {
        header: HealthHeartbeatEventHeader {
            id: id.to_string(),
            time: "2026-05-12T00:00:00.000Z".to_string(),
        },
        service: HealthHeartbeatEventService {
            name: "integration-health-harness".to_string(),
            kind: json!("service"),
            instance_id: "integration-health-instance".to_string(),
            contract_id: HEALTH_CALLER_CONTRACT_ID.to_string(),
            contract_digest: caller_contract_digest()?,
            version: Some("0.0.0-test".to_string()),
            runtime: json!("rust"),
            runtime_version: Some("integration".to_string()),
            started_at: "2026-05-12T00:00:00.000Z".to_string(),
            publish_interval_ms: 30_000,
            info: Some(BTreeMap::from([("fixture".to_string(), json!("health"))])),
        },
        status: json!("ok"),
        summary: Some("integration heartbeat".to_string()),
        checks: vec![HealthHeartbeatEventChecksItem {
            name: "nats".to_string(),
            status: json!("ok"),
            latency_ms: 0.0,
            summary: Some("connected".to_string()),
            error: None,
            info: Some(BTreeMap::from([("transport".to_string(), json!("nats"))])),
        }],
    })
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    match trellis::auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis::auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge
                .complete(&admin_login.state.trellis_url)
                .await
                .into_diagnostic()
        }
    }
}

async fn reauth_contract(
    state: &trellis::auth::AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis::auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis::auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge.complete(trellis_url).await.into_diagnostic()
        }
    }
}

fn caller_contract_digest() -> Result<String> {
    digest_contract_json(&health_caller_contract_json()?).into_diagnostic()
}
