use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use async_nats::ConnectOptions;
use futures_util::StreamExt;
use serde_json::{json, Value};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use trellis_rs::client::{verify_event_proof, PreparedTrellisEvent};
use trellis_runtime_apis::health::client::HealthClient;
use trellis_runtime_apis::health::types::{
    HealthInspectRequest, HealthMetricsRequest, HealthQueryRequest, HealthQueryResponse,
    HealthWatchEvent, HealthWatchInput,
};
use ulid::Ulid;

use crate::support::assertions::assert_runtime_case_registered;

const CASE_ID: &str = "health.projection-lifecycle-and-recovery";
const SERVICE_NAME: &str = "health-fixture-service";
const SERVICE_API_SOURCE_JSON: &str = r#"{
  "format": "trellis.api.v1",
  "id": "integration.health-service@v1",
  "version": "1.0.0",
  "displayName": "Trellis Integration Health Service",
  "description": "Publishes runtime health samples for projection coverage."
}"#;
struct HealthFixtureContract;

struct HealthRuntimeProcess {
    child: Child,
    config_path: PathBuf,
    _host_slot: Option<trellis_test::TrellisTestHostSlot>,
}

impl HealthRuntimeProcess {
    async fn start(runtime: &trellis_test::TrellisTestRuntime) -> Self {
        let host_slot = trellis_test::reserve_additional_host_test_slot()
            .await
            .expect("reserve host runtime slot");
        let config_path = runtime.workdir().join("health-runtime.toml");
        let health_db = runtime.workdir().join("health.sqlite");
        let session_seed = runtime
            .workdir()
            .join(&runtime.manifest().paths.session_seed);
        let context_digest = runtime.workdir().join("health-context.digest");
        let auth_dir = runtime.workdir().join("trellis/auth");
        std::fs::write(
            &context_digest,
            "byhVYTUxr4iVywgon-utTJesrl5WZVm1MC0PXqCU06c\n",
        )
        .expect("write health event context digest");
        let nats_dir = runtime.workdir().join("nats/creds");
        let config = format!(
            r#"instance_name = "health-integration"
event_session_seed_file = "{}"
event_context_digest_file = "{}"

[http]
port = 0

[nats]
servers = "{}"

[nats.runtime]
auth_creds_path = "{}"
trellis_creds_path = "{}"
system_creds_path = "{}"

[health]
history_retention_days = 30
transport_retention_hours = 24
transport_max_bytes = 16777216

[health.storage]
kind = "sqlite"
path = "{}"
journal_mode = "wal"
busy_timeout_ms = 5000
single_writer = true

[leases]
bucket = "trellis_runtime_leases"
replicas = 1
ttl_ms = 9000
renew_ms = 3000

[auth.authorization]
trust_root_file = "{}"
issuer_manifest_file = "{}"
issuer_signing_seed_file = "{}"
context_lifetime_seconds = 300
refresh_lead_seconds = 60
refresh_jitter_seconds = 15
minimum_context_lifetime_seconds = 76
maximum_bootstrap_jwt_lifetime_seconds = 3600
cleanup_grace_seconds = 3600
allowed_clock_skew_seconds = 30
maximum_context_bytes = 16384
maximum_permissions = 4096
maximum_capabilities = 256
trust_bucket = "trellis_authorization_trust"
context_bucket = "trellis_authorization_contexts"
registry_replicas = 1
"#,
            toml_path(&session_seed),
            toml_path(&context_digest),
            runtime.nats_url(),
            toml_path(&nats_dir.join("auth-auth.creds")),
            toml_path(&nats_dir.join("trellis-auth.creds")),
            toml_path(&nats_dir.join("system.creds")),
            toml_path(&health_db),
            toml_path(&auth_dir.join("authorization-root.json")),
            toml_path(&auth_dir.join("authorization-issuer-manifest.json")),
            toml_path(&auth_dir.join("authorization-issuer.seed")),
        );
        std::fs::write(&config_path, config).expect("write health runtime config");
        let rust_dir = rust_dir();
        let stdout = File::create(runtime.workdir().join("health-runtime.stdout.log"))
            .expect("create health runtime stdout log");
        let stderr = File::create(runtime.workdir().join("health-runtime.stderr.log"))
            .expect("create health runtime stderr log");
        let child = health_command(rust_dir, &config_path)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .expect("start Rust health runtime");
        Self {
            child,
            config_path,
            _host_slot: host_slot,
        }
    }

    fn restart(&mut self) {
        self.stop();
        self.child = health_command(rust_dir(), &self.config_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("restart Rust health runtime");
    }

    fn stop(&mut self) {
        if self
            .child
            .try_wait()
            .expect("inspect health runtime")
            .is_none()
        {
            let pid = self.child.id().to_string();
            let signalled = Command::new("kill").args(["-TERM", &pid]).status();
            if signalled.is_err() || signalled.is_ok_and(|status| !status.success()) {
                let _ = self.child.kill();
            }
            let _ = self.child.wait();
        }
    }
}

impl Drop for HealthRuntimeProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

#[tokio::test]
async fn service_heartbeat_uses_refreshed_native_connection() {
    assert_runtime_case_registered(
        "health.service-heartbeat-uses-refreshed-native-connection",
        "health",
        "health",
    );
    let mut options = trellis_test::TrellisTestRuntimeOptions::repo_platform();
    options.rotatable_nats_proxy = true;
    let mut runtime = trellis_test::TrellisTestRuntime::start(options)
        .await
        .expect("start rotatable Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        "integration.health-service@v1",
        SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build health service contract");
    let service_key = runtime
        .admin()
        .provision_service_instance(&bootstrap_url, &service_contract, Some(SERVICE_NAME), None)
        .await
        .expect("provision health service");
    let service_runtime = trellis_test::connect_service_runtime::<HealthFixtureContract>(
        runtime.trellis_url(),
        &service_key,
    )
    .await
    .expect("connect Rust health service");

    let ((retired_url, replacement_url), _) = runtime
        .stage_nats_proxy_rotation()
        .await
        .expect("rotate advertised NATS endpoints");
    let observer = ConnectOptions::new()
        .credentials_file(runtime.workdir().join("nats/creds/trellis-auth.creds"))
        .await
        .expect("load Trellis NATS creds")
        .connect(&replacement_url)
        .await
        .expect("connect heartbeat observer through endpoint B");
    let mut heartbeats = observer
        .subscribe("health.v1.heartbeat.>".to_string())
        .await
        .expect("subscribe through endpoint B");
    observer
        .flush()
        .await
        .expect("flush heartbeat subscription");
    service_runtime
        .caller()
        .integration_test_refresh_authorization_context()
        .await
        .expect("refresh service connection with endpoint B");
    runtime.retire_staged_nats_proxies();

    let heartbeat = tokio::time::timeout(Duration::from_secs(45), heartbeats.next())
        .await
        .expect("receive heartbeat after endpoint refresh")
        .expect("heartbeat transport remains open");
    let sample: Value =
        serde_json::from_slice(&heartbeat.payload).expect("decode post-rotation heartbeat");
    assert_eq!(
        sample["participant"]["contractId"],
        service_key.participant_id
    );
    assert!(
        tokio::net::TcpStream::connect(retired_url.trim_start_matches("nats://"))
            .await
            .is_err(),
        "retired endpoint A remained usable"
    );
}

#[tokio::test]
async fn health_projection_lifecycle_and_recovery() {
    assert_runtime_case_registered(CASE_ID, "health", "health");
    let runtime = trellis_test::TrellisTestRuntime::start(
        trellis_test::TrellisTestRuntimeOptions::repo_platform(),
    )
    .await
    .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        "integration.health-service@v1",
        SERVICE_API_SOURCE_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build health service contract");
    let health_api = trellis_test::TrellisTestContract::from_native_api_json(
        trellis_runtime_apis::health::API_ID,
        trellis_runtime_apis::health::API_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build Health API evidence");
    let observer_contract =
        trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
            trellis_rs::contracts::ContractBuilder::authoring(
                "integration.health-observer@v1",
                "integration.health-observer@v1",
                "1.0.0",
                "Trellis Integration Health Observer",
                "Reads the Trellis health projection.",
                trellis_rs::contracts::ContractKind::App,
            )
            .use_ref(
                "health",
                trellis_rs::contracts::use_contract(trellis_runtime_apis::health::API_ID)
                    .with_rpc_call(["Health.Query", "Health.Inspect", "Health.Metrics"])
                    .with_feed_subscribe(["Health.Watch"])
                    .with_event_subscribe(["Health.StatusChanged"]),
            ),
            &[&health_api],
        )
        .expect("build health observer contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, Some(SERVICE_NAME), None)
        .await
        .expect("provision health service");
    let observer = admin
        .connect_client(&bootstrap_url, &observer_contract)
        .await
        .expect("connect health observer");

    let mut health_runtime = HealthRuntimeProcess::start(&runtime).await;
    let raw_nats = ConnectOptions::new()
        .credentials_file(runtime.workdir().join("nats/creds/trellis-auth.creds"))
        .await
        .expect("load Trellis NATS creds")
        .connect(runtime.nats_url())
        .await
        .expect("connect Trellis NATS observer");
    let mut heartbeats = raw_nats
        .subscribe("health.v1.heartbeat.>".to_string())
        .await
        .expect("subscribe to heartbeat transport");
    let mut transitions = raw_nats
        .subscribe("events.v1.Health.StatusChanged".to_string())
        .await
        .expect("subscribe to health transitions");
    raw_nats
        .flush()
        .await
        .expect("flush observer subscriptions");

    let service_id = service_key.participant_id.clone();
    let service_runtime = trellis_test::connect_service_runtime::<HealthFixtureContract>(
        runtime.trellis_url(),
        &service_key,
    )
    .await
    .expect("connect Rust health service");
    let first_heartbeat = tokio::time::timeout(Duration::from_secs(20), heartbeats.next())
        .await
        .expect("receive automatic heartbeat before timeout")
        .expect("heartbeat transport remains open");
    let mut sample: Value =
        serde_json::from_slice(&first_heartbeat.payload).expect("decode automatic heartbeat");
    assert_eq!(sample["participant"]["contractId"], service_id);
    assert_eq!(sample["participant"]["runtime"], "rust");

    let health = HealthClient::new(crate::generated_caller(&observer));
    let initial = wait_for_query(
        &health,
        &service_id,
        "initial healthy projection",
        |entry| entry.online_instances == 1,
    )
    .await;
    assert_eq!(initial.entries[0].effective_status, "healthy");
    let initial_revision = initial.projection.revision;

    let mut watch = health
        .feed()
        .health()
        .watch(&HealthWatchInput {
            contract_ids: Some(vec![service_id.clone()]),
            deployment_ids: None,
            instance_ids: None,
            participant_kinds: Some(vec![crate::wire("service")]),
        })
        .await
        .expect("subscribe to Health.Watch");
    let ready = tokio::time::timeout(Duration::from_secs(5), watch.next())
        .await
        .expect("receive Health.Watch ready frame")
        .expect("health watch remains open")
        .expect("decode health watch ready frame");
    assert!(matches!(ready, HealthWatchEvent::Ready { .. }));

    update_sample(&mut sample, "healthy", 1_000);
    service_runtime
        .event_publisher()
        .publish_prepared(&PreparedTrellisEvent::new(
            first_heartbeat.subject.to_string(),
            sample.to_string().into(),
        ))
        .await
        .expect("publish short-deadline heartbeat");
    let invalidated = tokio::time::timeout(Duration::from_secs(5), watch.next())
        .await
        .expect("receive Health.Watch invalidation")
        .expect("health watch remains open")
        .expect("decode health invalidation");
    assert!(matches!(
        invalidated,
        HealthWatchEvent::HealthInvalidated { .. }
    ));

    let offline = wait_for_query(
        &health,
        &service_id,
        "offline deadline projection",
        |entry| entry.offline_instances == 1,
    )
    .await;
    assert_eq!(offline.entries[0].effective_status, "offline");
    assert!(offline.projection.revision > initial_revision);
    let transition = tokio::time::timeout(Duration::from_secs(5), transitions.next())
        .await
        .expect("receive status transition before timeout")
        .expect("status transition subscription remains open");
    assert_signed_transition(&transition);

    let inspect = health
        .rpc()
        .health()
        .inspect(&HealthInspectRequest {
            contract_id: service_id.clone(),
            history_limit: Some(20),
            history_since: None,
            instance_id: None,
            participant_kind: crate::wire("service"),
        })
        .await
        .expect("inspect projected health");
    assert!(inspect.history.iter().any(|interval| {
        interval.effective_status == "offline" && interval.reason == "deadline-expired"
    }));
    let now = OffsetDateTime::now_utc();
    let metrics = health
        .rpc()
        .health()
        .metrics(&HealthMetricsRequest {
            check_names: None,
            contract_id: service_id.clone(),
            end: (now + time::Duration::seconds(1))
                .format(&Rfc3339)
                .expect("format metrics end"),
            instance_ids: None,
            participant_kind: crate::wire("service"),
            start: (now - time::Duration::minutes(5))
                .format(&Rfc3339)
                .expect("format metrics start"),
            step_ms: 300_000,
        })
        .await
        .expect("query health metrics");
    assert!(metrics.summary.sample_count >= 2);
    assert!(metrics.summary.transitions >= 1);

    health_runtime.stop();
    update_sample(&mut sample, "degraded", 30_000);
    service_runtime
        .event_publisher()
        .publish_prepared(&PreparedTrellisEvent::new(
            first_heartbeat.subject.to_string(),
            sample.to_string().into(),
        ))
        .await
        .expect("publish heartbeat while projector is stopped");
    health_runtime.restart();
    let recovered = wait_for_query(
        &health,
        &service_id,
        "degraded projection after projector restart",
        |entry| entry.effective_status == "degraded",
    )
    .await;
    assert_eq!(recovered.entries[0].effective_status, "degraded");
    assert!(!recovered.projection.gap_detected);
}

fn assert_signed_transition(transition: &async_nats::Message) {
    let headers = transition.headers.as_ref().expect("transition headers");
    let event_id = headers
        .get("Nats-Msg-Id")
        .expect("transition event id")
        .as_str();
    let event_time = headers
        .get("Trellis-Event-Time")
        .expect("transition event time")
        .as_str();
    let session_key = headers
        .get("session-key")
        .expect("transition session key")
        .as_str();
    let context_digest = headers
        .get("authorization-context")
        .expect("transition authorization-context")
        .as_str();
    let proof = headers.get("proof").expect("transition proof").as_str();
    assert!(verify_event_proof(
        session_key,
        context_digest,
        transition.subject.as_str(),
        &transition.payload,
        event_id,
        event_time,
        proof,
    )
    .expect("verify Health.StatusChanged proof"));
    let payload: Value =
        serde_json::from_slice(&transition.payload).expect("decode status transition");
    assert_eq!(payload["status"], "offline");
}

async fn wait_for_query(
    health: &HealthClient<'_>,
    contract_id: &str,
    expected: &str,
    predicate: impl Fn(&trellis_runtime_apis::health::types::HealthQueryResponseEntriesItem) -> bool,
) -> HealthQueryResponse {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    loop {
        let last_observation = match health
            .rpc()
            .health()
            .query(&HealthQueryRequest {
                contract_ids: Some(vec![contract_id.to_string()]),
                deployment_ids: None,
                limit: Some(20),
                offset: Some(0),
                participant_kinds: Some(vec![crate::wire("service")]),
                search: None,
                statuses: None,
            })
            .await
        {
            Ok(response) => {
                if response.entries.first().is_some_and(&predicate) {
                    return response;
                }
                format!("response: {:?}", response.entries.first())
            }
            Err(error) => format!("query error: {error}"),
        };
        assert!(
            tokio::time::Instant::now() < deadline,
            "health query did not reach {expected}; last observation: {last_observation}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn update_sample(sample: &mut Value, status: &str, publish_interval_ms: i64) {
    sample["sample"]["id"] = json!(Ulid::new().to_string());
    sample["sample"]["time"] = json!(OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("format sample time"));
    sample["participant"]["publishIntervalMs"] = json!(publish_interval_ms);
    sample["reportedStatus"] = json!(status);
}

fn rust_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("trellis-rs crate should live under rust/crates/trellis")
}

fn health_command(rust_dir: &Path, config_path: &Path) -> Command {
    trellis_test::record_test_process_start("trellis", "health")
        .expect("record Rust Health process start");
    let mut command = if let Some(binary) = std::env::var_os("TRELLIS_TEST_SERVER_BIN") {
        Command::new(binary)
    } else {
        let mut command = Command::new("cargo");
        command.args([
            "run",
            "--quiet",
            "--manifest-path",
            rust_dir
                .join("Cargo.toml")
                .to_str()
                .expect("UTF-8 Cargo path"),
            "-p",
            "trellis-runtime",
            "--bin",
            "trellis-server",
            "--",
        ]);
        command
    };
    command
        .args([
            "health",
            "--config",
            config_path.to_str().expect("UTF-8 health config path"),
        ])
        .current_dir(rust_dir)
        .stdin(Stdio::null());
    trellis_test::terminate_on_parent_exit(&mut command);
    command
}

fn toml_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "\\\\")
}
