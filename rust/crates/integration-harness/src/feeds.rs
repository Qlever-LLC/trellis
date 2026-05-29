use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::time::Duration;

use async_nats::HeaderMap;
use bytes::Bytes;
use futures_util::{stream, StreamExt};
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use trellis::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis::client::{ServiceConnectOptions, TrellisClient};
use trellis::contracts::{
    digest_contract_json, feed, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis::service::{ConnectedServiceRuntime, ServerError};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::deno_fixture::{deno_fixture_log_paths, deno_fixture_path};
use crate::deployment_authority::plan_accept_reconcile_deployment_authority;
use crate::workspace::repo_root;

const HARNESS_DEPLOYMENT_ID: &str = "harness.feeds";
const HARNESS_RUST_SERVICE_NAME: &str = "harness-feeds-rust";
const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.feeds@v1";
const HARNESS_CALLER_CONTRACT_ID: &str = "trellis.integration-feeds-agent@v1";
const HARNESS_RUST_FEED_SUBJECT: &str = "feeds.v1.Harness.Rust.Feed";
const HARNESS_TS_FEED_SUBJECT: &str = "feeds.v1.Harness.Ts.Feed";
const TRACE_FEED_TOPIC: &str = "ts-client-rust-feed-trace";
const PASSING_CASES: usize = 12;

fn harness_service_contract_json() -> Result<String> {
    let input_schema = json!({
        "type": "object",
        "properties": { "topic": { "type": "string" } },
        "required": ["topic"]
    });
    let event_schema = json!({
        "type": "object",
        "properties": {
            "message": { "type": "string" },
            "topic": { "type": "string" },
            "traceparent": { "type": "string" }
        },
        "required": ["message", "topic"]
    });
    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration Harness Feeds",
        "Harness-owned service contract for full-stack Rust/TypeScript feed verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("FeedInput", input_schema)
    .schema("FeedEvent", event_schema)
    .feed(
        "Harness.Rust.Feed",
        feed("v1", HARNESS_RUST_FEED_SUBJECT, "FeedInput", "FeedEvent")
            .with_subscribe_capabilities(std::iter::empty::<&str>()),
    )
    .feed(
        "Harness.Ts.Feed",
        feed("v1", HARNESS_TS_FEED_SUBJECT, "FeedInput", "FeedEvent")
            .with_subscribe_capabilities(std::iter::empty::<&str>()),
    )
    .build()
    .map_err(|error| miette!("failed to build feeds harness service contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize feeds harness service contract: {error}"))
}

fn harness_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        HARNESS_CALLER_CONTRACT_ID,
        "Trellis Integration Feeds Agent",
        "Verify delegated Rust agent login and harness feed subscriptions.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID)
            .with_feed_subscribe(["Harness.Rust.Feed", "Harness.Ts.Feed"]),
    )
    .build()
    .map_err(|error| miette!("failed to build feeds harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize feeds harness caller contract: {error}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HarnessFeedInput {
    topic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HarnessFeedEvent {
    message: String,
    topic: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    traceparent: Option<String>,
}

struct HarnessRustFeed;

impl trellis::client::FeedDescriptor for HarnessRustFeed {
    type Input = HarnessFeedInput;
    type Event = HarnessFeedEvent;

    const KEY: &'static str = "Harness.Rust.Feed";
    const SUBJECT: &'static str = HARNESS_RUST_FEED_SUBJECT;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}

struct HarnessTsFeed;

impl trellis::client::FeedDescriptor for HarnessTsFeed {
    type Input = HarnessFeedInput;
    type Event = HarnessFeedEvent;

    const KEY: &'static str = "Harness.Ts.Feed";
    const SUBJECT: &'static str = HARNESS_TS_FEED_SUBJECT;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}

pub(crate) async fn run_feeds_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis::auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let service_contract_json = harness_service_contract_json()?;
    let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    plan_accept_reconcile_deployment_authority(
        &SdkAuthClient::new(&admin_client),
        HARNESS_DEPLOYMENT_ID,
        &service_contract_json,
        &contract_digest,
        "integration harness feeds service setup",
    )
    .await?;

    let (rust_service_seed, rust_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
            instance_key: rust_service_key,
        })
        .await
        .into_diagnostic()?;
    let (ts_service_seed, ts_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
            instance_key: ts_service_key,
        })
        .await
        .into_diagnostic()?;

    let service_client = Arc::new(
        connect_service_with_retry(trellis_url, &contract_digest, &rust_service_seed)
            .await
            .into_diagnostic()?,
    );

    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        HARNESS_RUST_SERVICE_NAME,
        Arc::clone(&service_client),
    )
    .map_err(|error| miette!("failed to create feeds service runtime: {error}"))?;
    service.register_feed::<HarnessRustFeed, _, _>(|ctx, input| {
        stream::once(async move {
            if input.topic.starts_with("slow-") {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            let traceparent = if input.topic == TRACE_FEED_TOPIC {
                Some(
                    ctx.into_request_context()
                        .traceparent
                        .ok_or_else(|| ServerError::Nats("missing feed traceparent".to_string()))?,
                )
            } else {
                None
            };
            Ok(HarnessFeedEvent {
                message: format!("rust-feed:{}", input.topic),
                topic: input.topic,
                traceparent,
            })
        })
    });
    let service_task = tokio::spawn(async move { service.run().await });

    let ts_service = TsServiceProcess::start(trellis_url, &contract_digest, &ts_service_seed)?;
    ts_service.wait_ready().await?;

    let call_result = async {
        let caller_contract_json = harness_caller_contract_json()?;
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
        assert_rust_feed::<HarnessRustFeed>(
            &caller_client,
            "rust-client-rust-feed",
            "rust-feed:rust-client-rust-feed",
        )
        .await?;
        assert_rust_feed::<HarnessTsFeed>(
            &caller_client,
            "rust-client-ts-feed",
            "ts-feed:rust-client-ts-feed",
        )
        .await?;
        assert_ready_frame_then_event::<HarnessRustFeed>(
            &caller_client,
            "rust-client-rust-ready-feed",
            "rust-feed:rust-client-rust-ready-feed",
        )
        .await?;
        assert_ready_frame_then_event::<HarnessTsFeed>(
            &caller_client,
            "rust-client-ts-ready-feed",
            "ts-feed:rust-client-ts-ready-feed",
        )
        .await?;
        assert_concurrent_rust_feeds::<HarnessRustFeed>(
            &caller_client,
            "rust-client-rust-feed",
            "rust-feed",
        )
        .await?;
        assert_concurrent_rust_feeds::<HarnessTsFeed>(
            &caller_client,
            "rust-client-ts-feed",
            "ts-feed",
        )
        .await?;
        assert_invalid_feed_proof_denied(&caller_client).await?;
        run_ts_client(trellis_url, &caller_login.state.session_seed).await?;
        Ok(PASSING_CASES)
    }
    .await;
    service_task.abort();
    drop(ts_service);
    call_result
}

async fn assert_concurrent_rust_feeds<F>(
    client: &TrellisClient,
    topic_prefix: &str,
    expected_prefix: &str,
) -> Result<()>
where
    F: trellis::client::FeedDescriptor<Input = HarnessFeedInput, Event = HarnessFeedEvent>,
{
    let started = tokio::time::Instant::now();
    let topic_a = format!("slow-{topic_prefix}-a");
    let topic_b = format!("slow-{topic_prefix}-b");
    let expected_a = format!("{expected_prefix}:{topic_a}");
    let expected_b = format!("{expected_prefix}:{topic_b}");
    tokio::try_join!(
        assert_rust_feed::<F>(client, &topic_a, &expected_a),
        assert_rust_feed::<F>(client, &topic_b, &expected_b),
    )?;
    if started.elapsed() > Duration::from_millis(1500) {
        return Err(miette!(
            "{} concurrent feed subscriptions did not complete concurrently",
            F::KEY
        ));
    }
    Ok(())
}

async fn assert_rust_feed<F>(
    client: &TrellisClient,
    topic: &str,
    expected_message: &str,
) -> Result<()>
where
    F: trellis::client::FeedDescriptor<Input = HarnessFeedInput, Event = HarnessFeedEvent>,
{
    let input = HarnessFeedInput {
        topic: topic.to_string(),
    };
    let mut stream = client.feed::<F>(&input).await.into_diagnostic()?;
    let event = tokio::time::timeout(Duration::from_secs(10), stream.next())
        .await
        .map_err(|_| miette!("{} feed timed out", F::KEY))?
        .ok_or_else(|| miette!("{} feed ended before first event", F::KEY))?
        .into_diagnostic()?;
    if event
        != (HarnessFeedEvent {
            message: expected_message.to_string(),
            topic: topic.to_string(),
            traceparent: None,
        })
    {
        return Err(miette!("{} event mismatch: {event:?}", F::KEY));
    }
    Ok(())
}

async fn assert_ready_frame_then_event<F>(
    client: &TrellisClient,
    topic: &str,
    expected_message: &str,
) -> Result<()>
where
    F: trellis::client::FeedDescriptor<Input = HarnessFeedInput, Event = HarnessFeedEvent>,
{
    let input = HarnessFeedInput {
        topic: topic.to_string(),
    };
    let payload = Bytes::from(serde_json::to_vec(&input).into_diagnostic()?);
    let iat = current_iat();
    let request_id = format!("integration-feed-ready-{}", unique_suffix());
    let proof = client
        .auth()
        .create_proof(F::SUBJECT, &payload, iat, &request_id);
    let mut headers = HeaderMap::new();
    headers.insert("session-key", client.auth().session_key.as_str());
    headers.insert("proof", proof.as_str());
    headers.insert("iat", iat.to_string().as_str());
    headers.insert("request-id", request_id.as_str());
    let inbox = format!(
        "{}.feeds-ready-{}",
        client.auth().inbox_prefix(),
        unique_suffix()
    );
    let mut subscriber = client
        .nats()
        .subscribe(inbox.clone())
        .await
        .into_diagnostic()?;
    client
        .nats()
        .publish_with_reply_and_headers(F::SUBJECT.to_string(), inbox, headers, payload)
        .await
        .into_diagnostic()?;
    client.nats().flush().await.into_diagnostic()?;

    let ready = tokio::time::timeout(Duration::from_secs(10), subscriber.next())
        .await
        .map_err(|_| miette!("{} ready frame timed out", F::KEY))?
        .ok_or_else(|| miette!("{} feed ended before ready frame", F::KEY))?;
    let ready_status = ready
        .headers
        .as_ref()
        .and_then(|headers| headers.get("feed-status"))
        .map(|value| value.as_str());
    if ready_status != Some("ready") || !ready.payload.is_empty() {
        return Err(miette!("{} first frame was not a ready frame", F::KEY));
    }

    let event_message = tokio::time::timeout(Duration::from_secs(10), subscriber.next())
        .await
        .map_err(|_| miette!("{} event frame timed out", F::KEY))?
        .ok_or_else(|| miette!("{} feed ended before event frame", F::KEY))?;
    let event: HarnessFeedEvent = serde_json::from_slice(&event_message.payload)
        .into_diagnostic()
        .map_err(|error| miette!("{} failed to decode event frame: {error}", F::KEY))?;
    if event
        != (HarnessFeedEvent {
            message: expected_message.to_string(),
            topic: topic.to_string(),
            traceparent: None,
        })
    {
        return Err(miette!("{} raw event mismatch: {event:?}", F::KEY));
    }
    drop(subscriber);
    client.nats().flush().await.into_diagnostic()?;
    Ok(())
}

async fn assert_invalid_feed_proof_denied(client: &TrellisClient) -> Result<()> {
    let input = HarnessFeedInput {
        topic: "invalid-proof-rust-feed".to_string(),
    };
    let payload = Bytes::from(serde_json::to_vec(&input).into_diagnostic()?);
    let iat = current_iat();
    let request_id = format!("integration-feed-invalid-proof-{}", unique_suffix());
    let mut headers = HeaderMap::new();
    headers.insert("session-key", client.auth().session_key.as_str());
    headers.insert("proof", "invalid-proof");
    headers.insert("iat", iat.to_string().as_str());
    headers.insert("request-id", request_id.as_str());
    let inbox = format!(
        "{}.feeds-invalid-proof-{}",
        client.auth().inbox_prefix(),
        unique_suffix()
    );
    let mut subscriber = client
        .nats()
        .subscribe(inbox.clone())
        .await
        .into_diagnostic()?;
    client
        .nats()
        .publish_with_reply_and_headers(
            HARNESS_RUST_FEED_SUBJECT.to_string(),
            inbox,
            headers,
            payload,
        )
        .await
        .into_diagnostic()?;
    client.nats().flush().await.into_diagnostic()?;

    let denial = tokio::time::timeout(Duration::from_secs(10), subscriber.next())
        .await
        .map_err(|_| miette!("invalid feed proof denial timed out"))?
        .ok_or_else(|| miette!("invalid feed proof ended before denial frame"))?;
    let status = denial
        .headers
        .as_ref()
        .and_then(|headers| headers.get("status"))
        .map(|value| value.as_str());
    if status != Some("error") {
        return Err(miette!(
            "invalid feed proof did not return an error frame: {denial:?}"
        ));
    }
    let body = String::from_utf8_lossy(&denial.payload);
    if !body.contains("invalid_signature") && !body.contains("denied") {
        return Err(miette!(
            "invalid feed proof returned an unexpected denial payload: {body}"
        ));
    }
    Ok(())
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

#[derive(Debug)]
struct TsServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsServiceProcess {
    fn start(trellis_url: &str, contract_digest: &str, service_seed: &str) -> Result<Self> {
        let repo = repo_root()?;
        let script_path = deno_fixture_path("feeds/service.ts")?;
        let (stdout_log, stderr_log) = deno_fixture_log_paths("feeds-service")?;
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create TS feeds service stdout log: {error}"))?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create TS feeds service stderr log: {error}"))?;
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
            .env("HARNESS_CONTRACT_DIGEST", contract_digest)
            .env("HARNESS_TS_SERVICE_SEED", service_seed)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .map_err(|error| miette!("failed to start TS feeds service fixture: {error}"))?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    async fn wait_ready(&self) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if std::fs::read_to_string(&self.stdout_log)
                .unwrap_or_default()
                .contains("TS_FEEDS_SERVICE_READY")
            {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS feeds service fixture readiness; stdout: {stdout}; stderr: {stderr}"
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

impl Drop for TsServiceProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect TS feeds service child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS feeds service child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS feeds service child: {error}");
        }
    }
}

async fn run_ts_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    let repo = repo_root()?;
    let script_path = deno_fixture_path("feeds/client.ts")?;
    let caller_contract_json = harness_caller_contract_json()?;
    let caller_digest = digest_contract_json(&caller_contract_json).into_diagnostic()?;
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
        .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_digest)
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed)
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS feeds client fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS feeds client fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_FEEDS_CLIENT_OK") {
        return Err(miette!(
            "TS feeds client fixture did not report success: {stdout}"
        ));
    }
    Ok(())
}

fn current_iat() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

async fn connect_service_with_retry(
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<TrellisClient, trellis::client::TrellisClientError> {
    let mut last_error = None;
    for _ in 0..10 {
        match TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url,
            contract_id: HARNESS_CONTRACT_ID,
            contract_digest,
            session_key_seed_base64url: service_seed,
            timeout_ms: 5_000,
        })
        .await
        {
            Ok(client) => return Ok(client),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }

    Err(last_error.expect("service connect retry should record at least one error"))
}
