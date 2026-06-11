use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::time::Duration;

use async_nats::jetstream::{self, consumer, kv, AckKind};
use async_nats::ConnectOptions;
use futures_util::StreamExt;
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_rs::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis_rs::client::{
    dispatch_outbox_once, EventDescriptor, InboxReceipt, InboxStore, NatsKvInboxStore,
    NatsKvOutboxStore, OutboxDispatchResult, OutboxStore, ServiceConnectOptions, TrellisClient,
};
use trellis_rs::contracts::{
    digest_contract_json, event, rpc, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis_rs::sdk::auth::client::AuthClient as SdkAuthClient;

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::deno_fixture::{deno_fixture_log_paths, deno_fixture_path};
use crate::deployment_authority::plan_accept_reconcile_deployment_authority;
use crate::nats::connect_admin_nats;
use crate::workspace::repo_root;

const HARNESS_DEPLOYMENT_ID: &str = "harness.events";
const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.events@v1";
const HARNESS_CONSUMER_CONTRACT_ID: &str = "trellis.integration-harness.events-consumer@v1";
const HARNESS_RUST_EVENT_SUBJECT: &str = "events.v1.Harness.Rust.Event";
const HARNESS_TS_EVENT_SUBJECT: &str = "events.v1.Harness.Ts.Event";
const HARNESS_EVENT_STREAM: &str = "trellis";
const PASSING_CASES: usize = 22;
const RUST_DURABLE_RESUBSCRIBE_GROUP: &str = "rustDurableResubscribe";
const RUST_HANDLER_NAK_GROUP: &str = "rustHandlerNak";
const RUST_INVALID_TERM_GROUP: &str = "rustInvalidTerm";
const SERVICE_EVENT_CONSUMER_GROUP: &str = "serviceEvents";

fn harness_service_contract_json() -> Result<String> {
    let event_schema = json!({
        "type": "object",
        "properties": {
            "message": { "type": "string" },
            "header": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "time": { "type": "string" }
                },
                "required": ["id", "time"]
            }
        },
        "required": ["message"]
    });
    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration Harness Events",
        "Harness-owned service contract for full-stack Rust/TypeScript event verification.",
        ContractKind::Service,
    )
    .schema("EventPayload", event_schema)
    .event(
        "Harness.Rust.Event",
        event("v1", HARNESS_RUST_EVENT_SUBJECT, "EventPayload")
            .with_publish_capabilities(std::iter::empty::<&str>())
            .with_subscribe_capabilities(std::iter::empty::<&str>()),
    )
    .event(
        "Harness.Ts.Event",
        event("v1", HARNESS_TS_EVENT_SUBJECT, "EventPayload")
            .with_publish_capabilities(std::iter::empty::<&str>())
            .with_subscribe_capabilities(std::iter::empty::<&str>()),
    )
    .build()
    .map_err(|error| miette!("failed to build events harness service contract: {error}"))?;
    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize events harness service contract: {error}"))
}

fn harness_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-events-agent@v1",
        "Trellis Integration Agent",
        "Verify delegated Rust agent login and harness event publish/subscribe.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID)
            .with_event_publish(["Harness.Rust.Event", "Harness.Ts.Event"])
            .with_event_subscribe(["Harness.Rust.Event", "Harness.Ts.Event"]),
    )
    .build()
    .map_err(|error| miette!("failed to build events harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize events harness caller contract: {error}"))
}

fn harness_service_consumer_contract_json() -> Result<String> {
    let event_schema = json!({
        "type": "object",
        "properties": {
            "message": { "type": "string" },
            "header": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "time": { "type": "string" }
                },
                "required": ["id", "time"]
            }
        },
        "required": ["message"]
    });
    let empty_request_schema = json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false
    });
    let start_response_schema = json!({
        "type": "object",
        "properties": { "started": { "type": "boolean" } },
        "required": ["started"]
    });
    let status_response_schema = json!({
        "type": "object",
        "properties": {
            "received": { "type": "boolean" },
            "message": { "type": "string" }
        },
        "required": ["received", "message"]
    });
    let manifest = ContractManifestBuilder::new(
        HARNESS_CONSUMER_CONTRACT_ID,
        "Trellis Integration Harness Event Consumer",
        "Harness-owned service contract for service-level durable event consumer verification.",
        ContractKind::Service,
    )
    .schema("EventPayload", event_schema)
    .schema("EmptyRequest", empty_request_schema)
    .schema("StartConsumerResponse", start_response_schema)
    .schema("StatusResponse", status_response_schema)
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID).with_event_subscribe(["Harness.Rust.Event"]),
    )
    .rpc(
        "Harness.Events.StartConsumer",
        rpc(
            "v1",
            "rpc.v1.Harness.Events.StartConsumer",
            "EmptyRequest",
            "StartConsumerResponse",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .rpc(
        "Harness.Events.Status",
        rpc(
            "v1",
            "rpc.v1.Harness.Events.Status",
            "EmptyRequest",
            "StatusResponse",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .build_unvalidated();

    let mut value = serde_json::to_value(manifest)
        .map_err(|error| miette!("failed to serialize service consumer manifest: {error}"))?;
    let Value::Object(manifest_object) = &mut value else {
        return Err(miette!(
            "service consumer manifest did not serialize to object"
        ));
    };
    manifest_object.insert(
        "eventConsumers".to_string(),
        json!({
            SERVICE_EVENT_CONSUMER_GROUP: {
                "events": [{ "use": "harness", "event": "Harness.Rust.Event" }],
                "replay": "new",
                "ordering": "strict",
                "concurrency": 1,
                "ackWaitMs": 30_000,
                "maxDeliver": 3
            }
        }),
    );
    let manifest = trellis_rs::contracts::parse_manifest(value)
        .map_err(|error| miette!("failed to validate service consumer manifest: {error}"))?;
    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize events consumer service contract: {error}"))
}

fn harness_service_consumer_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-events-service-consumer-agent@v1",
        "Trellis Integration Events Service Consumer Agent",
        "Verify service-level durable event consumer bootstrap and delivery.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID).with_event_publish(["Harness.Rust.Event"]),
    )
    .use_ref(
        "consumer",
        use_contract(HARNESS_CONSUMER_CONTRACT_ID)
            .with_rpc_call(["Harness.Events.StartConsumer", "Harness.Events.Status"]),
    )
    .build()
    .map_err(|error| miette!("failed to build events service consumer caller contract: {error}"))?;

    serde_json::to_string(&manifest).map_err(|error| {
        miette!("failed to serialize events service consumer caller contract: {error}")
    })
}

fn harness_subscribe_only_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-events-subscribe-agent@v1",
        "Trellis Integration Events Subscriber",
        "Verify event publish is denied without publish permission.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID)
            .with_event_subscribe(["Harness.Rust.Event", "Harness.Ts.Event"]),
    )
    .build()
    .map_err(|error| miette!("failed to build events subscribe-only contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize events subscribe-only contract: {error}"))
}

fn harness_publish_only_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-events-publish-agent@v1",
        "Trellis Integration Events Publisher",
        "Verify event subscribe is denied without subscribe permission.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID)
            .with_event_publish(["Harness.Rust.Event", "Harness.Ts.Event"]),
    )
    .build()
    .map_err(|error| miette!("failed to build events publish-only contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize events publish-only contract: {error}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HarnessEventHeader {
    id: String,
    time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HarnessEventPayload {
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    header: Option<HarnessEventHeader>,
}

struct HarnessRustEvent;

impl trellis_rs::client::EventDescriptor for HarnessRustEvent {
    type Event = HarnessEventPayload;

    const KEY: &'static str = "Harness.Rust.Event";
    const SUBJECT: &'static str = HARNESS_RUST_EVENT_SUBJECT;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}

struct HarnessTsEvent;

impl trellis_rs::client::EventDescriptor for HarnessTsEvent {
    type Event = HarnessEventPayload;

    const KEY: &'static str = "Harness.Ts.Event";
    const SUBJECT: &'static str = HARNESS_TS_EVENT_SUBJECT;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}

pub(crate) async fn run_events_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
    nats_server: &str,
    trellis_creds: &Path,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis_rs::auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let service_contract_json = harness_service_contract_json()?;
    let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    let sdk_auth_client = SdkAuthClient::new(&admin_client);
    plan_accept_reconcile_deployment_authority(
        &sdk_auth_client,
        HARNESS_DEPLOYMENT_ID,
        &service_contract_json,
        &contract_digest,
        "integration harness events service setup",
    )
    .await?;

    let (provider_service_seed, provider_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(
            &trellis_rs::sdk::auth::AuthServiceInstancesProvisionRequest {
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                instance_key: provider_service_key,
            },
        )
        .await
        .into_diagnostic()?;
    let _provider_service_client = TrellisClient::connect_service(ServiceConnectOptions {
        trellis_url,
        contract_id: HARNESS_CONTRACT_ID,
        contract_digest: &contract_digest,
        session_key_seed_base64url: &provider_service_seed,
        timeout_ms: 30_000,
    })
    .await
    .into_diagnostic()?;

    let consumer_contract_json = harness_service_consumer_contract_json()?;
    let consumer_contract_digest =
        digest_contract_json(&consumer_contract_json).into_diagnostic()?;
    plan_accept_reconcile_deployment_authority(
        &sdk_auth_client,
        HARNESS_DEPLOYMENT_ID,
        &consumer_contract_json,
        &consumer_contract_digest,
        "integration harness events consumer setup",
    )
    .await?;

    let (consumer_service_seed, consumer_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(
            &trellis_rs::sdk::auth::AuthServiceInstancesProvisionRequest {
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                instance_key: consumer_service_key,
            },
        )
        .await
        .into_diagnostic()?;

    let caller_contract_json = harness_caller_contract_json()?;
    let caller_login =
        match trellis_rs::auth::start_admin_reauth(&setup_login.state, &caller_contract_json)
            .await
            .into_diagnostic()?
        {
            trellis_rs::auth::AdminReauthOutcome::Bound(outcome) => outcome,
            trellis_rs::auth::AdminReauthOutcome::Flow(challenge) => {
                let login_url = challenge.login_url().to_string();
                let driver = browser.driver().await?;
                let login_result =
                    complete_local_login(&driver, &login_url, "admin", "trellis-admin-password")
                        .await;
                let quit_result = driver
                    .quit()
                    .await
                    .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
                login_result?;
                quit_result?;
                challenge.complete(trellis_url).await.into_diagnostic()?
            }
        };
    let caller_client = connect_admin_client_async(&caller_login.state)
        .await
        .into_diagnostic()?;
    let caller_nats = connect_admin_nats(&caller_login.state).await?;

    assert_rust_publish_rust_subscribe(&caller_client, &caller_nats)
        .await
        .map_err(|error| miette!("rust publish -> rust subscribe failed: {error}"))?;
    assert_rust_publish_ts_subscribe(
        trellis_url,
        &caller_login.state.session_seed,
        &caller_client,
    )
    .await
    .map_err(|error| miette!("rust publish -> TS subscribe failed: {error}"))?;
    assert_ts_publish_rust_subscribe(
        trellis_url,
        &caller_login.state.session_seed,
        &caller_client,
    )
    .await
    .map_err(|error| miette!("TS publish -> rust subscribe failed: {error}"))?;
    assert_ts_trace_publish_rust_subscribe(
        trellis_url,
        &caller_login.state.session_seed,
        &caller_client,
        &caller_nats,
    )
    .await
    .map_err(|error| miette!("TS traced publish -> rust subscribe failed: {error}"))?;
    run_ts_self_client(trellis_url, &caller_login.state.session_seed)
        .await
        .map_err(|error| miette!("TS publish -> TS subscribe failed: {error}"))?;
    assert_rust_durable_resubscribe(nats_server, trellis_creds, RUST_DURABLE_RESUBSCRIBE_GROUP)
        .await
        .map_err(|error| miette!("Rust durable event re-subscribe failed: {error}"))?;
    run_ts_event_behavior(
        trellis_url,
        &caller_login.state.session_seed,
        "durable-resubscribe",
        "durable-resubscribe",
        nats_server,
        trellis_creds,
    )
    .await
    .map_err(|error| miette!("TS durable event re-subscribe failed: {error}"))?;
    assert_rust_handler_nak_redelivery(
        nats_server,
        trellis_creds,
        &caller_client,
        RUST_HANDLER_NAK_GROUP,
    )
    .await
    .map_err(|error| miette!("Rust event NAK redelivery failed: {error}"))?;
    run_ts_event_behavior(
        trellis_url,
        &caller_login.state.session_seed,
        "handler-nak",
        "handler-nak",
        nats_server,
        trellis_creds,
    )
    .await
    .map_err(|error| miette!("TS event NAK redelivery failed: {error}"))?;
    assert_rust_invalid_payload_terminates(
        nats_server,
        trellis_creds,
        &caller_nats,
        RUST_INVALID_TERM_GROUP,
    )
    .await
    .map_err(|error| miette!("Rust invalid event termination failed: {error}"))?;
    run_ts_event_behavior(
        trellis_url,
        &caller_login.state.session_seed,
        "invalid-term",
        "invalid-term",
        nats_server,
        trellis_creds,
    )
    .await
    .map_err(|error| miette!("TS invalid event termination failed: {error}"))?;
    assert_rust_ephemeral_abort(&caller_client, &caller_nats)
        .await
        .map_err(|error| miette!("Rust ephemeral event abort failed: {error}"))?;
    run_ts_event_behavior(
        trellis_url,
        &caller_login.state.session_seed,
        "ephemeral-abort",
        "ephemeral-abort",
        nats_server,
        trellis_creds,
    )
    .await
    .map_err(|error| miette!("TS ephemeral event abort failed: {error}"))?;
    assert_rust_prepared_outbox_inbox(&caller_client, &caller_nats, nats_server, trellis_creds)
        .await
        .map_err(|error| miette!("Rust prepared outbox/inbox case failed: {error}"))?;
    open_events_kv_store(nats_server, trellis_creds, "inbox_prepared_outbox_inbox")
        .await
        .map_err(|error| miette!("failed to prepare TS inbox KV bucket: {error}"))?;
    open_events_kv_store(nats_server, trellis_creds, "outbox_prepared_outbox_inbox")
        .await
        .map_err(|error| miette!("failed to prepare TS outbox KV bucket: {error}"))?;
    run_ts_event_behavior(
        trellis_url,
        &caller_login.state.session_seed,
        "prepared-outbox-inbox",
        "prepared-outbox-inbox",
        nats_server,
        trellis_creds,
    )
    .await
    .map_err(|error| miette!("TS prepared outbox/inbox case failed: {error}"))?;
    let subscribe_only_login = reauth_contract(
        &caller_login.state,
        &harness_subscribe_only_contract_json()?,
        trellis_url,
        browser,
    )
    .await?;
    let subscribe_only_client = connect_admin_client_async(&subscribe_only_login.state)
        .await
        .into_diagnostic()?;
    assert_rust_denied_publish(&subscribe_only_client)
        .await
        .map_err(|error| miette!("Rust denied publish case failed: {error}"))?;
    run_ts_denied_publish(trellis_url, &subscribe_only_login.state.session_seed)
        .await
        .map_err(|error| miette!("TS denied publish case failed: {error}"))?;
    let publish_only_login = reauth_contract(
        &subscribe_only_login.state,
        &harness_publish_only_contract_json()?,
        trellis_url,
        browser,
    )
    .await?;
    let publish_only_client = connect_admin_client_async(&publish_only_login.state)
        .await
        .into_diagnostic()?;
    assert_rust_denied_subscribe(&publish_only_client)
        .await
        .map_err(|error| miette!("Rust denied subscribe case failed: {error}"))?;
    assert_ts_service_event_consumer(
        trellis_url,
        &publish_only_login.state,
        browser,
        &consumer_contract_digest,
        &consumer_service_seed,
    )
    .await
    .map_err(|error| miette!("TS service event consumer failed: {error}"))?;

    Ok(PASSING_CASES)
}

async fn assert_ts_service_event_consumer(
    trellis_url: &str,
    state: &trellis_rs::auth::AdminSessionState,
    browser: &BrowserContainer,
    consumer_contract_digest: &str,
    consumer_service_seed: &str,
) -> Result<()> {
    let mut service = TsEventConsumerServiceProcess::start(
        trellis_url,
        consumer_contract_digest,
        consumer_service_seed,
    )?;
    service.wait_ready().await?;
    tokio::time::sleep(Duration::from_millis(500)).await;

    let caller_contract_json = harness_service_consumer_caller_contract_json()?;
    let caller_contract_digest = digest_contract_json(&caller_contract_json).into_diagnostic()?;
    let caller_login = reauth_contract(state, &caller_contract_json, trellis_url, browser).await?;
    run_ts_service_consumer_client(
        trellis_url,
        &caller_login.state.session_seed,
        &caller_contract_digest,
    )
    .await?;
    service.wait_ok().await
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    match trellis_rs::auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_rs::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_rs::auth::AdminReauthOutcome::Flow(challenge) => {
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
    state: &trellis_rs::auth::AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis_rs::auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_rs::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_rs::auth::AdminReauthOutcome::Flow(challenge) => {
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

async fn assert_rust_publish_rust_subscribe(
    client: &TrellisClient,
    nats: &async_nats::Client,
) -> Result<()> {
    let mut events = subscribe_live_messages::<HarnessRustEvent>(nats).await?;
    client.flush().await.into_diagnostic()?;
    let expected = HarnessEventPayload {
        message: "rust-publish-rust-subscribe".to_string(),
        header: Some(event_header("rust-publish-rust-subscribe")),
    };
    client
        .publish::<HarnessRustEvent>(&expected)
        .await
        .into_diagnostic()?;
    client.flush().await.into_diagnostic()?;
    let event = expect_live_message::<HarnessRustEvent>(&mut events).await?;
    if decode_live_message::<HarnessRustEvent>(&event)? != expected {
        return Err(miette!("{} event mismatch", HarnessRustEvent::KEY));
    }
    let expected_id = expected
        .header
        .as_ref()
        .map(|header| header.id.as_str())
        .ok_or_else(|| miette!("{} expected event had no header", HarnessRustEvent::KEY))?;
    assert_live_event_header(&event, "Nats-Msg-Id", expected_id)
}

async fn assert_rust_publish_ts_subscribe(
    trellis_url: &str,
    caller_session_seed: &str,
    client: &TrellisClient,
) -> Result<()> {
    let expected = "rust-publish-ts-subscribe";
    let ts_subscriber = TsSubscriberProcess::start(trellis_url, caller_session_seed, expected)?;
    ts_subscriber.wait_ready().await?;
    client
        .publish::<HarnessRustEvent>(&HarnessEventPayload {
            message: expected.to_string(),
            header: Some(event_header(expected)),
        })
        .await
        .into_diagnostic()?;
    client.flush().await.into_diagnostic()?;
    ts_subscriber.wait_ok().await
}

async fn assert_ts_publish_rust_subscribe(
    trellis_url: &str,
    caller_session_seed: &str,
    client: &TrellisClient,
) -> Result<()> {
    let mut events = client
        .subscribe::<HarnessTsEvent>()
        .await
        .into_diagnostic()?;
    client.flush().await.into_diagnostic()?;
    let expected = HarnessEventPayload {
        message: "ts-publish-rust-subscribe".to_string(),
        header: None,
    };
    run_ts_publisher(trellis_url, caller_session_seed, &expected.message).await?;
    expect_event_with_header::<HarnessTsEvent>(&mut events, &expected.message).await
}

async fn assert_ts_trace_publish_rust_subscribe(
    trellis_url: &str,
    caller_session_seed: &str,
    client: &TrellisClient,
    nats: &async_nats::Client,
) -> Result<()> {
    let mut events = subscribe_live_messages::<HarnessTsEvent>(nats).await?;
    client.flush().await.into_diagnostic()?;
    let expected_message = "ts-trace-publish-rust-subscribe";
    let trace_id =
        run_ts_trace_publisher(trellis_url, caller_session_seed, expected_message).await?;
    let event = expect_live_message::<HarnessTsEvent>(&mut events).await?;
    let payload = decode_live_message::<HarnessTsEvent>(&event)?;
    if payload.message != expected_message {
        return Err(miette!(
            "{} traced event message mismatch: {:?}",
            HarnessTsEvent::KEY,
            payload
        ));
    }
    let payload_header = payload.header.ok_or_else(|| {
        miette!(
            "{} traced event did not include header",
            HarnessTsEvent::KEY
        )
    })?;
    assert_live_event_header(&event, "Nats-Msg-Id", &payload_header.id)?;
    let traceparent = live_event_header_value(&event, "traceparent")?;
    if !traceparent.contains(&trace_id) {
        return Err(miette!(
            "{} traceparent did not include active TS trace id {trace_id}: {traceparent}",
            HarnessTsEvent::KEY
        ));
    }
    Ok(())
}

async fn assert_rust_durable_resubscribe(
    nats_server: &str,
    trellis_creds: &Path,
    durable_name: &str,
) -> Result<()> {
    let first = open_harness_durable_consumer(nats_server, trellis_creds, durable_name).await?;
    let first = first.messages().await.into_diagnostic()?;
    drop(first);
    let second = open_harness_durable_consumer(nats_server, trellis_creds, durable_name).await?;
    let second = second.messages().await.into_diagnostic()?;
    drop(second);
    Ok(())
}

async fn assert_rust_handler_nak_redelivery(
    nats_server: &str,
    trellis_creds: &Path,
    publisher_client: &TrellisClient,
    durable_name: &str,
) -> Result<()> {
    let consumer = open_harness_durable_consumer(nats_server, trellis_creds, durable_name).await?;
    let mut events = consumer.messages().await.into_diagnostic()?;
    let expected = HarnessEventPayload {
        message: "rust-handler-nak".to_string(),
        header: Some(event_header("rust-handler-nak")),
    };
    publisher_client
        .publish::<HarnessRustEvent>(&expected)
        .await
        .into_diagnostic()?;
    publisher_client.flush().await.into_diagnostic()?;

    let first = expect_jetstream_message::<HarnessRustEvent>(&mut events).await?;
    if decode_jetstream_message::<HarnessRustEvent>(&first)? != expected {
        return Err(miette!("first NAK event payload mismatch"));
    }
    first
        .ack_with(AckKind::Nak(None))
        .await
        .map_err(|error| miette!("failed to NAK durable event: {error}"))?;
    let second = expect_jetstream_message::<HarnessRustEvent>(&mut events).await?;
    if decode_jetstream_message::<HarnessRustEvent>(&second)? != expected {
        return Err(miette!("redelivered NAK event payload mismatch"));
    }
    second
        .ack()
        .await
        .map_err(|error| miette!("failed to ACK durable event: {error}"))
}

async fn assert_rust_invalid_payload_terminates(
    nats_server: &str,
    trellis_creds: &Path,
    publisher_nats: &async_nats::Client,
    durable_name: &str,
) -> Result<()> {
    let consumer = open_harness_durable_consumer(nats_server, trellis_creds, durable_name).await?;
    let mut events = consumer.messages().await.into_diagnostic()?;
    publish_raw_event(
        publisher_nats,
        HARNESS_RUST_EVENT_SUBJECT,
        &json!({ "header": { "id": "invalid", "time": "2026-05-13T00:00:00.000Z" } }),
    )
    .await?;
    let invalid = expect_jetstream_message::<HarnessRustEvent>(&mut events).await?;
    if decode_jetstream_message::<HarnessRustEvent>(&invalid).is_ok() {
        return Err(miette!("invalid Rust event payload decoded successfully"));
    }
    invalid
        .ack_with(AckKind::Term)
        .await
        .map_err(|error| miette!("failed to terminate durable event: {error}"))?;
    expect_no_jetstream_message::<HarnessRustEvent>(&mut events).await
}

async fn assert_rust_ephemeral_abort(
    client: &TrellisClient,
    nats: &async_nats::Client,
) -> Result<()> {
    let mut events = subscribe_live_messages::<HarnessRustEvent>(nats).await?;
    client.flush().await.into_diagnostic()?;
    client
        .publish::<HarnessRustEvent>(&HarnessEventPayload {
            message: "rust-ephemeral-first".to_string(),
            header: Some(event_header("rust-ephemeral-first")),
        })
        .await
        .into_diagnostic()?;
    let first = expect_live_message::<HarnessRustEvent>(&mut events).await?;
    if decode_live_message::<HarnessRustEvent>(&first)?.message != "rust-ephemeral-first" {
        return Err(miette!("Rust ephemeral first event payload mismatch"));
    }
    drop(events);
    client
        .publish::<HarnessRustEvent>(&HarnessEventPayload {
            message: "rust-ephemeral-second".to_string(),
            header: Some(event_header("rust-ephemeral-second")),
        })
        .await
        .into_diagnostic()?;
    client.flush().await.into_diagnostic()?;

    let mut fresh = subscribe_live_messages::<HarnessRustEvent>(nats).await?;
    expect_no_live_message::<HarnessRustEvent>(&mut fresh).await
}

async fn assert_rust_prepared_outbox_inbox(
    client: &TrellisClient,
    nats: &async_nats::Client,
    nats_server: &str,
    trellis_creds: &Path,
) -> Result<()> {
    let mut events = subscribe_live_messages::<HarnessRustEvent>(nats).await?;
    client.flush().await.into_diagnostic()?;

    let expected = HarnessEventPayload {
        message: "rust-prepared-outbox-inbox".to_string(),
        header: Some(event_header("rust-prepared-outbox-inbox")),
    };
    let prepared = client
        .prepare_event::<HarnessRustEvent>(&expected)
        .into_diagnostic()?;
    let store = open_events_kv_store(nats_server, trellis_creds, "prepared_outbox_inbox")
        .await
        .map_err(|error| miette!("{error}"))?;
    let mut outbox = NatsKvOutboxStore::new(store.clone(), "rust-prepared/");
    outbox
        .enqueue("rust-prepared-outbox-inbox", &prepared)
        .await
        .into_diagnostic()?;

    let dispatched = dispatch_outbox_once(&mut outbox, |event| async move {
        client.publish_prepared(&event).await
    })
    .await
    .into_diagnostic()?;
    if dispatched
        != (OutboxDispatchResult::Published {
            id: "rust-prepared-outbox-inbox".to_string(),
        })
    {
        return Err(miette!(
            "unexpected Rust outbox dispatch result: {dispatched:?}"
        ));
    }

    let event = expect_live_message::<HarnessRustEvent>(&mut events).await?;
    if decode_live_message::<HarnessRustEvent>(&event)? != expected {
        return Err(miette!("prepared outbox event payload mismatch"));
    }

    let event_id = live_event_header_value(&event, "Nats-Msg-Id")?.to_string();
    let mut inbox = NatsKvInboxStore::new(store, "rust-prepared/");
    let mut processed = 0;
    if inbox.record_received(&event_id).await.into_diagnostic()? == InboxReceipt::Accepted {
        processed += 1;
    }
    let duplicate = inbox.record_received(&event_id).await.into_diagnostic()?;
    if duplicate != InboxReceipt::Duplicate || processed != 1 {
        return Err(miette!(
            "Rust inbox duplicate suppression failed: duplicate={duplicate:?}, processed={processed}"
        ));
    }

    Ok(())
}

async fn open_events_kv_store(
    nats_server: &str,
    trellis_creds: &Path,
    bucket_suffix: &str,
) -> std::result::Result<async_nats::jetstream::kv::Store, String> {
    let bucket = format!("trellis_harness_events_{bucket_suffix}");
    let nats = ConnectOptions::new()
        .credentials_file(trellis_creds)
        .await
        .map_err(|error| format!("failed to load events KV NATS credentials: {error}"))?
        .connect(nats_server)
        .await
        .map_err(|error| format!("failed to connect events KV NATS client: {error}"))?;
    let jetstream = jetstream::new(nats);
    match jetstream.get_key_value(bucket.clone()).await {
        Ok(store) => Ok(store),
        Err(_) => jetstream
            .create_key_value(kv::Config {
                bucket,
                history: 1,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("failed to create events KV bucket: {error}")),
    }
}

async fn assert_rust_denied_publish(client: &TrellisClient) -> Result<()> {
    let event = HarnessEventPayload {
        message: "rust-denied-publish".to_string(),
        header: Some(event_header("rust-denied-publish")),
    };
    let result = async {
        client
            .publish::<HarnessRustEvent>(&event)
            .await
            .into_diagnostic()?;
        client.flush().await.into_diagnostic()
    }
    .await;
    if result.is_ok() {
        return Err(miette!(
            "Rust event publish unexpectedly succeeded without publish permission"
        ));
    }
    Ok(())
}

async fn expect_event_with_header<D>(
    events: &mut futures_util::stream::BoxStream<
        'static,
        Result<HarnessEventPayload, trellis_rs::client::TrellisClientError>,
    >,
    expected_message: &str,
) -> Result<()>
where
    D: trellis_rs::client::EventDescriptor<Event = HarnessEventPayload>,
{
    let event = tokio::time::timeout(Duration::from_secs(10), events.next())
        .await
        .map_err(|_| miette!("{} subscription timed out", D::KEY))?
        .ok_or_else(|| miette!("{} subscription ended before event", D::KEY))?
        .into_diagnostic()?;
    if event.message != expected_message {
        return Err(miette!("{} event message mismatch: {:?}", D::KEY, event));
    }
    let header = event
        .header
        .ok_or_else(|| miette!("{} event did not include header", D::KEY))?;
    if header.id.is_empty() || header.time.is_empty() {
        return Err(miette!(
            "{} event header had empty fields: {header:?}",
            D::KEY
        ));
    }
    Ok(())
}

fn event_header(id: &str) -> HarnessEventHeader {
    HarnessEventHeader {
        id: id.to_string(),
        time: "2026-05-13T00:00:00.000Z".to_string(),
    }
}

async fn assert_rust_denied_subscribe(client: &TrellisClient) -> Result<()> {
    let mut events = client
        .subscribe::<HarnessRustEvent>()
        .await
        .into_diagnostic()?;
    client.flush().await.into_diagnostic()?;
    client
        .publish::<HarnessRustEvent>(&HarnessEventPayload {
            message: "rust-denied-subscribe".to_string(),
            header: Some(event_header("rust-denied-subscribe")),
        })
        .await
        .into_diagnostic()?;
    client.flush().await.into_diagnostic()?;
    if let Ok(Some(Ok(_))) = tokio::time::timeout(Duration::from_millis(500), events.next()).await {
        return Err(miette!(
            "Rust event subscribe unexpectedly received an event without subscribe permission"
        ));
    }
    Ok(())
}

async fn subscribe_live_messages<D>(nats: &async_nats::Client) -> Result<async_nats::Subscriber>
where
    D: trellis_rs::client::EventDescriptor<Event = HarnessEventPayload>,
{
    nats.subscribe(D::SUBJECT.to_string())
        .await
        .into_diagnostic()
}

async fn open_harness_durable_consumer(
    nats_server: &str,
    trellis_creds: &Path,
    durable_name: &str,
) -> Result<consumer::Consumer<consumer::pull::Config>> {
    let nats = ConnectOptions::new()
        .credentials_file(trellis_creds)
        .await
        .into_diagnostic()
        .map_err(|error| miette!("failed to load events durable NATS credentials: {error}"))?
        .connect(nats_server)
        .await
        .into_diagnostic()
        .map_err(|error| miette!("failed to connect events durable NATS client: {error}"))?;
    let jetstream = jetstream::new(nats);
    let stream = jetstream
        .get_stream_no_info(HARNESS_EVENT_STREAM)
        .await
        .into_diagnostic()?;
    match stream.get_consumer(durable_name).await {
        Ok(consumer) => Ok(consumer),
        Err(_) => stream
            .create_consumer(consumer::pull::Config {
                durable_name: Some(durable_name.to_string()),
                deliver_policy: consumer::DeliverPolicy::New,
                ack_policy: consumer::AckPolicy::Explicit,
                filter_subject: HARNESS_RUST_EVENT_SUBJECT.to_string(),
                ..Default::default()
            })
            .await
            .into_diagnostic(),
    }
}

async fn expect_live_message<D>(events: &mut async_nats::Subscriber) -> Result<async_nats::Message>
where
    D: trellis_rs::client::EventDescriptor<Event = HarnessEventPayload>,
{
    tokio::time::timeout(Duration::from_secs(10), events.next())
        .await
        .map_err(|_| miette!("{} live subscription timed out", D::KEY))?
        .ok_or_else(|| miette!("{} live subscription ended before event", D::KEY))
}

fn decode_live_message<D>(message: &async_nats::Message) -> Result<HarnessEventPayload>
where
    D: trellis_rs::client::EventDescriptor<Event = HarnessEventPayload>,
{
    serde_json::from_slice(&message.payload).into_diagnostic()
}

async fn expect_jetstream_message<D>(
    events: &mut consumer::pull::Stream,
) -> Result<async_nats::jetstream::Message>
where
    D: trellis_rs::client::EventDescriptor<Event = HarnessEventPayload>,
{
    tokio::time::timeout(Duration::from_secs(10), events.next())
        .await
        .map_err(|_| miette!("{} durable subscription timed out", D::KEY))?
        .ok_or_else(|| miette!("{} durable subscription ended before event", D::KEY))?
        .into_diagnostic()
}

fn decode_jetstream_message<D>(
    message: &async_nats::jetstream::Message,
) -> Result<HarnessEventPayload>
where
    D: trellis_rs::client::EventDescriptor<Event = HarnessEventPayload>,
{
    serde_json::from_slice(&message.payload).into_diagnostic()
}

fn assert_live_event_header(event: &async_nats::Message, name: &str, expected: &str) -> Result<()> {
    let actual = live_event_header_value(event, name)?;
    if actual != expected {
        return Err(miette!(
            "event header {name} mismatch: expected {expected}, got {actual}"
        ));
    }
    Ok(())
}

fn live_event_header_value<'a>(event: &'a async_nats::Message, name: &str) -> Result<&'a str> {
    event
        .headers
        .as_ref()
        .and_then(|headers| headers.get(name))
        .map(|value| value.as_str())
        .ok_or_else(|| miette!("event did not include {name} header"))
}

async fn expect_no_live_message<D>(events: &mut async_nats::Subscriber) -> Result<()>
where
    D: trellis_rs::client::EventDescriptor<Event = HarnessEventPayload>,
{
    match tokio::time::timeout(Duration::from_millis(500), events.next()).await {
        Ok(Some(message)) => Err(miette!(
            "{} received unexpected live event message on {}",
            D::KEY,
            message.subject
        )),
        Ok(None) | Err(_) => Ok(()),
    }
}

async fn expect_no_jetstream_message<D>(events: &mut consumer::pull::Stream) -> Result<()>
where
    D: trellis_rs::client::EventDescriptor<Event = HarnessEventPayload>,
{
    match tokio::time::timeout(Duration::from_millis(500), events.next()).await {
        Ok(Some(Ok(message))) => {
            let _ = message.ack_with(AckKind::Term).await;
            Err(miette!("{} received unexpected durable event", D::KEY))
        }
        Ok(Some(Err(error))) => Err(miette!("{} durable stream failed: {error}", D::KEY)),
        Ok(None) | Err(_) => Ok(()),
    }
}

async fn publish_raw_event(
    nats: &async_nats::Client,
    subject: &str,
    payload: &Value,
) -> Result<()> {
    let jetstream = async_nats::jetstream::new(nats.clone());
    let ack = jetstream
        .publish(
            subject.to_string(),
            bytes::Bytes::from(serde_json::to_vec(payload).into_diagnostic()?),
        )
        .await
        .into_diagnostic()?;
    ack.await.into_diagnostic()?;
    Ok(())
}

#[derive(Debug)]
struct TsSubscriberProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsSubscriberProcess {
    fn start(trellis_url: &str, caller_session_seed: &str, expected_message: &str) -> Result<Self> {
        let repo = repo_root()?;
        let script_path = deno_fixture_path("events/subscriber.ts")?;
        let (stdout_log, stderr_log) = deno_fixture_log_paths("events-subscriber")?;
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS events subscriber stdout log: {error}")
            })?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS events subscriber stderr log: {error}")
            })?;
        let child = std::process::Command::new("deno")
            .arg("run")
            .arg("-c")
            .arg(repo.join("js/deno.json"))
            .arg("--allow-env")
            .arg("--allow-sys")
            .arg("--allow-net")
            .arg("--allow-read")
            .arg(&script_path)
            .current_dir(repo.join("js"))
            .env("TRELLIS_URL", trellis_url)
            .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_contract_digest()?)
            .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed)
            .env("HARNESS_EXPECTED_MESSAGE", expected_message)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .map_err(|error| miette!("failed to start TS events subscriber fixture: {error}"))?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    async fn wait_ready(&self) -> Result<()> {
        self.wait_for("TS_EVENTS_SUBSCRIBER_READY", "readiness")
            .await
    }

    async fn wait_ok(&self) -> Result<()> {
        self.wait_for("TS_EVENTS_SUBSCRIBER_OK", "success").await
    }

    async fn wait_for(&self, marker: &str, label: &str) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if std::fs::read_to_string(&self.stdout_log)
                .unwrap_or_default()
                .contains(marker)
            {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS events subscriber {label}; stdout: {stdout}; stderr: {stderr}"
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

impl Drop for TsSubscriberProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect TS events subscriber child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS events subscriber child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS events subscriber child: {error}");
        }
    }
}

#[derive(Debug)]
struct TsEventConsumerServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsEventConsumerServiceProcess {
    fn start(trellis_url: &str, contract_digest: &str, service_seed: &str) -> Result<Self> {
        let repo = repo_root()?;
        let script_path = deno_fixture_path("events/service-consumer.ts")?;
        let (stdout_log, stderr_log) = deno_fixture_log_paths("events-service-consumer")?;
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS events service consumer stdout log: {error}")
            })?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS events service consumer stderr log: {error}")
            })?;
        let child = std::process::Command::new("deno")
            .arg("run")
            .arg("-c")
            .arg(repo.join("js/deno.json"))
            .arg("--allow-env")
            .arg("--allow-sys")
            .arg("--allow-net")
            .arg("--allow-read")
            .arg(&script_path)
            .current_dir(repo.join("js"))
            .env("TRELLIS_URL", trellis_url)
            .env("HARNESS_CONSUMER_CONTRACT_DIGEST", contract_digest)
            .env("HARNESS_TS_SERVICE_SEED", service_seed)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to start TS events service consumer fixture: {error}")
            })?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    async fn wait_ready(&mut self) -> Result<()> {
        self.wait_for("TS_EVENTS_SERVICE_CONSUMER_READY", "readiness")
            .await
    }

    async fn wait_ok(&mut self) -> Result<()> {
        self.wait_for("TS_EVENTS_SERVICE_CONSUMER_OK", "success")
            .await
    }

    async fn wait_for(&mut self, marker: &str, label: &str) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if std::fs::read_to_string(&self.stdout_log)
                .unwrap_or_default()
                .contains(marker)
            {
                return Ok(());
            }
            if let Some(status) = self.child.try_wait().into_diagnostic().map_err(|error| {
                miette!("failed to inspect TS events service consumer child: {error}")
            })? {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "TS events service consumer exited before {label} with status {status}; stdout: {stdout}; stderr: {stderr}"
                ));
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS events service consumer {label}; stdout: {stdout}; stderr: {stderr}"
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

impl Drop for TsEventConsumerServiceProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect TS events service consumer child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS events service consumer child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS events service consumer child: {error}");
        }
    }
}

async fn run_ts_publisher(
    trellis_url: &str,
    caller_session_seed: &str,
    message: &str,
) -> Result<()> {
    run_ts_script(
        "events-publisher",
        "events/publisher.ts",
        trellis_url,
        caller_session_seed,
        Some(message),
        "TS_EVENTS_PUBLISHER_OK",
    )
    .await
}

async fn run_ts_trace_publisher(
    trellis_url: &str,
    caller_session_seed: &str,
    message: &str,
) -> Result<String> {
    let output = run_ts_script_capture(
        "events-trace-publisher",
        "events/trace-publisher.ts",
        trellis_url,
        caller_session_seed,
        &caller_contract_digest()?,
        Some(message),
        "TS_EVENTS_TRACE_PUBLISHER_OK",
    )
    .await?;
    output
        .lines()
        .find_map(|line| line.strip_prefix("TS_EVENTS_TRACE_ID "))
        .map(str::to_string)
        .filter(|trace_id| !trace_id.is_empty())
        .ok_or_else(|| miette!("TS traced event publisher did not report trace id: {output}"))
}

async fn run_ts_self_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    run_ts_script(
        "events-self",
        "events/self.ts",
        trellis_url,
        caller_session_seed,
        None,
        "TS_EVENTS_SELF_OK",
    )
    .await
}

async fn run_ts_service_consumer_client(
    trellis_url: &str,
    caller_session_seed: &str,
    caller_digest: &str,
) -> Result<()> {
    let mut last_error = None;
    for attempt in 1..=3 {
        match run_ts_script_with_digest(
            "events-service-consumer-client",
            "events/service-consumer-client.ts",
            trellis_url,
            caller_session_seed,
            caller_digest,
            Some("service-consumer"),
            "TS_EVENTS_SERVICE_CONSUMER_CLIENT_OK",
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(error) if attempt < 3 => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| miette!("TS service consumer client did not run")))
}

async fn run_ts_denied_publish(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    run_ts_script_with_digest(
        "events-denied-publish",
        "events/denied-publish.ts",
        trellis_url,
        caller_session_seed,
        &digest_contract_json(&harness_subscribe_only_contract_json()?).into_diagnostic()?,
        None,
        "TS_EVENTS_DENIED_PUBLISH_OK",
    )
    .await
}

async fn run_ts_event_behavior(
    trellis_url: &str,
    caller_session_seed: &str,
    case_name: &str,
    message: &str,
    nats_server: &str,
    trellis_creds: &Path,
) -> Result<()> {
    let repo = repo_root()?;
    let script_path = deno_fixture_path("events/behavior.ts")?;
    let output = std::process::Command::new("deno")
        .arg("run")
        .arg("-c")
        .arg(repo.join("js/deno.json"))
        .arg("--allow-env")
        .arg("--allow-sys")
        .arg("--allow-net")
        .arg("--allow-read")
        .arg(&script_path)
        .current_dir(repo.join("js"))
        .env("TRELLIS_URL", trellis_url)
        .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_contract_digest()?)
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed)
        .env("HARNESS_EVENT_CASE", case_name)
        .env("HARNESS_MESSAGE", message)
        .env("HARNESS_NATS_SERVER", nats_server)
        .env("HARNESS_NATS_CREDS", trellis_creds)
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS events fixture {case_name}: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS events fixture {case_name} failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_EVENTS_BEHAVIOR_OK") {
        return Err(miette!(
            "TS events fixture {case_name} did not report success: {stdout}"
        ));
    }
    Ok(())
}

async fn run_ts_script(
    name: &str,
    fixture_path: &str,
    trellis_url: &str,
    caller_session_seed: &str,
    message: Option<&str>,
    ok_marker: &str,
) -> Result<()> {
    run_ts_script_with_digest(
        name,
        fixture_path,
        trellis_url,
        caller_session_seed,
        &caller_contract_digest()?,
        message,
        ok_marker,
    )
    .await
}

async fn run_ts_script_with_digest(
    name: &str,
    fixture_path: &str,
    trellis_url: &str,
    caller_session_seed: &str,
    caller_digest: &str,
    message: Option<&str>,
    ok_marker: &str,
) -> Result<()> {
    run_ts_script_capture(
        name,
        fixture_path,
        trellis_url,
        caller_session_seed,
        caller_digest,
        message,
        ok_marker,
    )
    .await
    .map(|_| ())
}

async fn run_ts_script_capture(
    name: &str,
    fixture_path: &str,
    trellis_url: &str,
    caller_session_seed: &str,
    caller_digest: &str,
    message: Option<&str>,
    ok_marker: &str,
) -> Result<String> {
    let repo = repo_root()?;
    let script_path = deno_fixture_path(fixture_path)?;
    let mut command = std::process::Command::new("deno");
    command
        .arg("run")
        .arg("-c")
        .arg(repo.join("js/deno.json"))
        .arg("--allow-env")
        .arg("--allow-sys")
        .arg("--allow-net")
        .arg("--allow-read")
        .arg(&script_path)
        .current_dir(repo.join("js"))
        .env("TRELLIS_URL", trellis_url)
        .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_digest)
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed);
    if let Some(message) = message {
        command.env("HARNESS_MESSAGE", message);
    }
    let output = command
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS events fixture {name}: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS events fixture {name} failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains(ok_marker) {
        return Err(miette!(
            "TS events fixture {name} did not report success: {stdout}"
        ));
    }
    Ok(stdout.into_owned())
}

fn caller_contract_digest() -> Result<String> {
    digest_contract_json(&harness_caller_contract_json()?).into_diagnostic()
}
