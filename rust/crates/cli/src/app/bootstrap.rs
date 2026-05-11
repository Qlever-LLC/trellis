use std::env;
use std::fs;
use std::path::PathBuf;

use crate::app::{ensure_bucket, ensure_stream, BucketEnsureStatus, AUTH_BOOTSTRAP_BUCKETS};
use crate::cli::*;
use crate::output;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use miette::{miette, IntoDiagnostic};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use time::OffsetDateTime;
use trellis_local_bootstrap::{
    generate_local_nats_bootstrap, ContainerRuntime, LocalBootstrapError, LocalNatsBootstrapOptions,
};
use ulid::Ulid;

pub(super) async fn run(command: BootstrapCommand) -> miette::Result<()> {
    match command.command {
        BootstrapSubcommand::Nats(args) => nats_bootstrap_command(&args).await,
        BootstrapSubcommand::LocalNats(args) => local_nats_bootstrap_command(&args),
        BootstrapSubcommand::Admin(args) => bootstrap_admin_command(&args).await,
    }
}

fn local_nats_bootstrap_command(args: &LocalNatsBootstrapArgs) -> miette::Result<()> {
    let mut options = LocalNatsBootstrapOptions::new(args.out.clone());
    options.force = args.force;
    options.container_runtime = match args.container_runtime {
        LocalNatsContainerRuntimeArg::Auto => ContainerRuntime::Auto,
        LocalNatsContainerRuntimeArg::Podman => ContainerRuntime::Podman,
        LocalNatsContainerRuntimeArg::Docker => ContainerRuntime::Docker,
    };
    options.nats_box_image = args.nats_box_image.clone();
    options.operator_name = args.operator_name.clone();
    options.system_account = args.system_account.clone();
    options.auth_account = args.auth_account.clone();
    options.trellis_account = args.trellis_account.clone();
    options.server_name = args.server_name.clone();

    let manifest = generate_local_nats_bootstrap(&options).map_err(local_bootstrap_report)?;
    output::print_success("generated local NATS bootstrap files");
    output::print_info(&format!("out={}", args.out.display()));
    output::print_info(&format!(
        "authAccount={}",
        manifest.accounts.auth.public_key
    ));
    output::print_info(&format!(
        "trellisAccount={}",
        manifest.accounts.trellis.public_key
    ));
    Ok(())
}

fn local_bootstrap_report(error: LocalBootstrapError) -> miette::Report {
    miette!(error.to_string())
}

async fn nats_bootstrap_command(args: &NatsBootstrapArgs) -> miette::Result<()> {
    let servers = args
        .servers
        .clone()
        .or_else(|| env::var("TRELLIS_NATS_SERVERS").ok())
        .or_else(|| env::var("NATS_SERVERS").ok())
        .unwrap_or_else(|| "localhost".to_string());
    let jetstream_replicas = match args.jetstream_replicas {
        Some(0) => {
            return Err(miette!("--jetstream-replicas must be a positive integer"));
        }
        Some(replicas) => replicas,
        None => parse_jetstream_replicas_env()?.unwrap_or(1),
    };

    let stream_created = ensure_stream(
        &servers,
        &args.trellis_creds,
        "trellis",
        vec!["events.>".to_string()],
        jetstream_replicas,
    )
    .await?;
    let mut rows = vec![vec![
        "stream".to_string(),
        "trellis".to_string(),
        if stream_created { "created" } else { "exists" }.to_string(),
    ]];
    for bucket in AUTH_BOOTSTRAP_BUCKETS {
        let status = ensure_bucket(
            &servers,
            &args.auth_creds,
            bucket.name,
            1,
            bucket.ttl_ms,
            jetstream_replicas,
        )
        .await?;
        rows.push(vec![
            "bucket".to_string(),
            bucket.name.to_string(),
            match status {
                BucketEnsureStatus::Created => "created",
                BucketEnsureStatus::Updated => "updated",
                BucketEnsureStatus::Exists => "exists",
            }
            .to_string(),
        ]);
    }
    println!("{}", output::table(&["kind", "name", "status"], rows));
    Ok(())
}

fn parse_jetstream_replicas_env() -> miette::Result<Option<usize>> {
    let Some(value) = env::var("TRELLIS_JETSTREAM_REPLICAS").ok() else {
        return Ok(None);
    };
    match value.parse::<usize>() {
        Ok(replicas) if replicas > 0 => Ok(Some(replicas)),
        _ => Err(miette!(
            "TRELLIS_JETSTREAM_REPLICAS must be a positive integer"
        )),
    }
}

async fn bootstrap_admin_command(args: &BootstrapAdminArgs) -> miette::Result<()> {
    let capabilities = if args.capabilities.is_empty() {
        vec![
            "admin".to_string(),
            "trellis.core::trellis.catalog.read".to_string(),
            "trellis.core::trellis.contract.read".to_string(),
        ]
    } else {
        args.capabilities.clone()
    };

    let seed = seed_admin_user(&args.db_path, &args.provider, &args.subject, &capabilities)?;

    output::print_success("bootstrapped admin user");
    output::print_info(&format!("dbPath={}", args.db_path.display()));
    output::print_info(&format!("userId={}", seed.user_id));
    output::print_info(&format!("identityId={}", seed.identity_id));
    output::print_info(&format!(
        "payload={}",
        json!({
            "userId": seed.user_id,
            "identity": {
                "identityId": seed.identity_id,
                "provider": args.provider,
                "subject": args.subject,
            },
            "active": true,
            "capabilities": capabilities,
        })
    ));
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SeededAdminUser {
    user_id: String,
    identity_id: String,
}

fn seed_admin_user(
    db_path: &PathBuf,
    provider: &str,
    subject: &str,
    capabilities: &[String],
) -> miette::Result<SeededAdminUser> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }

    let conn = Connection::open(db_path).into_diagnostic()?;
    seed_admin_user_in_connection(&conn, provider, subject, capabilities)
}

fn seed_admin_user_in_connection(
    conn: &Connection,
    provider: &str,
    subject: &str,
    capabilities: &[String],
) -> miette::Result<SeededAdminUser> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          name TEXT,
          email TEXT,
          active INTEGER NOT NULL,
          capabilities TEXT NOT NULL,
          capability_groups TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )",
        [],
    )
    .into_diagnostic()?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS user_identities (
          id TEXT PRIMARY KEY,
          identity_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          subject TEXT NOT NULL,
          display_name TEXT,
          email TEXT,
          email_verified INTEGER NOT NULL,
          linked_at TEXT NOT NULL,
          last_login_at TEXT,
          UNIQUE(provider, subject)
        )",
        [],
    )
    .into_diagnostic()?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS users_active_idx ON users(active)",
        [],
    )
    .into_diagnostic()?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS user_identities_user_id_idx ON user_identities(user_id)",
        [],
    )
    .into_diagnostic()?;

    let existing_user_id: Option<String> = conn
        .query_row(
            "SELECT user_id FROM user_identities WHERE provider = ?1 AND subject = ?2",
            params![provider, subject],
            |row| row.get(0),
        )
        .optional()
        .into_diagnostic()?;
    let user_id = existing_user_id.unwrap_or_else(|| format!("usr_{}", Ulid::new()));
    let identity_id = identity_id_for_provider_subject(provider, subject);
    let now = OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .into_diagnostic()?;
    let capabilities_json = serde_json::to_string(capabilities).into_diagnostic()?;
    let capability_groups_json = serde_json::to_string(&Vec::<String>::new()).into_diagnostic()?;

    conn.execute(
        "INSERT INTO users (id, user_id, name, email, active, capabilities, capability_groups, created_at, updated_at)
         VALUES (?1, ?2, NULL, NULL, 1, ?3, ?4, ?5, ?5)
         ON CONFLICT(user_id) DO UPDATE SET
           active = excluded.active,
           capabilities = excluded.capabilities,
           capability_groups = excluded.capability_groups,
           updated_at = excluded.updated_at",
        params![
            Ulid::new().to_string(),
            &user_id,
            capabilities_json,
            capability_groups_json,
            now
        ],
    )
    .into_diagnostic()?;

    conn.execute(
        "INSERT INTO user_identities (id, identity_id, user_id, provider, subject, display_name, email, email_verified, linked_at, last_login_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, 0, ?6, NULL)
         ON CONFLICT(provider, subject) DO UPDATE SET
           identity_id = excluded.identity_id,
           user_id = excluded.user_id",
        params![
            Ulid::new().to_string(),
            &identity_id,
            &user_id,
            provider,
            subject,
            now
        ],
    )
    .into_diagnostic()?;

    Ok(SeededAdminUser {
        user_id,
        identity_id,
    })
}

fn identity_id_for_provider_subject(provider: &str, subject: &str) -> String {
    format!(
        "idn_{}",
        URL_SAFE_NO_PAD.encode(format!("{provider}:{subject}").as_bytes())
    )
}

#[cfg(test)]
mod tests {
    use super::{identity_id_for_provider_subject, seed_admin_user_in_connection};
    use crate::app::{KvBucketSpec, AUTH_BOOTSTRAP_BUCKETS};
    use rusqlite::{params, Connection};

    #[derive(Debug, Eq, PartialEq)]
    struct RuntimeBucketSpec {
        name: String,
        ttl_ms: u64,
    }

    #[test]
    fn bootstrap_buckets_match_runtime_globals() {
        let runtime = parse_runtime_bucket_specs(include_str!(
            "../../../../../js/services/trellis/bootstrap/globals.ts"
        ));
        let bootstrap = AUTH_BOOTSTRAP_BUCKETS
            .iter()
            .map(|bucket| RuntimeBucketSpec {
                name: bucket.name.to_string(),
                ttl_ms: bucket.ttl_ms,
            })
            .collect::<Vec<_>>();

        assert_eq!(bootstrap, runtime);
    }

    #[test]
    fn seed_admin_user_uses_account_first_storage_shape() {
        let conn = Connection::open_in_memory().expect("open db");
        let seeded = seed_admin_user_in_connection(
            &conn,
            "github",
            "ada",
            &[
                "admin".to_string(),
                "trellis.core::trellis.catalog.read".to_string(),
            ],
        )
        .expect("seed admin");

        assert!(seeded.user_id.starts_with("usr_"));
        assert_eq!(
            seeded.identity_id,
            identity_id_for_provider_subject("github", "ada")
        );

        let user_row: (String, String, i64, String, String) = conn
            .query_row(
                "SELECT user_id, capabilities, active, capability_groups, created_at FROM users",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("select user");
        assert_eq!(user_row.0, seeded.user_id);
        assert_eq!(
            user_row.1,
            r#"["admin","trellis.core::trellis.catalog.read"]"#
        );
        assert_eq!(user_row.2, 1);
        assert_eq!(user_row.3, "[]");
        assert!(!user_row.4.is_empty());

        let identity_row: (String, String, String, String, i64) = conn
            .query_row(
                "SELECT identity_id, user_id, provider, subject, email_verified FROM user_identities",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("select identity");
        assert_eq!(identity_row.0, seeded.identity_id);
        assert_eq!(identity_row.1, seeded.user_id);
        assert_eq!(identity_row.2, "github");
        assert_eq!(identity_row.3, "ada");
        assert_eq!(identity_row.4, 0);
    }

    #[test]
    fn seed_admin_user_updates_existing_provider_subject() {
        let conn = Connection::open_in_memory().expect("open db");
        let first = seed_admin_user_in_connection(&conn, "github", "ada", &["admin".to_string()])
            .expect("first seed");
        let second = seed_admin_user_in_connection(
            &conn,
            "github",
            "ada",
            &["trellis.core::trellis.contract.read".to_string()],
        )
        .expect("second seed");

        assert_eq!(second, first);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
            .expect("count users");
        assert_eq!(count, 1);
        let capabilities: String = conn
            .query_row(
                "SELECT capabilities FROM users WHERE user_id = ?1",
                params![second.user_id],
                |row| row.get(0),
            )
            .expect("select capabilities");
        assert_eq!(capabilities, r#"["trellis.core::trellis.contract.read"]"#);
    }

    fn parse_runtime_bucket_specs(source: &str) -> Vec<RuntimeBucketSpec> {
        let mut specs = Vec::new();
        let mut current_name: Option<String> = None;

        for line in source.lines() {
            if current_name.is_none() {
                current_name = extract_bucket_name(line);
                continue;
            }

            if let Some(ttl_ms) = extract_ttl_ms(line) {
                specs.push(RuntimeBucketSpec {
                    name: current_name
                        .take()
                        .expect("bucket name should be present when ttl is parsed"),
                    ttl_ms,
                });
            }
        }

        assert!(
            current_name.is_none(),
            "found bucket without ttl in globals.ts"
        );
        specs
    }

    fn extract_bucket_name(line: &str) -> Option<String> {
        if !line.contains('"') || !line.contains("trellis_") {
            return None;
        }

        let start = line.find('"')? + 1;
        let rest = &line[start..];
        let end = rest.find('"')?;
        let name = &rest[..end];

        name.starts_with("trellis_").then(|| name.to_string())
    }

    fn extract_ttl_ms(line: &str) -> Option<u64> {
        let ttl = line
            .split_once("ttl:")?
            .1
            .trim()
            .trim_end_matches(',')
            .trim_end_matches('}')
            .trim();

        Some(match ttl {
            "0" => 0,
            "config.ttlMs.sessions" => 24 * 60 * 60_000_u64,
            "config.ttlMs.oauth" => 5 * 60_000_u64,
            "Math.max(config.ttlMs.oauth, config.ttlMs.deviceFlow)" => 30 * 60_000_u64,
            "config.ttlMs.deviceFlow" => 30 * 60_000_u64,
            "config.ttlMs.pendingAuth" => 5 * 60_000_u64,
            "config.ttlMs.connections" => 2 * 60 * 60_000_u64,
            other => panic!("unexpected ttl expression in globals.ts: {other}"),
        })
    }

    #[test]
    fn bootstrap_bucket_names_are_unique() {
        let mut names = AUTH_BOOTSTRAP_BUCKETS
            .iter()
            .map(|bucket: &KvBucketSpec| bucket.name)
            .collect::<Vec<_>>();
        let original_len = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), original_len);
    }
}
