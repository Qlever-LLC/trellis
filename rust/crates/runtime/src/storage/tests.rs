use super::*;

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
use crate::{RuntimeConfig, RuntimeMode};

fn sqlite_config(path: PathBuf) -> SqliteStorageConfig {
    SqliteStorageConfig {
        path,
        journal_mode: Some("wal".to_owned()),
        busy_timeout_ms: Some(2_500),
        single_writer: Some(true),
    }
}

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
fn subsystem_config(path: PathBuf) -> crate::SubsystemConfig {
    crate::SubsystemConfig {
        storage: Some(crate::StorageConfig {
            kind: "sqlite".to_owned(),
            path: Some(path),
            url: None,
            journal_mode: Some("wal".to_owned()),
            busy_timeout_ms: Some(2_500),
            single_writer: Some(true),
        }),
        history_retention_days: None,
        retention_days: None,
        ttl_ms: None,
    }
}

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
fn invalid_postgres_subsystem_config() -> crate::SubsystemConfig {
    crate::SubsystemConfig {
        storage: Some(crate::StorageConfig {
            kind: "postgres".to_owned(),
            path: None,
            url: Some("postgres://trellis@localhost/trellis".to_owned()),
            journal_mode: None,
            busy_timeout_ms: None,
            single_writer: None,
        }),
        history_retention_days: None,
        retention_days: None,
        ttl_ms: None,
    }
}

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
fn runtime_config() -> RuntimeConfig {
    RuntimeConfig {
        instance_name: None,
        http: None,
        nats: Some(crate::NatsConfig {
            servers: Some("nats://127.0.0.1:4222".to_owned()),
            runtime: Some(crate::NatsRuntimeConfig {
                auth_creds_path: Some(PathBuf::from("auth.creds")),
                trellis_creds_path: Some(PathBuf::from("trellis.creds")),
                system_creds_path: Some(PathBuf::from("system.creds")),
                sentinel_creds_path: Some(PathBuf::from("sentinel.creds")),
            }),
            auth_callout: Some(crate::NatsAuthCalloutConfig {
                issuer_signing_seed_file: Some(PathBuf::from("issuer.seed")),
                target_signing_seed_file: Some(PathBuf::from("target.seed")),
                xkey_seed_file: Some(PathBuf::from("xkey.seed")),
            }),
        }),
        client: None,
        leases: Some(crate::LeasesConfig {
            bucket: None,
            replicas: Some(1),
            ttl_ms: None,
            renew_ms: None,
        }),
        auth: None,
        oauth: None,
        platform: None,
        jobs: None,
        health: None,
        eventlog: None,
    }
}

fn assert_marker(path: &Path, table_name: &str) -> rusqlite::Result<()> {
    let connection = Connection::open(path)?;
    let exists: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table_name],
        |row| row.get(0),
    )?;
    assert_eq!(exists, 1);

    let marker_count: i64 =
        connection.query_row(&format!("SELECT COUNT(*) FROM {table_name}"), [], |row| {
            row.get(0)
        })?;
    assert_eq!(marker_count, 1);

    Ok(())
}

fn assert_migration(path: &Path, version: i32, name: &str) -> rusqlite::Result<()> {
    let connection = Connection::open(path)?;
    let migration_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM refinery_schema_history WHERE version = ?1 AND name = ?2",
        rusqlite::params![version, name],
        |row| row.get(0),
    )?;
    assert_eq!(migration_count, 1);
    Ok(())
}

fn assert_migration_order(path: &Path, expected_versions: &[i32]) -> rusqlite::Result<()> {
    let connection = Connection::open(path)?;
    let mut statement =
        connection.prepare("SELECT version FROM refinery_schema_history ORDER BY rowid")?;
    let versions = statement
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<i32>>>()?;
    assert_eq!(versions, expected_versions);
    Ok(())
}

#[test]
fn sqlite_platform_store_migrates_marker_schema() -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("platform.sqlite");
    let store = SqliteStore::new(SubsystemName::Platform, sqlite_config(path.clone()));

    store.migrate()?;

    assert!(path.exists());
    assert_marker(&path, "trellis_platform_store_marker")?;
    assert_migration(&path, 1000, "platform_init")?;
    Ok(())
}

#[test]
fn sqlite_jobs_projection_store_migrates_marker_schema() -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("jobs.sqlite");
    let store = SqliteStore::new(SubsystemName::Jobs, sqlite_config(path.clone()));

    store.migrate()?;

    assert!(path.exists());
    assert_marker(&path, "trellis_jobs_projection_store_marker")?;
    assert_migration(&path, 2000, "jobs_projection_init")?;
    Ok(())
}

#[test]
fn sqlite_health_projection_store_creates_parent_directory_and_migrates(
) -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("nested").join("health.sqlite");
    let store = SqliteStore::new(SubsystemName::Health, sqlite_config(path.clone()));

    store.migrate()?;

    assert!(path.exists());
    assert_marker(&path, "trellis_health_projection_store_marker")?;
    assert_migration(&path, 3000, "health_projection_init")?;
    Ok(())
}

#[test]
fn sqlite_eventlog_store_migrates_marker_schema() -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("eventlog.sqlite");
    let store = SqliteStore::new(SubsystemName::Eventlog, sqlite_config(path.clone()));

    store.migrate()?;

    assert!(path.exists());
    assert_marker(&path, "trellis_eventlog_store_marker")?;
    assert_migration(&path, 4000, "eventlog_init")?;
    Ok(())
}

#[test]
fn sqlite_subsystem_migrations_can_share_one_database() -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("shared.sqlite");

    SqliteStore::new(SubsystemName::Platform, sqlite_config(path.clone())).migrate()?;
    SqliteStore::new(SubsystemName::Jobs, sqlite_config(path.clone())).migrate()?;
    SqliteStore::new(SubsystemName::Health, sqlite_config(path.clone())).migrate()?;
    SqliteStore::new(SubsystemName::Eventlog, sqlite_config(path.clone())).migrate()?;

    assert_marker(&path, "trellis_platform_store_marker")?;
    assert_marker(&path, "trellis_jobs_projection_store_marker")?;
    assert_marker(&path, "trellis_health_projection_store_marker")?;
    assert_marker(&path, "trellis_eventlog_store_marker")?;
    assert_migration(&path, 1000, "platform_init")?;
    assert_migration(&path, 2000, "jobs_projection_init")?;
    assert_migration(&path, 3000, "health_projection_init")?;
    assert_migration(&path, 4000, "eventlog_init")?;
    Ok(())
}

#[test]
#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
fn runtime_stores_all_mode_migrates_all_selected_subsystems(
) -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("runtime.sqlite");
    let mut config = runtime_config();
    config.platform = Some(subsystem_config(path.clone()));
    config.jobs = Some(subsystem_config(path.clone()));
    config.health = Some(subsystem_config(path.clone()));
    config.eventlog = Some(subsystem_config(path.clone()));

    config.validate_for_mode(RuntimeMode::All)?;
    let stores = RuntimeStores::from_config(&config, RuntimeMode::All)?;
    stores.migrate_all()?;

    assert!(stores.platform.is_some());
    assert!(stores.jobs.is_some());
    assert!(stores.health.is_some());
    assert!(stores.eventlog.is_some());
    assert_marker(&path, "trellis_platform_store_marker")?;
    assert_marker(&path, "trellis_jobs_projection_store_marker")?;
    assert_marker(&path, "trellis_health_projection_store_marker")?;
    assert_marker(&path, "trellis_eventlog_store_marker")?;
    assert_migration_order(&path, &[1000, 2000, 3000, 4000])?;
    Ok(())
}

#[test]
#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
fn runtime_stores_split_mode_ignores_unselected_storage() -> Result<(), Box<dyn std::error::Error>>
{
    let temp_dir = tempfile::tempdir()?;
    let jobs_path = temp_dir.path().join("jobs.sqlite");
    let mut config = runtime_config();
    config.platform = Some(invalid_postgres_subsystem_config());
    config.jobs = Some(subsystem_config(jobs_path.clone()));

    config.validate_for_mode(RuntimeMode::Jobs)?;
    let stores = RuntimeStores::from_config(&config, RuntimeMode::Jobs)?;
    stores.migrate_all()?;

    assert!(stores.platform.is_none());
    assert!(stores.jobs.is_some());
    assert!(stores.health.is_none());
    assert!(stores.eventlog.is_none());
    assert_marker(&jobs_path, "trellis_jobs_projection_store_marker")?;
    assert_migration(&jobs_path, 2000, "jobs_projection_init")?;
    Ok(())
}

#[test]
fn open_sqlite_applies_configured_pragmas() -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("pragmas.sqlite");
    let config = sqlite_config(path);

    let connection = open_sqlite(&config)?;

    let busy_timeout: u64 = connection.query_row("PRAGMA busy_timeout", [], |row| row.get(0))?;
    let journal_mode: String = connection.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
    assert_eq!(busy_timeout, 2_500);
    assert_eq!(journal_mode.to_lowercase(), "wal");
    Ok(())
}
