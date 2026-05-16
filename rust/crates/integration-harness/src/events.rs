use std::collections::BTreeMap;
use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::time::Duration;

use futures_util::StreamExt;
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_auth::{connect_admin_client_async, AdminLoginOutcome};
use trellis_client::TrellisClient;
use trellis_contracts::{
    digest_contract_json, event, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis_sdk_auth::client::AuthClient as SdkAuthClient;
use trellis_sdk_auth::types::AuthEnvelopesExpandRequest;

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::workspace::repo_root;

const HARNESS_DEPLOYMENT_ID: &str = "harness.events";
const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.events@v1";
const HARNESS_RUST_EVENT_SUBJECT: &str = "events.v1.Harness.Rust.Event";
const HARNESS_TS_EVENT_SUBJECT: &str = "events.v1.Harness.Ts.Event";
const PASSING_CASES: usize = 9;

fn harness_service_contract_json() -> Result<String> {
    let event_schema = json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "message": { "type": "string" },
            "header": {
                "type": "object",
                "additionalProperties": false,
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

const TS_SUBSCRIBER_SCRIPT: &str = r#"import { defineAgentContract, defineServiceContract, ok, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  EventPayload: Type.Object({
    message: Type.String(),
    header: Type.Optional(Type.Object({ id: Type.String(), time: Type.String() }, { additionalProperties: false })),
  }, { additionalProperties: false }),
} as const;

const harness = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.events@v1",
  displayName: "Trellis Integration Harness Events",
  description: "Harness-owned service contract for full-stack Rust/TypeScript event verification.",
  events: {
    "Harness.Rust.Event": { version: "v1", subject: "events.v1.Harness.Rust.Event", event: ref.schema("EventPayload"), capabilities: { publish: [], subscribe: [] } },
    "Harness.Ts.Event": { version: "v1", subject: "events.v1.Harness.Ts.Event", event: ref.schema("EventPayload"), capabilities: { publish: [], subscribe: [] } },
  },
}));

const contract = defineAgentContract(() => ({
  id: "trellis.integration-events-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness event publish/subscribe.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] } }),
    harness: harness.use({ events: { publish: ["Harness.Rust.Event", "Harness.Ts.Event"], subscribe: ["Harness.Rust.Event", "Harness.Ts.Event"] } }),
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: { mode: "session_key", sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!, redirectTo: "/_trellis/portal/users/login" },
  log: false,
}).orThrow();

const controller = new AbortController();
const expected = Deno.env.get("HARNESS_EXPECTED_MESSAGE")!;
const received = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timed out waiting for TS subscriber event")), 10000);
  void client.event("Harness.Rust.Event", {}, (event) => {
    const message = (event as { message?: string }).message;
    const header = (event as { header?: { id?: unknown; time?: unknown } }).header;
    if (message !== expected) reject(new Error(`unexpected event ${JSON.stringify(event)}`));
    if (typeof header?.id !== "string" || typeof header.time !== "string") reject(new Error(`missing event header ${JSON.stringify(event)}`));
    clearTimeout(timeout);
    resolve();
    return ok(undefined);
  }, { mode: "ephemeral", replay: "new", signal: controller.signal }).orThrow();
});
console.log("TS_EVENTS_SUBSCRIBER_READY");
await received;
controller.abort();
await client.natsConnection.drain();
console.log("TS_EVENTS_SUBSCRIBER_OK");
"#;

const TS_PUBLISHER_SCRIPT: &str = r#"import { defineAgentContract, defineServiceContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  EventPayload: Type.Object({
    message: Type.String(),
    header: Type.Optional(Type.Object({ id: Type.String(), time: Type.String() }, { additionalProperties: false })),
  }, { additionalProperties: false }),
} as const;
const harness = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.events@v1",
  displayName: "Trellis Integration Harness Events",
  description: "Harness-owned service contract for full-stack Rust/TypeScript event verification.",
  events: {
    "Harness.Rust.Event": { version: "v1", subject: "events.v1.Harness.Rust.Event", event: ref.schema("EventPayload"), capabilities: { publish: [], subscribe: [] } },
    "Harness.Ts.Event": { version: "v1", subject: "events.v1.Harness.Ts.Event", event: ref.schema("EventPayload"), capabilities: { publish: [], subscribe: [] } },
  },
}));
const contract = defineAgentContract(() => ({
  id: "trellis.integration-events-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness event publish/subscribe.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] } }),
    harness: harness.use({ events: { publish: ["Harness.Rust.Event", "Harness.Ts.Event"], subscribe: ["Harness.Rust.Event", "Harness.Ts.Event"] } }),
  },
}));
if (contract.CONTRACT_DIGEST !== Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST")) throw new Error("caller contract digest mismatch");
const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: { mode: "session_key", sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!, redirectTo: "/_trellis/portal/users/login" },
  log: false,
}).orThrow();
await client.publish("Harness.Ts.Event", { message: Deno.env.get("HARNESS_MESSAGE")! }).orThrow();
await client.natsConnection.drain();
console.log("TS_EVENTS_PUBLISHER_OK");
"#;

const TS_SELF_SCRIPT: &str = r#"import { defineAgentContract, defineServiceContract, ok, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  EventPayload: Type.Object({
    message: Type.String(),
    header: Type.Optional(Type.Object({ id: Type.String(), time: Type.String() }, { additionalProperties: false })),
  }, { additionalProperties: false }),
} as const;
const harness = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.events@v1",
  displayName: "Trellis Integration Harness Events",
  description: "Harness-owned service contract for full-stack Rust/TypeScript event verification.",
  events: {
    "Harness.Rust.Event": { version: "v1", subject: "events.v1.Harness.Rust.Event", event: ref.schema("EventPayload"), capabilities: { publish: [], subscribe: [] } },
    "Harness.Ts.Event": { version: "v1", subject: "events.v1.Harness.Ts.Event", event: ref.schema("EventPayload"), capabilities: { publish: [], subscribe: [] } },
  },
}));
const contract = defineAgentContract(() => ({
  id: "trellis.integration-events-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness event publish/subscribe.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] } }),
    harness: harness.use({ events: { publish: ["Harness.Rust.Event", "Harness.Ts.Event"], subscribe: ["Harness.Rust.Event", "Harness.Ts.Event"] } }),
  },
}));
if (contract.CONTRACT_DIGEST !== Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST")) throw new Error("caller contract digest mismatch");
const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: { mode: "session_key", sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!, redirectTo: "/_trellis/portal/users/login" },
  log: false,
}).orThrow();
const controller = new AbortController();
const message = "ts-publish-ts-subscribe";
const received = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timed out waiting for TS self event")), 10000);
  void client.event("Harness.Ts.Event", {}, (event) => {
    const header = (event as { header?: { id?: unknown; time?: unknown } }).header;
    if ((event as { message?: string }).message !== message) reject(new Error(`unexpected self event ${JSON.stringify(event)}`));
    if (typeof header?.id !== "string" || typeof header.time !== "string") reject(new Error(`missing self event header ${JSON.stringify(event)}`));
    clearTimeout(timeout);
    resolve();
    return ok(undefined);
  }, { mode: "ephemeral", replay: "new", signal: controller.signal }).orThrow();
});
await new Promise((resolve) => setTimeout(resolve, 250));
await client.publish("Harness.Ts.Event", { message }).orThrow();
await received;
controller.abort();
await client.natsConnection.drain();
console.log("TS_EVENTS_SELF_OK");
"#;

const TS_DENIED_PUBLISH_SCRIPT: &str = r#"import { defineAgentContract, defineServiceContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  EventPayload: Type.Object({
    message: Type.String(),
    header: Type.Optional(Type.Object({ id: Type.String(), time: Type.String() }, { additionalProperties: false })),
  }, { additionalProperties: false }),
} as const;
const harness = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.events@v1",
  displayName: "Trellis Integration Harness Events",
  description: "Harness-owned service contract for full-stack Rust/TypeScript event verification.",
  events: {
    "Harness.Rust.Event": { version: "v1", subject: "events.v1.Harness.Rust.Event", event: ref.schema("EventPayload"), capabilities: { publish: [], subscribe: [] } },
    "Harness.Ts.Event": { version: "v1", subject: "events.v1.Harness.Ts.Event", event: ref.schema("EventPayload"), capabilities: { publish: [], subscribe: [] } },
  },
}));
const contract = defineAgentContract(() => ({
  id: "trellis.integration-events-subscribe-agent@v1",
  displayName: "Trellis Integration Events Subscriber",
  description: "Verify event publish is denied without publish permission.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] } }),
    harness: harness.use({ events: { subscribe: ["Harness.Rust.Event", "Harness.Ts.Event"] } }),
  },
}));
if (contract.CONTRACT_DIGEST !== Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST")) throw new Error("caller contract digest mismatch");
const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: { mode: "session_key", sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!, redirectTo: "/_trellis/portal/users/login" },
  log: false,
}).orThrow();
let publishSucceeded = false;
try {
  await client.publish("Harness.Ts.Event", { message: "ts-denied-publish" }).orThrow();
  publishSucceeded = true;
} catch (_error) {
  // Expected: the contract only grants event subscribe permission.
}
await client.natsConnection.drain();
if (publishSucceeded) {
  throw new Error("TS event publish unexpectedly succeeded without publish permission");
}
console.log("TS_EVENTS_DENIED_PUBLISH_OK");
"#;

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

impl trellis_client::EventDescriptor for HarnessRustEvent {
    type Event = HarnessEventPayload;

    const KEY: &'static str = "Harness.Rust.Event";
    const SUBJECT: &'static str = HARNESS_RUST_EVENT_SUBJECT;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}

struct HarnessTsEvent;

impl trellis_client::EventDescriptor for HarnessTsEvent {
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
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis_auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let service_contract_json = harness_service_contract_json()?;
    let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    SdkAuthClient::new(&admin_client)
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&service_contract_json)?,
            deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
            expected_digest: contract_digest,
        })
        .await
        .into_diagnostic()?;

    let caller_contract_json = harness_caller_contract_json()?;
    let caller_login =
        match trellis_auth::start_admin_reauth(&setup_login.state, &caller_contract_json)
            .await
            .into_diagnostic()?
        {
            trellis_auth::AdminReauthOutcome::Bound(outcome) => outcome,
            trellis_auth::AdminReauthOutcome::Flow(challenge) => {
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

    assert_rust_publish_rust_subscribe(&caller_client)
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
    run_ts_self_client(trellis_url, &caller_login.state.session_seed)
        .await
        .map_err(|error| miette!("TS publish -> TS subscribe failed: {error}"))?;
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

    Ok(PASSING_CASES)
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    match trellis_auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_auth::AdminReauthOutcome::Flow(challenge) => {
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
    state: &trellis_auth::AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis_auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_auth::AdminReauthOutcome::Flow(challenge) => {
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

async fn assert_rust_publish_rust_subscribe(client: &TrellisClient) -> Result<()> {
    let mut events = client
        .subscribe::<HarnessRustEvent>()
        .await
        .into_diagnostic()?;
    client.nats().flush().await.into_diagnostic()?;
    let expected = HarnessEventPayload {
        message: "rust-publish-rust-subscribe".to_string(),
        header: Some(event_header("rust-publish-rust-subscribe")),
    };
    client
        .publish::<HarnessRustEvent>(&expected)
        .await
        .into_diagnostic()?;
    client.nats().flush().await.into_diagnostic()?;
    expect_event::<HarnessRustEvent>(&mut events, &expected).await
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
    client.nats().flush().await.into_diagnostic()?;
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
    client.nats().flush().await.into_diagnostic()?;
    let expected = HarnessEventPayload {
        message: "ts-publish-rust-subscribe".to_string(),
        header: None,
    };
    run_ts_publisher(trellis_url, caller_session_seed, &expected.message).await?;
    expect_event_with_header::<HarnessTsEvent>(&mut events, &expected.message).await
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
        client.nats().flush().await.into_diagnostic()
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
        Result<HarnessEventPayload, trellis_client::TrellisClientError>,
    >,
    expected_message: &str,
) -> Result<()>
where
    D: trellis_client::EventDescriptor<Event = HarnessEventPayload>,
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
    let result = async {
        let _events = client
            .subscribe::<HarnessRustEvent>()
            .await
            .into_diagnostic()?;
        client.nats().flush().await.into_diagnostic()
    }
    .await;
    if result.is_ok() {
        return Err(miette!(
            "Rust event subscribe unexpectedly succeeded without subscribe permission"
        ));
    }
    Ok(())
}

async fn expect_event<D>(
    events: &mut futures_util::stream::BoxStream<
        'static,
        Result<HarnessEventPayload, trellis_client::TrellisClientError>,
    >,
    expected: &HarnessEventPayload,
) -> Result<()>
where
    D: trellis_client::EventDescriptor<Event = HarnessEventPayload>,
{
    let event = tokio::time::timeout(Duration::from_secs(10), events.next())
        .await
        .map_err(|_| miette!("{} subscription timed out", D::KEY))?
        .ok_or_else(|| miette!("{} subscription ended before event", D::KEY))?
        .into_diagnostic()?;
    if &event != expected {
        return Err(miette!("{} event mismatch: {:?}", D::KEY, event));
    }
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
        let script_path = write_ts_fixture_script("events-subscriber", TS_SUBSCRIBER_SCRIPT)?;
        let stdout_log = script_path.with_extension("stdout.log");
        let stderr_log = script_path.with_extension("stderr.log");
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

async fn run_ts_publisher(
    trellis_url: &str,
    caller_session_seed: &str,
    message: &str,
) -> Result<()> {
    run_ts_script(
        "events-publisher",
        TS_PUBLISHER_SCRIPT,
        trellis_url,
        caller_session_seed,
        Some(message),
        "TS_EVENTS_PUBLISHER_OK",
    )
    .await
}

async fn run_ts_self_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    run_ts_script(
        "events-self",
        TS_SELF_SCRIPT,
        trellis_url,
        caller_session_seed,
        None,
        "TS_EVENTS_SELF_OK",
    )
    .await
}

async fn run_ts_denied_publish(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    run_ts_script_with_digest(
        "events-denied-publish",
        TS_DENIED_PUBLISH_SCRIPT,
        trellis_url,
        caller_session_seed,
        &digest_contract_json(&harness_subscribe_only_contract_json()?).into_diagnostic()?,
        None,
        "TS_EVENTS_DENIED_PUBLISH_OK",
    )
    .await
}

async fn run_ts_script(
    name: &str,
    script: &str,
    trellis_url: &str,
    caller_session_seed: &str,
    message: Option<&str>,
    ok_marker: &str,
) -> Result<()> {
    run_ts_script_with_digest(
        name,
        script,
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
    script: &str,
    trellis_url: &str,
    caller_session_seed: &str,
    caller_digest: &str,
    message: Option<&str>,
    ok_marker: &str,
) -> Result<()> {
    let repo = repo_root()?;
    let script_path = write_ts_fixture_script(name, script)?;
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
    Ok(())
}

fn caller_contract_digest() -> Result<String> {
    digest_contract_json(&harness_caller_contract_json()?).into_diagnostic()
}

fn write_ts_fixture_script(name: &str, contents: &str) -> Result<PathBuf> {
    let path = std::env::temp_dir().join(format!(
        "trellis-integration-{name}-{}-{}.ts",
        std::process::id(),
        unique_suffix()
    ));
    std::fs::write(&path, contents)
        .into_diagnostic()
        .map_err(|error| {
            miette!(
                "failed to write TS events fixture script {}: {error}",
                path.display()
            )
        })?;
    Ok(path)
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse harness events contract JSON: {error}"))
}
