use super::*;
use sha2::Digest as _;

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
        transport_retention_hours: None,
        transport_max_bytes: None,
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
        transport_retention_hours: None,
        transport_max_bytes: None,
        retention_days: None,
        ttl_ms: None,
    }
}

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
fn runtime_config() -> RuntimeConfig {
    RuntimeConfig {
        instance_name: None,
        event_session_seed_file: Some(PathBuf::from("session.seed")),
        event_context_digest_file: None,
        paths: None,
        http: None,
        nats: Some(crate::NatsConfig {
            servers: Some("nats://127.0.0.1:4222".to_owned()),
            runtime: Some(crate::NatsRuntimeConfig {
                auth_creds_path: Some(PathBuf::from("auth.creds")),
                trellis_creds_path: Some(PathBuf::from("trellis.creds")),
                system_creds_path: Some(PathBuf::from("system.creds")),
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
        auth: Some(crate::AuthConfig {
            local_identity: None,
            authorization: Some(crate::AuthorizationConfig {
                trust_root_file: PathBuf::from("authorization-root.json"),
                issuer_manifest_file: PathBuf::from("authorization-issuer-manifest.json"),
                issuer_signing_seed_file: PathBuf::from("authorization-issuer.seed"),
                context_lifetime_seconds: 300,
                refresh_lead_seconds: 60,
                refresh_jitter_seconds: 15,
                minimum_context_lifetime_seconds: 76,
                maximum_bootstrap_jwt_lifetime_seconds: 3_600,
                cleanup_grace_seconds: 60,
                allowed_clock_skew_seconds: 30,
                maximum_context_bytes: 16_384,
                maximum_permissions: 4_096,
                maximum_capabilities: 256,
                trust_bucket: "trellis_authorization_trust".to_owned(),
                context_bucket: "trellis_authorization_contexts".to_owned(),
                registry_replicas: 1,
            }),
        }),
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

fn assert_table(path: &Path, table_name: &str) -> rusqlite::Result<()> {
    let connection = rusqlite::Connection::open(path)?;
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table_name],
        |row| row.get(0),
    )?;
    assert_eq!(count, 1, "missing table {table_name}");
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
    assert_migration(&path, 1001, "authorization_state")?;
    assert_migration(&path, 1002, "auth_service_cutover")?;
    assert_migration(&path, 1003, "authorization_context_runtime")?;
    assert_migration(&path, 1004, "auth_console_policy")?;
    assert_migration(&path, 1005, "bootstrap_administrator")?;
    assert_table(&path, "auth_principals")?;
    assert_table(&path, "auth_sessions")?;
    assert_table(&path, "auth_materialized_authorities")?;
    assert_table(&path, "auth_authorization_trust_state")?;
    assert_table(&path, "auth_authorization_contexts")?;
    assert_table(&path, "auth_bootstrap_administrator")?;
    Ok(())
}

#[test]
fn sqlite_migration_check_rejects_missing_database_without_creating_it(
) -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("platform.sqlite");
    let store = SqliteStore::new(SubsystemName::Platform, sqlite_config(path.clone()));

    assert!(matches!(
        store.check_migrations(),
        Err(StoreError::MissingSqlite { .. })
    ));

    assert!(!path.exists());
    Ok(())
}

#[test]
fn sqlite_migration_check_does_not_modify_configured_database(
) -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("platform.sqlite");
    let store = SqliteStore::new(SubsystemName::Platform, sqlite_config(path.clone()));
    store.migrate()?;
    let before = std::fs::read(&path)?;
    let wal = path.with_file_name("platform.sqlite-wal");
    let shm = path.with_file_name("platform.sqlite-shm");
    let sidecars_before = (wal.exists(), shm.exists());

    store.check_migrations()?;

    assert_eq!(std::fs::read(&path)?, before);
    assert_eq!((wal.exists(), shm.exists()), sidecars_before);
    Ok(())
}

#[test]
fn sqlite_platform_store_upgrades_current_marker_schema_and_reruns_safely(
) -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("platform-upgrade.sqlite");
    let connection = rusqlite::Connection::open(&path)?;
    connection.execute_batch(include_str!("sqlite/platform/V1000__platform_init.sql"))?;
    drop(connection);

    let store = SqliteStore::new(SubsystemName::Platform, sqlite_config(path.clone()));
    store.migrate()?;
    store.migrate()?;

    assert_marker(&path, "trellis_platform_store_marker")?;
    assert_table(&path, "auth_provider_identities")?;
    assert_table(&path, "auth_materialized_dependencies")?;
    assert_table(&path, "auth_materialized_resource_bindings")?;
    Ok(())
}

#[tokio::test]
async fn sqlite_platform_store_upgrades_populated_accepted_m7_schema(
) -> Result<(), Box<dyn std::error::Error>> {
    use crate::platform::auth::{
        AuthorityEvidenceRepository, AuthorityRepository, SqliteAuthorizationStore,
    };

    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("platform-m7-upgrade.sqlite");
    let mut connection = rusqlite::Connection::open(&path)?;
    let accepted_m7_migrations = [
        refinery::Migration::unapplied(
            "V1000__platform_init.sql",
            include_str!("sqlite/platform/V1000__platform_init.sql"),
        )?,
        refinery::Migration::unapplied(
            "V1001__authorization_state.sql",
            include_str!("sqlite/platform/V1001__authorization_state.sql"),
        )?,
    ];
    refinery::Runner::new(&accepted_m7_migrations).run(&mut connection)?;
    connection.execute_batch(include_str!(
        "sqlite/platform/fixtures/accepted_m7_authorization_state.sql"
    ))?;
    drop(connection);

    let store = SqliteStore::new(SubsystemName::Platform, sqlite_config(path.clone()));
    store.migrate()?;
    store.migrate()?;

    assert_migration_order(&path, &[1000, 1001, 1002, 1003, 1004, 1005])?;
    let connection = rusqlite::Connection::open(&path)?;
    connection.pragma_update(None, "foreign_keys", true)?;
    let foreign_key_errors = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_map([], |_| Ok(()))?
        .collect::<rusqlite::Result<Vec<()>>>()?;
    assert!(foreign_key_errors.is_empty());
    for (table, expected) in [
        ("auth_sessions", 1_i64),
        ("auth_identity_authorities", 1),
        ("auth_deployment_authorities", 1),
        ("auth_instances", 1),
        ("auth_devices", 1),
        ("auth_device_delegations", 1),
        ("auth_dependency_evidence", 1),
        ("auth_resource_binding_evidence", 1),
        ("auth_materialized_authorities", 1),
        ("auth_materialized_dependencies", 1),
        ("auth_materialized_resource_bindings", 1),
        ("auth_transition_outbox", 1),
    ] {
        let count: i64 =
            connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })?;
        assert_eq!(count, expected, "row loss in {table}");
    }
    let instance_metadata: (i64, i64, i64) = connection.query_row(
        "SELECT created_at, updated_at, version FROM auth_instances WHERE instance_id = 'inst_m7'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    assert_eq!(instance_metadata, (0, 0, 1));
    let device_metadata: (String, i64, i64, i64) = connection.query_row(
        "SELECT state, created_at, updated_at, version FROM auth_devices WHERE principal_id = 'dev_m7'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    assert_eq!(device_metadata, ("active".to_owned(), 0, 0, 1));
    let expected_authority_id = "dau_v1_6:dep_m7participant-m7";
    for table in [
        "auth_deployment_authorities",
        "auth_dependency_evidence",
        "auth_resource_binding_evidence",
        "auth_materialized_authorities",
    ] {
        let predicate = if table == "auth_deployment_authorities" {
            ""
        } else {
            " WHERE authority_kind = 'deployment'"
        };
        let authority_id: String = connection.query_row(
            &format!("SELECT authority_id FROM {table}{predicate}"),
            [],
            |row| row.get(0),
        )?;
        assert_eq!(
            authority_id, expected_authority_id,
            "lineage drift in {table}"
        );
    }
    connection.execute(
        "UPDATE auth_devices SET state = 'pending' WHERE principal_id = 'dev_m7'",
        [],
    )?;
    assert!(connection
        .execute(
            "UPDATE auth_devices SET state = 'invalid' WHERE principal_id = 'dev_m7'",
            [],
        )
        .is_err());
    connection.execute(
        "UPDATE auth_devices SET state = 'active' WHERE principal_id = 'dev_m7'",
        [],
    )?;
    drop(connection);

    let repository = SqliteAuthorizationStore::open_path(&path)?;
    assert_eq!(
        repository
            .get_deployment_authority("dep_m7", "participant-m7")
            .await?
            .expect("accepted M7 deployment authority must survive")
            .authority_id,
        expected_authority_id,
    );
    let instance = repository
        .get_runtime_instance("inst_m7")
        .await?
        .expect("accepted M7 instance must survive");
    assert_eq!(instance.version, 1);
    Ok(())
}

#[test]
fn accepted_authorization_migrations_remain_byte_identical() {
    for (migration, expected) in [
        (
            include_bytes!("sqlite/platform/V1001__authorization_state.sql").as_slice(),
            "e816f31d1175c9afd4fa1a70727fea6724bf53751a08f9006788c9de27f97206",
        ),
        (
            include_bytes!("sqlite/platform/V1002__auth_service_cutover.sql").as_slice(),
            "2043bd42febd7029ca62765ab646336f65f2019ec7fa8089829bd2c673cb30f9",
        ),
    ] {
        let actual = sha2::Sha256::digest(migration)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(actual, expected);
    }
}

#[test]
fn sqlite_platform_store_upgrades_accepted_m8_and_preserves_post_commit_actions(
) -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let path = temp_dir.path().join("platform-m8-upgrade.sqlite");
    let mut connection = rusqlite::Connection::open(&path)?;
    let accepted_m8_migrations = [
        refinery::Migration::unapplied(
            "V1000__platform_init.sql",
            include_str!("sqlite/platform/V1000__platform_init.sql"),
        )?,
        refinery::Migration::unapplied(
            "V1001__authorization_state.sql",
            include_str!("sqlite/platform/V1001__authorization_state.sql"),
        )?,
        refinery::Migration::unapplied(
            "V1002__auth_service_cutover.sql",
            include_str!("sqlite/platform/V1002__auth_service_cutover.sql"),
        )?,
    ];
    refinery::Runner::new(&accepted_m8_migrations).run(&mut connection)?;
    connection.execute_batch(
        "INSERT INTO auth_principals (
             principal_id, kind, state, created_at, updated_at, version,
             disabled_at, revoked_at
         ) VALUES ('dev_cancelled', 'device', 'active', 1, 1, 1, NULL, NULL);
         INSERT INTO auth_deployments (
             deployment_id, participant_id, participant_kind, state, expires_at
         ) VALUES ('dep_cancelled', 'participant', 'device', 'active', NULL);
         INSERT INTO auth_instances (
             instance_id, deployment_id, principal_id, state,
             created_at, updated_at, version
         ) VALUES ('inst_cancelled', 'dep_cancelled', 'dev_cancelled', 'active', 1, 1, 1);
         INSERT INTO auth_devices (
             principal_id, deployment_id, state, created_at, updated_at, version
         ) VALUES ('dev_cancelled', 'dep_cancelled', 'pending', 1, 1, 1);
         INSERT INTO auth_device_activation_reviews (
             review_id, principal_id, deployment_id, instance_id, request_digest,
             payload_json, state, requested_at, decided_at, decided_by, reason, version
         ) VALUES (
             'review_cancelled', 'dev_cancelled', 'dep_cancelled', 'inst_cancelled',
             'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
             '{\"expiresAt\":2}', 'cancelled', 1, NULL, NULL, NULL, 1
         );",
    )?;
    for (id, kind) in [
        ("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "event"),
        ("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", "kick"),
    ] {
        connection.execute(
            "INSERT INTO auth_post_commit_actions (
                action_id, kind, payload_json, created_at, attempts, next_attempt_at,
                claimed_until, last_error
             ) VALUES (?1, ?2, '{}', 1, 2, 3, NULL, 'retry')",
            rusqlite::params![id, kind],
        )?;
    }
    drop(connection);

    let store = SqliteStore::new(SubsystemName::Platform, sqlite_config(path.clone()));
    store.migrate()?;
    store.migrate()?;

    assert_migration_order(&path, &[1000, 1001, 1002, 1003, 1004, 1005])?;
    let connection = Connection::open(&path)?;
    connection.pragma_update(None, "foreign_keys", true)?;
    let actions = connection
        .prepare(
            "SELECT action_id, kind, payload_json, created_at, attempts, next_attempt_at,
                    claimed_until, last_error
             FROM auth_post_commit_actions ORDER BY action_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    assert_eq!(actions.len(), 2);
    assert_eq!(actions[0].1, "event");
    assert_eq!(actions[1].1, "kick");
    assert!(actions
        .iter()
        .all(|action| action.2 == "{}" && action.3 == 1 && action.4 == 2 && action.5 == 3));
    assert_eq!(
        connection.query_row(
            "SELECT state FROM auth_device_activation_reviews WHERE review_id = 'review_cancelled'",
            [],
            |row| row.get::<_, String>(0),
        )?,
        "expired",
    );
    assert!(connection
        .prepare("PRAGMA foreign_key_check")?
        .query_map([], |_| Ok(()))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .is_empty());
    for index in [
        "auth_authorization_contexts_session_idx",
        "auth_authorization_contexts_principal_idx",
        "auth_authorization_contexts_authority_idx",
        "auth_authorization_contexts_deployment_idx",
        "auth_authorization_contexts_instance_idx",
        "auth_authorization_contexts_issuer_idx",
        "auth_authorization_contexts_state_idx",
    ] {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1)",
            [index],
            |row| row.get(0),
        )?;
        assert!(exists, "missing V1003 index {index}");
    }
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
#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
fn runtime_stores_all_mode_migrates_all_selected_subsystems(
) -> Result<(), Box<dyn std::error::Error>> {
    let temp_dir = tempfile::tempdir()?;
    let platform_path = temp_dir.path().join("platform.sqlite");
    let jobs_path = temp_dir.path().join("jobs.sqlite");
    let health_path = temp_dir.path().join("health.sqlite");
    let eventlog_path = temp_dir.path().join("eventlog.sqlite");
    let mut config = runtime_config();
    config.platform = Some(subsystem_config(platform_path.clone()));
    config.jobs = Some(subsystem_config(jobs_path.clone()));
    config.health = Some(subsystem_config(health_path.clone()));
    config.eventlog = Some(subsystem_config(eventlog_path.clone()));

    config.validate_for_mode(RuntimeMode::All)?;
    let stores = RuntimeStores::from_config(&config, RuntimeMode::All)?;
    stores.migrate_all()?;

    assert!(stores.platform.is_some());
    assert!(stores.jobs.is_some());
    assert!(stores.health.is_some());
    assert!(stores.eventlog.is_some());
    assert_marker(&platform_path, "trellis_platform_store_marker")?;
    assert_marker(&jobs_path, "trellis_jobs_projection_store_marker")?;
    assert_marker(&health_path, "trellis_health_projection_store_marker")?;
    assert_marker(&eventlog_path, "trellis_eventlog_store_marker")?;
    assert_migration_order(&platform_path, &[1000, 1001, 1002, 1003, 1004, 1005])?;
    assert_migration_order(&jobs_path, &[2000])?;
    assert_migration_order(&health_path, &[3000, 3001])?;
    assert_migration_order(&eventlog_path, &[4000])?;
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

#[test]
fn bootstrap_administrator_migration_preserves_the_initial_admin(
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = rusqlite::Connection::open_in_memory()?;
    for migration in [
        include_str!("sqlite/platform/V1000__platform_init.sql"),
        include_str!("sqlite/platform/V1001__authorization_state.sql"),
        include_str!("sqlite/platform/V1002__auth_service_cutover.sql"),
        include_str!("sqlite/platform/V1003__authorization_context_runtime.sql"),
        include_str!("sqlite/platform/V1004__auth_console_policy.sql"),
    ] {
        connection.execute_batch(migration)?;
    }
    let digest = "a".repeat(43);
    connection.execute(
        "INSERT INTO auth_participant_bindings (
            participant_id, participant_kind, artifact_digest, needs_digest,
            participant_json, api_artifacts_json, resolved_at, state
         ) VALUES ('trellis-platform-administration', 'app', ?1, ?1, '{}', '{}', 1, 'resolved')",
        [&digest],
    )?;
    for (principal_id, created_at) in [("initial_admin", 10), ("later_admin", 20)] {
        connection.execute(
            "INSERT INTO auth_principals (
                principal_id, kind, state, created_at, updated_at, version
             ) VALUES (?1, 'user', 'active', ?2, ?2, 1)",
            rusqlite::params![principal_id, created_at],
        )?;
        connection.execute(
            "INSERT INTO auth_identity_authorities (
                authority_id, principal_id, participant_id, participant_artifact_digest,
                accepted_needs_digest, desired_grant_set_json, desired_capabilities_json,
                state, version, created_at, updated_at, decision_at, decision_by
             ) VALUES (?1, ?2, 'trellis-platform-administration', ?3, ?3, '{}', '[\"admin\"]',
                       'accepted', 1, ?4, ?4, ?4, 'portal')",
            rusqlite::params![
                format!("authority_{principal_id}"),
                principal_id,
                digest,
                created_at
            ],
        )?;
    }
    connection.execute(
        "INSERT INTO auth_account_flows (
            flow_id, kind, token_hash, payload_json, state, created_at, expires_at, version
         ) VALUES ('legacy_flow', 'first_admin', ?1, '{}', 'pending', 1, 100, 1)",
        ["b".repeat(43)],
    )?;

    connection.execute_batch(include_str!(
        "sqlite/platform/V1005__bootstrap_administrator.sql"
    ))?;

    assert_eq!(
        connection.query_row(
            "SELECT principal_id FROM auth_bootstrap_administrator WHERE singleton = 1",
            [],
            |row| row.get::<_, String>(0),
        )?,
        "initial_admin"
    );
    assert_eq!(
        connection.query_row(
            "SELECT kind FROM auth_account_flows WHERE flow_id = 'legacy_flow'",
            [],
            |row| row.get::<_, String>(0),
        )?,
        "admin_account"
    );
    Ok(())
}
