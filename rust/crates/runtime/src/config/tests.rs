use std::fs;
use std::path::PathBuf;

use tempfile::tempdir;

use super::{ConfigError, RuntimeConfig, SqliteStorageConfig, StorageBackend};
use crate::RuntimeMode;

const COMPLETE_CONFIG: &str = r#"
instance_name = "Trellis"

[http]
port = 39123

[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[nats.auth_callout]
issuer_signing_seed_file = "./nats/auth-issuer-signing.seed"
target_signing_seed_file = "./nats/trellis-target-signing.seed"
xkey_seed_file = "./nats/auth-callout-xkey.seed"

[platform.storage]
kind = "sqlite"
path = "./data/platform.sqlite"
journal_mode = "wal"
busy_timeout_ms = 5000
single_writer = true

[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"

[health.storage]
kind = "sqlite"
path = "./data/health.sqlite"

[eventlog.storage]
kind = "sqlite"
path = "./data/eventlog.sqlite"

[leases]
replicas = 1
"#;

#[test]
fn loads_toml_config_from_path() {
    let directory = tempdir().expect("create temp directory");
    let path = directory.path().join("config.toml");
    fs::write(&path, COMPLETE_CONFIG).expect("write config");

    let config = RuntimeConfig::load_from_path(&path).expect("load config");

    assert_eq!(config.instance_name.as_deref(), Some("Trellis"));
    assert_eq!(config.http_port(), 39123);
    assert_eq!(
        config
            .platform
            .as_ref()
            .and_then(|platform| platform.storage.as_ref())
            .map(|storage| storage.kind.as_str()),
        Some("sqlite")
    );
    assert_eq!(
        config.platform_storage_backend().expect("platform storage"),
        StorageBackend::Sqlite(SqliteStorageConfig {
            path: directory.path().join("./data/platform.sqlite"),
            journal_mode: Some("wal".to_owned()),
            busy_timeout_ms: Some(5000),
            single_writer: Some(true),
        })
    );
}

#[test]
fn parses_plan_shaped_toml_config() {
    let config = RuntimeConfig::from_toml_str(
        r#"
instance_name = "Trellis"

[http]
port = 3000
public_origin = "http://localhost:3000"
origins = ["http://localhost:3000"]
allow_insecure_origins = ["http://localhost:3000"]
rate_limit_max = 60
rate_limit_window_ms = 60000

[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[nats.auth_callout]
issuer_signing_seed_file = "./nats/auth-issuer-signing.seed"
target_signing_seed_file = "./nats/trellis-target-signing.seed"
xkey_seed_file = "./nats/auth-callout-xkey.seed"

[client]
ws_nats_servers = ["ws://localhost:8080"]
nats_servers = ["nats://127.0.0.1:4222"]

[platform.storage]
kind = "sqlite"
path = "./data/platform.sqlite"
journal_mode = "wal"
busy_timeout_ms = 5000
single_writer = true

[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"

[health]
history_retention_days = 30

[health.storage]
kind = "sqlite"
path = "./data/health.sqlite"

[eventlog]
retention_days = 7

[eventlog.storage]
kind = "sqlite"
path = "./data/eventlog.sqlite"

[leases]
bucket = "trellis_runtime_leases"
replicas = 1
ttl_ms = 15000
renew_ms = 5000

[auth.local_identity]
enabled = true
password_min_length = 8

[oauth]
redirect_base = "http://localhost:3000/auth/callback"
always_show_provider_chooser = false

[oauth.providers.google]
type = "oidc"
issuer = "https://accounts.google.com"
client_id = "client-id"
client_secret_file = "./secrets/google-client-secret"
display_name = "Google"
scopes = ["openid", "profile", "email"]

[platform.ttl_ms]
sessions = 86400000
oauth = 300000
device_flow = 1800000
pending_auth = 300000
connections = 7200000
nats_jwt = 3600000
"#,
    )
    .expect("parse config");

    config
        .validate_for_mode(RuntimeMode::All)
        .expect("valid config");
    assert_eq!(
        config
            .health
            .as_ref()
            .and_then(|health| health.history_retention_days),
        Some(30)
    );
    assert_eq!(
        config
            .eventlog
            .as_ref()
            .and_then(|eventlog| eventlog.retention_days),
        Some(7)
    );
    assert_eq!(
        config.leases.as_ref().and_then(|leases| leases.ttl_ms),
        Some(15000)
    );
    assert_eq!(
        config.leases.as_ref().and_then(|leases| leases.replicas),
        Some(1)
    );
    assert_eq!(
        config
            .oauth
            .as_ref()
            .and_then(|oauth| oauth.providers.get("google"))
            .and_then(|google| google.client_secret_file.as_ref()),
        Some(&PathBuf::from("./secrets/google-client-secret"))
    );
}

#[test]
fn resolves_required_runtime_sections_and_lease_defaults() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[nats.auth_callout]
issuer_signing_seed_file = "./nats/auth-issuer-signing.seed"
target_signing_seed_file = "./nats/trellis-target-signing.seed"
xkey_seed_file = "./nats/auth-callout-xkey.seed"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    let nats = config.resolve_nats_runtime().expect("resolve nats");
    assert_eq!(nats.servers, "nats://127.0.0.1:4222");
    assert_eq!(
        nats.auth_creds_path,
        PathBuf::from("./nats/auth-runtime.creds")
    );
    assert_eq!(
        nats.sentinel_creds_path,
        PathBuf::from("./nats/sentinel.creds")
    );

    let auth_callout = config
        .resolve_nats_auth_callout()
        .expect("resolve auth callout");
    assert_eq!(
        auth_callout.xkey_seed_file,
        PathBuf::from("./nats/auth-callout-xkey.seed")
    );

    let leases = config.resolve_leases().expect("resolve leases");
    assert_eq!(leases.bucket, "trellis_runtime_leases");
    assert_eq!(leases.replicas, 1);
    assert_eq!(leases.ttl_ms, 15_000);
    assert_eq!(leases.renew_ms, 5_000);
}

#[test]
fn resolves_relative_paths_against_config_directory() {
    let directory = tempdir().expect("create temp directory");
    let path = directory.path().join("trellis.toml");
    fs::write(
        &path,
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth.creds"

[oauth.providers.google]
type = "oidc"
client_secret_file = "./secrets/google"

[platform.storage]
kind = "sqlite"
path = "./data/platform.sqlite"
"#,
    )
    .expect("write config");

    let config = RuntimeConfig::load_from_path(&path).expect("load config");

    assert_eq!(
        config.platform_storage_backend().expect("storage"),
        StorageBackend::Sqlite(SqliteStorageConfig {
            path: directory.path().join("./data/platform.sqlite"),
            journal_mode: None,
            busy_timeout_ms: None,
            single_writer: None,
        })
    );
    assert_eq!(
        config
            .nats
            .as_ref()
            .and_then(|nats| nats.runtime.as_ref())
            .and_then(|runtime| runtime.auth_creds_path.as_ref()),
        Some(&directory.path().join("./nats/auth.creds"))
    );
    assert_eq!(
        config
            .oauth
            .as_ref()
            .and_then(|oauth| oauth.providers.get("google"))
            .and_then(|google| google.client_secret_file.as_ref()),
        Some(&directory.path().join("./secrets/google"))
    );
}

#[test]
fn uses_default_http_port_when_missing() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    assert_eq!(config.http_port(), 3000);
}

#[test]
fn rejects_non_toml_config_path() {
    let directory = tempdir().expect("create temp directory");
    let path = directory.path().join("config.jsonc");
    fs::write(&path, "{}").expect("write config");

    let error = RuntimeConfig::load_from_path(&path).expect_err("reject config");

    assert!(matches!(error, ConfigError::UnsupportedFormat { .. }));
}

#[test]
fn validates_selected_mode_storage_only() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[nats.auth_callout]
issuer_signing_seed_file = "./nats/auth-issuer-signing.seed"
target_signing_seed_file = "./nats/trellis-target-signing.seed"
xkey_seed_file = "./nats/auth-callout-xkey.seed"

[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    config
        .validate_for_mode(RuntimeMode::Jobs)
        .expect("jobs config is valid");
    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Platform),
        Err(ConfigError::MissingSection {
            section: "platform"
        })
    ));
}

#[test]
fn all_mode_requires_every_subsystem_storage() {
    let config = RuntimeConfig::from_toml_str(COMPLETE_CONFIG).expect("parse config");

    config
        .validate_for_mode(RuntimeMode::All)
        .expect("all config is valid");

    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[nats.auth_callout]
issuer_signing_seed_file = "./nats/auth-issuer-signing.seed"
target_signing_seed_file = "./nats/trellis-target-signing.seed"
xkey_seed_file = "./nats/auth-callout-xkey.seed"

[platform.storage]
kind = "sqlite"
path = "./data/platform.sqlite"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::All),
        Err(ConfigError::MissingSection { section: "jobs" })
    ));
}

#[test]
fn rejects_postgres_until_backend_is_implemented() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[eventlog.storage]
kind = "postgres"
url = "postgres://trellis-eventlog@localhost/trellis_eventlog"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Eventlog),
        Err(ConfigError::UnsupportedStorageBackend {
            section: "eventlog.storage",
            backend: "postgres"
        })
    ));
}

#[test]
fn rejects_invalid_storage_fields() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[health.storage]
kind = ""
path = "./data/health.sqlite"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Health),
        Err(ConfigError::InvalidStorage {
            section: "health.storage",
            reason: "kind must not be empty"
        })
    ));

    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[health.storage]
kind = "postgres"
path = "./data/health.sqlite"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Health),
        Err(ConfigError::UnsupportedStorageBackend {
            section: "health.storage",
            backend: "postgres"
        })
    ));
}

#[test]
fn rejects_missing_nats_runtime_paths() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Jobs),
        Err(ConfigError::InvalidNatsConfig {
            section: "nats.runtime",
            field: "trellis_creds_path",
            reason: "must not be missing or empty"
        })
    ));
}

#[test]
fn platform_modes_require_auth_callout_seed_paths() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[nats.auth_callout]
issuer_signing_seed_file = "./nats/auth-issuer-signing.seed"
target_signing_seed_file = "./nats/trellis-target-signing.seed"

[platform.storage]
kind = "sqlite"
path = "./data/platform.sqlite"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Platform),
        Err(ConfigError::InvalidNatsConfig {
            section: "nats.auth_callout",
            field: "xkey_seed_file",
            reason: "must not be missing or empty"
        })
    ));
}

#[test]
fn non_platform_split_modes_do_not_require_auth_callout_seed_paths() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[health.storage]
kind = "sqlite"
path = "./data/health.sqlite"

[leases]
replicas = 1
"#,
    )
    .expect("parse config");

    config
        .validate_for_mode(RuntimeMode::Health)
        .expect("health config is valid");
}

#[test]
fn all_modes_require_nats_servers() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Jobs),
        Err(ConfigError::InvalidNatsConfig {
            section: "nats",
            field: "servers",
            reason: "must not be missing or empty"
        })
    ));
}

#[test]
fn runtime_modes_require_leases_section_and_replicas_field() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Jobs),
        Err(ConfigError::MissingSection { section: "leases" })
    ));

    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"

[leases]
bucket = "trellis_runtime_leases"
"#,
    )
    .expect("parse config");

    assert!(matches!(
        config.validate_for_mode(RuntimeMode::Jobs),
        Err(ConfigError::InvalidLeasesConfig {
            section: "leases",
            field: "replicas",
            reason: "must be configured explicitly"
        })
    ));
}

#[test]
fn lease_replica_validation_requires_presence_only() {
    let config = RuntimeConfig::from_toml_str(
        r#"
[nats]
servers = "nats://127.0.0.1:4222"

[nats.runtime]
auth_creds_path = "./nats/auth-runtime.creds"
trellis_creds_path = "./nats/trellis-runtime.creds"
system_creds_path = "./nats/system-runtime.creds"
sentinel_creds_path = "./nats/sentinel.creds"

[jobs.storage]
kind = "sqlite"
path = "./data/jobs.sqlite"

[leases]
replicas = 0
"#,
    )
    .expect("parse config");

    config
        .validate_for_mode(RuntimeMode::Jobs)
        .expect("replica acceptability is delegated to NATS");
}
