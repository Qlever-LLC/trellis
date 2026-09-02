use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::Duration;

use async_nats::jetstream::{self, kv};
use async_nats::ConnectOptions;
use bytes::Bytes;
use futures_util::StreamExt;

const LEASE_BUCKET: &str = "trellis_runtime_leases";

struct RuntimeProcess {
    child: Child,
    url: String,
    stderr_path: PathBuf,
    _host_slot: Option<trellis_test::TrellisTestHostSlot>,
    _port_reservation: trellis_test::TrellisTestPortReservation,
}

impl RuntimeProcess {
    async fn start(
        runtime: &trellis_test::TrellisTestRuntime,
        mode: &str,
        config_path: &Path,
        label: &str,
    ) -> Self {
        let host_slot = trellis_test::reserve_host_test_slot()
            .await
            .expect("reserve host runtime slot");
        let mut port_reservation =
            trellis_test::reserve_local_port().expect("reserve runtime port");
        let port = port_reservation.port().expect("read reserved runtime port");
        write_runtime_config(runtime, mode, config_path, label, port);
        let stdout = File::create(runtime.workdir().join(format!("{label}.stdout.log")))
            .expect("create runtime stdout log");
        let stderr_path = runtime.workdir().join(format!("{label}.stderr.log"));
        let stderr = File::create(&stderr_path).expect("create runtime stderr log");
        port_reservation.release_listener();
        let mut command = runtime_command(mode, config_path, false);
        command
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
        trellis_test::terminate_on_parent_exit(&mut command);
        let child = command.spawn().expect("start Rust runtime process");
        Self {
            child,
            url: format!("http://127.0.0.1:{port}"),
            stderr_path,
            _host_slot: host_slot,
            _port_reservation: port_reservation,
        }
    }

    async fn wait_ready(&mut self) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        loop {
            if reqwest::get(format!("{}/readyz", self.url))
                .await
                .is_ok_and(|response| response.status().is_success())
            {
                return;
            }
            if let Some(status) = self.child.try_wait().expect("inspect runtime process") {
                panic!(
                    "runtime exited before readiness with {status}: {}",
                    self.stderr()
                );
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "runtime did not become ready: {}",
                self.stderr()
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    async fn wait_exit(&mut self) -> ExitStatus {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(status) = self.child.try_wait().expect("inspect runtime process") {
                self._host_slot = None;
                return status;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "runtime did not exit: {}",
                self.stderr()
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    async fn terminate(&mut self) -> ExitStatus {
        let started = tokio::time::Instant::now();
        let pid = self.child.id().to_string();
        let signal = Command::new("kill")
            .args(["-TERM", &pid])
            .status()
            .expect("send SIGTERM to runtime");
        assert!(signal.success(), "send SIGTERM to runtime process");
        let status = self.wait_exit().await;
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "SIGTERM shutdown exceeded its bound: {}",
            self.stderr()
        );
        status
    }

    async fn is_ready(&mut self) -> bool {
        self.child
            .try_wait()
            .expect("inspect runtime process")
            .is_none()
            && reqwest::get(format!("{}/readyz", self.url))
                .await
                .is_ok_and(|response| response.status().is_success())
    }

    fn stderr(&self) -> String {
        std::fs::read_to_string(&self.stderr_path).unwrap_or_default()
    }
}

impl Drop for RuntimeProcess {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[tokio::test]
async fn runtime_singleton_ownership_lifecycle() {
    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let client = ConnectOptions::new()
        .credentials_file(runtime.workdir().join("nats/creds/trellis-auth.creds"))
        .await
        .expect("load Trellis NATS credentials")
        .connect(runtime.nats_url())
        .await
        .expect("connect authenticated lease test client");
    runtime
        .stop_control_plane()
        .expect("stop default platform owner");
    jetstream::new(client.clone())
        .delete_key_value(LEASE_BUCKET)
        .await
        .expect("remove default platform lease bucket");

    let first_config = runtime.workdir().join("jobs-first.toml");
    let mut first = RuntimeProcess::start(&runtime, "jobs", &first_config, "jobs-first").await;
    first.wait_ready().await;
    assert_jobs_owner_consumers(&client).await;

    let blocked_storage = runtime.workdir().join("blocked-jobs.sqlite");
    std::fs::create_dir(&blocked_storage).expect("create path that SQLite cannot open as a file");
    let duplicate_config = runtime.workdir().join("jobs-duplicate.toml");
    let mut duplicate =
        RuntimeProcess::start(&runtime, "jobs", &duplicate_config, "jobs-duplicate").await;
    let duplicate_status = duplicate.wait_exit().await;
    let duplicate_error = duplicate.stderr();
    assert!(!duplicate_status.success());
    assert!(duplicate_error.contains("jobs.owner"), "{duplicate_error}");
    assert!(
        duplicate_error.contains("already held"),
        "{duplicate_error}"
    );
    assert!(!duplicate_error.contains("runtime storage failed"));
    assert!(blocked_storage.is_dir());
    assert!(first.is_ready().await, "first Jobs owner lost readiness");

    let first_status = first.terminate().await;
    assert!(
        first_status.success(),
        "first Jobs owner exited with {first_status}: {}",
        first.stderr()
    );
    let successor_config = runtime.workdir().join("jobs-successor.toml");
    let mut successor =
        RuntimeProcess::start(&runtime, "jobs", &successor_config, "jobs-successor").await;
    successor.wait_ready().await;

    let leases = jetstream::new(client.clone())
        .get_key_value(LEASE_BUCKET)
        .await
        .expect("open runtime lease bucket");
    leases
        .delete("jobs.owner")
        .await
        .expect("force Jobs owner lease loss");
    let loss_status = successor.wait_exit().await;
    assert!(!loss_status.success(), "lease loss must fail the process");
    assert!(!successor.is_ready().await, "lost owner remained ready");
    let loss_error = successor.stderr();
    assert!(loss_error.contains("jobs.owner"), "{loss_error}");
    assert!(loss_error.contains("was lost"), "{loss_error}");
    assert!(matches!(
        leases
            .entry("jobs.owner")
            .await
            .expect("inspect lost Jobs lease")
            .map(|entry| entry.operation),
        None | Some(kv::Operation::Delete | kv::Operation::Purge)
    ));
    acquire_and_release(&leases, "jobs.owner").await;

    let held_health_revision = leases
        .create("health.owner", Bytes::from_static(b"fixture-holder"))
        .await
        .expect("pre-hold Health owner lease");
    let all_config = runtime.workdir().join("all-partial.toml");
    let mut all = RuntimeProcess::start(&runtime, "all", &all_config, "all-partial").await;
    let all_status = all.wait_exit().await;
    let all_error = all.stderr();
    assert!(!all_status.success());
    assert!(all_error.contains("health.owner"), "{all_error}");
    assert!(all_error.contains("already held"), "{all_error}");
    acquire_and_release(&leases, "platform.owner").await;
    acquire_and_release(&leases, "jobs.owner").await;
    leases
        .delete_expect_revision("health.owner", Some(held_health_revision))
        .await
        .expect("release fixture-held Health lease");

    let all_runtime_config = runtime.workdir().join("all-runtime.toml");
    let mut all_runtime =
        RuntimeProcess::start(&runtime, "all", &all_runtime_config, "all-runtime").await;
    all_runtime.wait_ready().await;
    assert_jobs_owner_consumers(&client).await;
    let (same_owner_revision, same_owner_value) =
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let jobs_entry = leases
                    .entry("jobs.owner")
                    .await
                    .expect("inspect all-mode Jobs lease")
                    .expect("all-mode Jobs lease exists");
                match leases
                    .update("jobs.owner", jobs_entry.value.clone(), jobs_entry.revision)
                    .await
                {
                    Ok(revision) => break (revision, jobs_entry.value),
                    Err(error) if error.kind() == kv::UpdateErrorKind::WrongLastRevision => {}
                    Err(error) => panic!("advance all-mode Jobs lease revision: {error}"),
                }
            }
        })
        .await
        .expect("advance all-mode Jobs lease revision before timeout");
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            assert!(
                all_runtime.is_ready().await,
                "all-mode runtime rejected its own current lease revision: {}",
                all_runtime.stderr()
            );
            let jobs_entry = leases
                .entry("jobs.owner")
                .await
                .expect("inspect reconciled all-mode Jobs lease")
                .expect("reconciled all-mode Jobs lease exists");
            if jobs_entry.value == same_owner_value && jobs_entry.revision > same_owner_revision {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("runtime renews after adopting its current lease revision");
    let manipulated_revision = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let jobs_entry = leases
                .entry("jobs.owner")
                .await
                .expect("inspect all-mode Jobs lease")
                .expect("all-mode Jobs lease exists");
            match leases
                .update(
                    "jobs.owner",
                    Bytes::from_static(b"fixture-takeover"),
                    jobs_entry.revision,
                )
                .await
            {
                Ok(revision) => break revision,
                Err(error) if error.kind() == kv::UpdateErrorKind::WrongLastRevision => {}
                Err(error) => panic!("make all-mode Jobs lease guard stale: {error}"),
            }
        }
    })
    .await
    .expect("make all-mode Jobs lease guard stale before timeout");

    let mut fixture_owned = vec![("jobs.owner", manipulated_revision)];
    for key in ["platform.owner", "health.owner", "eventlog.owner"] {
        fixture_owned.push((key, wait_to_acquire(&leases, key).await));
    }

    let all_loss_status = all_runtime.wait_exit().await;
    assert!(
        !all_loss_status.success(),
        "one all-mode lease loss must fail the process"
    );
    assert!(
        !all_runtime.is_ready().await,
        "all-mode runtime retained readiness after one owner loss"
    );
    let all_loss_error = all_runtime.stderr();
    assert!(all_loss_error.contains("jobs.owner"), "{all_loss_error}");
    assert!(all_loss_error.contains("was lost"), "{all_loss_error}");
    let manipulated = leases
        .entry("jobs.owner")
        .await
        .expect("inspect manipulated Jobs lease")
        .expect("fixture-owned Jobs lease remains");
    assert_eq!(manipulated.revision, manipulated_revision);
    assert_eq!(manipulated.value, Bytes::from_static(b"fixture-takeover"));
    for (key, revision) in fixture_owned {
        leases
            .delete_expect_revision(key, Some(revision))
            .await
            .unwrap_or_else(|error| panic!("release fixture-owned lease {key}: {error}"));
    }
}

#[tokio::test]
async fn runtime_incompatible_lease_bucket_fails_before_storage_open() {
    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let client = ConnectOptions::new()
        .credentials_file(runtime.workdir().join("nats/creds/trellis-auth.creds"))
        .await
        .expect("load Trellis NATS credentials")
        .connect(runtime.nats_url())
        .await
        .expect("connect authenticated lease test client");
    runtime
        .stop_control_plane()
        .expect("stop default platform owner");
    jetstream::new(client.clone())
        .delete_key_value(LEASE_BUCKET)
        .await
        .expect("remove default platform lease bucket");
    jetstream::new(client)
        .create_key_value(kv::Config {
            bucket: LEASE_BUCKET.to_owned(),
            history: 1,
            max_age: Duration::from_secs(1),
            num_replicas: 1,
            ..Default::default()
        })
        .await
        .expect("precreate incompatible lease bucket");

    let blocked_storage = runtime.workdir().join("incompatible-jobs.sqlite");
    std::fs::create_dir(&blocked_storage).expect("create path that SQLite cannot open as a file");
    let config = runtime.workdir().join("incompatible.toml");
    let mut process = RuntimeProcess::start(&runtime, "jobs", &config, "incompatible").await;
    let status = process.wait_exit().await;
    let error = process.stderr();

    assert!(!status.success());
    assert!(error.contains("incompatible"), "{error}");
    assert!(error.contains("max_age"), "{error}");
    assert!(!error.contains("runtime storage failed"), "{error}");
    assert!(blocked_storage.is_dir());
}

#[tokio::test]
async fn runtime_check_is_mode_scoped_and_read_only() {
    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    runtime
        .stop_control_plane()
        .expect("stop default platform owner");
    let client = ConnectOptions::new()
        .credentials_file(runtime.workdir().join("nats/creds/trellis-auth.creds"))
        .await
        .expect("load Trellis NATS credentials")
        .connect(runtime.nats_url())
        .await
        .expect("connect mode check client");
    let jetstream = jetstream::new(client);
    jetstream
        .delete_key_value(LEASE_BUCKET)
        .await
        .expect("remove fixture lease bucket");
    let config_path = runtime.workdir().join("mode-check.toml");
    let mut all = RuntimeProcess::start(&runtime, "all", &config_path, "mode-check-all").await;
    all.wait_ready().await;
    assert!(all.terminate().await.success());

    for stream in ["JOBS", "JOBS_WORK", "JOBS_ADVISORIES"] {
        jetstream
            .delete_stream(stream)
            .await
            .unwrap_or_else(|error| panic!("delete {stream}: {error}"));
    }
    for mode in ["platform", "health", "eventlog"] {
        let output = runtime_command(mode, &config_path, true)
            .output()
            .unwrap_or_else(|error| panic!("run {mode} check: {error}"));
        assert!(
            output.status.success(),
            "{mode} check failed without Jobs streams: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert!(jetstream.get_stream("JOBS").await.is_err());

    let failed_jobs = runtime_command("jobs", &config_path, true)
        .output()
        .expect("run missing Jobs check");
    assert!(!failed_jobs.status.success());
    assert!(jetstream.get_stream("JOBS").await.is_err());

    let jobs_config = runtime.workdir().join("mode-check-jobs.toml");
    let mut jobs = RuntimeProcess::start(&runtime, "jobs", &jobs_config, "mode-check-jobs").await;
    jobs.wait_ready().await;
    assert!(jobs.terminate().await.success());
    for bucket in [
        "trellis_authorization_trust",
        "trellis_authorization_contexts",
    ] {
        jetstream
            .delete_key_value(bucket)
            .await
            .unwrap_or_else(|error| panic!("delete {bucket}: {error}"));
    }
    let jobs_without_auth = runtime_command("jobs", &config_path, true)
        .output()
        .expect("run Jobs check without Auth registries");
    assert!(
        jobs_without_auth.status.success(),
        "Jobs check required Platform Auth: {}",
        String::from_utf8_lossy(&jobs_without_auth.stderr)
    );

    let platform_config = runtime.workdir().join("mode-check-platform.toml");
    let mut platform = RuntimeProcess::start(
        &runtime,
        "platform",
        &platform_config,
        "mode-check-platform",
    )
    .await;
    platform.wait_ready().await;
    assert!(platform.terminate().await.success());
    jetstream
        .delete_stream("JOBS_WORK")
        .await
        .expect("delete union Jobs work stream");
    let all_missing_union = runtime_command("all", &config_path, true)
        .output()
        .expect("run incomplete all-mode check");
    assert!(!all_missing_union.status.success());
    assert!(jetstream.get_stream("JOBS_WORK").await.is_err());

    runtime.stop().expect("stop mode check runtime");
}

async fn acquire_and_release(leases: &kv::Store, key: &str) {
    let revision = leases
        .create(key, Bytes::from_static(b"fixture-probe"))
        .await
        .unwrap_or_else(|error| panic!("acquire released lease {key}: {error}"));
    leases
        .delete_expect_revision(key, Some(revision))
        .await
        .unwrap_or_else(|error| panic!("release probed lease {key}: {error}"));
}

async fn assert_jobs_owner_consumers(client: &async_nats::Client) {
    let jobs = jetstream::new(client.clone())
        .get_stream("JOBS")
        .await
        .expect("open built-in Jobs stream");
    let mut consumers = jobs.consumers();
    let mut names = Vec::new();
    while let Some(info) = consumers.next().await {
        names.push(info.expect("inspect built-in Jobs consumer").name);
    }
    assert!(
        names.iter().any(|name| name.starts_with("jobs-projector-")),
        "Jobs projector did not start: {names:?}"
    );
    assert!(
        names
            .iter()
            .any(|name| name == "jobs-worker-presence-projector"),
        "Jobs worker-presence projector did not start: {names:?}"
    );
    let advisories = jetstream::new(client.clone())
        .get_stream("JOBS_ADVISORIES")
        .await
        .expect("open built-in Jobs advisories stream");
    advisories
        .consumer_info("jobs-advisories")
        .await
        .expect("Jobs advisory loop did not start");
}

async fn wait_to_acquire(leases: &kv::Store, key: &str) -> u64 {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        match leases
            .create(key, Bytes::from_static(b"fixture-takeover"))
            .await
        {
            Ok(revision) => return revision,
            Err(error) => {
                assert!(
                    tokio::time::Instant::now() < deadline,
                    "could not acquire owner lease {key} after forced ownership loss: {error}"
                );
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        }
    }
}

fn write_runtime_config(
    runtime: &trellis_test::TrellisTestRuntime,
    mode: &str,
    path: &Path,
    label: &str,
    port: u16,
) {
    let nats_dir = runtime.workdir().join("nats/creds");
    let session_seed = runtime
        .workdir()
        .join(&runtime.manifest().paths.session_seed);
    let event_context_digest = runtime
        .workdir()
        .join(format!("{label}-event-context.digest"));
    let jobs_path = if label == "jobs-duplicate" {
        runtime.workdir().join("blocked-jobs.sqlite")
    } else {
        runtime.workdir().join(format!("{label}-jobs.sqlite"))
    };
    let mut config = format!(
        r#"instance_name = "{label}"
event_session_seed_file = "{}"
event_context_digest_file = "{}"

[http]
port = {port}

[nats]
servers = "{}"

[nats.runtime]
auth_creds_path = "{}"
trellis_creds_path = "{}"
system_creds_path = "{}"

[leases]
bucket = "{LEASE_BUCKET}"
replicas = 1
ttl_ms = 3000
renew_ms = 500
"#,
        toml_path(&session_seed),
        toml_path(&event_context_digest),
        runtime.nats_url(),
        toml_path(&nats_dir.join("auth-auth.creds")),
        toml_path(&nats_dir.join("trellis-auth.creds")),
        toml_path(&nats_dir.join("system.creds")),
    );
    if matches!(mode, "jobs" | "all") {
        config.push_str(&format!(
            r#"
[jobs.storage]
kind = "sqlite"
path = "{}"
"#,
            toml_path(&jobs_path)
        ));
    }
    let auth_dir = runtime.workdir().join("trellis/auth");
    config.push_str(&format!(
        r#"
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
        toml_path(&auth_dir.join("authorization-root.json")),
        toml_path(&auth_dir.join("authorization-issuer-manifest.json")),
        toml_path(&auth_dir.join("authorization-issuer.seed")),
    ));
    if matches!(mode, "platform" | "all") {
        config.push_str(&format!(
            r#"
[nats.auth_callout]
issuer_signing_seed_file = "{}"
target_signing_seed_file = "{}"
xkey_seed_file = "{}"

[platform.storage]
kind = "sqlite"
path = "{}"
"#,
            toml_path(
                &runtime
                    .workdir()
                    .join("nats/secrets/auth-issuer-signing.seed")
            ),
            toml_path(
                &runtime
                    .workdir()
                    .join("nats/secrets/auth-target-signing.seed")
            ),
            toml_path(&runtime.workdir().join("nats/secrets/auth-sx.seed")),
            toml_path(&runtime.workdir().join(format!("{label}-platform.sqlite"))),
        ));
    }
    if matches!(mode, "health" | "all") {
        config.push_str(&format!(
            r#"
[health.storage]
kind = "sqlite"
path = "{}"
"#,
            toml_path(&runtime.workdir().join(format!("{label}-health.sqlite")))
        ));
    }
    if matches!(mode, "eventlog" | "all") {
        config.push_str(&format!(
            r#"
[eventlog.storage]
kind = "sqlite"
path = "{}"
"#,
            toml_path(&runtime.workdir().join(format!("{label}-eventlog.sqlite")))
        ));
    }
    std::fs::write(path, config).expect("write Rust runtime config");
}

fn runtime_command(mode: &str, config_path: &Path, check: bool) -> Command {
    trellis_test::record_test_process_start("trellis", mode)
        .expect("record Rust runtime process start");
    let rust_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("trellis-rs crate should live under rust/crates/trellis");
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
            "trellis-server",
            "--bin",
            "trellis-server",
            "--",
        ]);
        command
    };
    if check {
        command.args([
            "check",
            "--config",
            config_path.to_str().expect("UTF-8 runtime config path"),
            mode,
        ]);
    } else {
        command.args([
            "--config",
            config_path.to_str().expect("UTF-8 runtime config path"),
            mode,
        ]);
    }
    command.current_dir(rust_dir).stdin(Stdio::null());
    command
}

fn toml_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "\\\\")
}
