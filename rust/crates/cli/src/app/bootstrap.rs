use std::env;
use std::fs;
use std::path::PathBuf;

use crate::app::{
    ensure_bucket, ensure_stream, trellis_id_from_origin_id, BucketEnsureStatus,
    AUTH_BOOTSTRAP_BUCKETS,
};
use crate::cli::*;
use crate::output;
use miette::IntoDiagnostic;
use rusqlite::{params, Connection};
use serde_json::json;
use ulid::Ulid;

pub(super) async fn run(command: BootstrapCommand) -> miette::Result<()> {
    match command.command {
        BootstrapSubcommand::Nats(args) => nats_bootstrap_command(&args).await,
        BootstrapSubcommand::Admin(args) => bootstrap_admin_command(&args).await,
    }
}

async fn nats_bootstrap_command(args: &NatsBootstrapArgs) -> miette::Result<()> {
    let servers = args
        .servers
        .clone()
        .or_else(|| env::var("TRELLIS_NATS_SERVERS").ok())
        .or_else(|| env::var("NATS_SERVERS").ok())
        .unwrap_or_else(|| "localhost".to_string());

    let stream_created = ensure_stream(
        &servers,
        &args.trellis_creds,
        "trellis",
        vec!["events.>".to_string()],
    )
    .await?;
    let mut rows = vec![vec![
        "stream".to_string(),
        "trellis".to_string(),
        if stream_created { "created" } else { "exists" }.to_string(),
    ]];
    for bucket in AUTH_BOOTSTRAP_BUCKETS {
        let status =
            ensure_bucket(&servers, &args.auth_creds, bucket.name, 1, bucket.ttl_ms).await?;
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

async fn bootstrap_admin_command(args: &BootstrapAdminArgs) -> miette::Result<()> {
    let capabilities = if args.capabilities.is_empty() {
        vec![
            "admin".to_string(),
            "trellis.catalog.read".to_string(),
            "trellis.contract.read".to_string(),
        ]
    } else {
        args.capabilities.clone()
    };

    let trellis_id = trellis_id_from_origin_id(&args.origin, &args.id);
    seed_admin_user(
        &args.db_path,
        &trellis_id,
        &args.origin,
        &args.id,
        &capabilities,
    )?;

    output::print_success("bootstrapped admin user");
    output::print_info(&format!("dbPath={}", args.db_path.display()));
    output::print_info(&format!("trellisId={trellis_id}"));
    output::print_info(&format!(
        "payload={}",
        json!({
            "origin": args.origin,
            "id": args.id,
            "active": true,
            "capabilities": capabilities,
        })
    ));
    Ok(())
}

fn seed_admin_user(
    db_path: &PathBuf,
    trellis_id: &str,
    origin: &str,
    external_id: &str,
    capabilities: &[String],
) -> miette::Result<()> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }

    let conn = Connection::open(db_path).into_diagnostic()?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          trellis_id TEXT NOT NULL UNIQUE,
          origin TEXT NOT NULL,
          external_id TEXT NOT NULL,
          name TEXT,
          email TEXT,
          active INTEGER NOT NULL,
          capabilities TEXT NOT NULL
        )",
        [],
    )
    .into_diagnostic()?;

    let capabilities_json = serde_json::to_string(capabilities).into_diagnostic()?;
    conn.execute(
        "INSERT INTO users (id, trellis_id, origin, external_id, name, email, active, capabilities)
         VALUES (?1, ?2, ?3, ?4, NULL, NULL, 1, ?5)
         ON CONFLICT(trellis_id) DO UPDATE SET
           origin = excluded.origin,
           external_id = excluded.external_id,
           active = excluded.active,
           capabilities = excluded.capabilities",
        params![
            Ulid::new().to_string(),
            trellis_id,
            origin,
            external_id,
            capabilities_json
        ],
    )
    .into_diagnostic()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::app::{KvBucketSpec, AUTH_BOOTSTRAP_BUCKETS};

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
