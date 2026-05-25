use std::net::TcpStream;
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use async_nats::jetstream;
use async_nats::jetstream::stream;
use async_nats::ConnectOptions;
use miette::{miette, IntoDiagnostic, Result, WrapErr};

use crate::container::{unique_container_name, ContainerBackend, IntegrationWorkdir};
use crate::process::{command_output_failure_message, CommandSpec, ProcessRunner};

#[derive(Debug)]
pub(crate) struct NatsContainer {
    runtime: &'static str,
    name: String,
    server_port: u16,
    websocket_port: u16,
}

impl NatsContainer {
    pub(crate) fn start(
        process_runner: &ProcessRunner,
        backend: ContainerBackend,
        _workdir: &IntegrationWorkdir,
        nats_dir: &Path,
    ) -> Result<Self> {
        let name = unique_container_name("nats")?;
        let config_mount = container_config_mount(backend, &nats_dir.join("nats.conf"));
        let jwt_config_mount = container_jwt_config_mount(backend, &nats_dir.join("jwt.conf"));
        let data_mount = container_data_mount(backend, &nats_dir.join("data"));
        let spec = CommandSpec::new(backend.program())
            .arg("run")
            .arg("--detach")
            .arg("--name")
            .arg(&name)
            .arg("--publish")
            .arg("127.0.0.1::4222")
            .arg("--publish")
            .arg("127.0.0.1::8080")
            .arg("--volume")
            .arg(config_mount)
            .arg("--volume")
            .arg(jwt_config_mount)
            .arg("--volume")
            .arg(data_mount)
            .arg("docker.io/library/nats:2-alpine")
            .arg("-c")
            .arg("/etc/nats/nats.conf");
        let output = process_runner.output(&spec)?;
        if !output.status.success() {
            return Err(miette!(
                "{}",
                command_output_failure_message("failed to start NATS container", &spec, &output)
            ));
        }

        let server_port = match inspect_container_port(process_runner, backend, &name, 4222) {
            Ok(host_port) => host_port,
            Err(error) => {
                remove_container(backend, &name);
                return Err(error);
            }
        };
        let websocket_port = match inspect_container_port(process_runner, backend, &name, 8080) {
            Ok(host_port) => host_port,
            Err(error) => {
                remove_container(backend, &name);
                return Err(error);
            }
        };
        if let Err(error) = wait_for_tcp_ready(server_port, Duration::from_secs(30)) {
            remove_container(backend, &name);
            return Err(error);
        }
        if let Err(error) = wait_for_tcp_ready(websocket_port, Duration::from_secs(30)) {
            remove_container(backend, &name);
            return Err(error);
        }

        Ok(Self {
            runtime: backend.program(),
            name,
            server_port,
            websocket_port,
        })
    }

    pub(crate) fn server_url(&self) -> String {
        format!("nats://127.0.0.1:{}", self.server_port)
    }

    pub(crate) fn websocket_url(&self) -> String {
        format!("ws://127.0.0.1:{}", self.websocket_port)
    }
}

impl Drop for NatsContainer {
    fn drop(&mut self) {
        remove_container(ContainerBackend::new(self.runtime), &self.name);
    }
}

pub(crate) fn remove_container(backend: ContainerBackend, name: &str) {
    let output = Command::new(backend.program())
        .arg("rm")
        .arg("--force")
        .arg(name)
        .output();
    match output {
        Ok(output) if output.status.success() => {}
        Ok(output) => eprintln!(
            "warning: failed to remove container {name} with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ),
        Err(error) => eprintln!("warning: failed to remove container {name}: {error}"),
    }
}

fn container_config_mount(backend: ContainerBackend, config_path: &Path) -> String {
    let options = if backend.is_podman() { "ro,Z" } else { "ro" };
    format!("{}:/etc/nats/nats.conf:{options}", config_path.display())
}

fn container_jwt_config_mount(backend: ContainerBackend, config_path: &Path) -> String {
    let options = if backend.is_podman() { "ro,Z" } else { "ro" };
    format!("{}:/etc/nats/jwt.conf:{options}", config_path.display())
}

fn container_data_mount(backend: ContainerBackend, data_path: &Path) -> String {
    let options = if backend.is_podman() { "Z" } else { "rw" };
    format!("{}:/data:{options}", data_path.display())
}

pub(crate) fn inspect_container_port(
    process_runner: &ProcessRunner,
    backend: ContainerBackend,
    name: &str,
    container_port: u16,
) -> Result<u16> {
    let spec = CommandSpec::new(backend.program())
        .arg("port")
        .arg(name)
        .arg(format!("{container_port}/tcp"));
    let output = process_runner.output(&spec)?;
    if !output.status.success() {
        return Err(miette!(
            "{}",
            command_output_failure_message("failed to inspect NATS container port", &spec, &output)
        ));
    }
    let stdout = String::from_utf8(output.stdout)
        .into_diagnostic()
        .wrap_err("container port output was not UTF-8")?;
    parse_published_port(&stdout)
}

pub(crate) fn parse_published_port(output: &str) -> Result<u16> {
    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(port) = line.rsplit(':').next() {
            if let Ok(port) = port.parse::<u16>() {
                return Ok(port);
            }
        }
    }

    Err(miette!(
        "failed to parse published NATS port from `{output}`"
    ))
}

pub(crate) fn wait_for_tcp_ready(port: u16, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(_) => return Ok(()),
            Err(error) if Instant::now() >= deadline => {
                return Err(miette!(
                    "timed out waiting for NATS on 127.0.0.1:{port}: {error}"
                ));
            }
            Err(_) => thread::sleep(Duration::from_millis(100)),
        }
    }
}

pub(crate) async fn ensure_event_stream(servers: &str, trellis_creds: &Path) -> Result<()> {
    let client = ConnectOptions::new()
        .credentials_file(trellis_creds)
        .await
        .into_diagnostic()?
        .connect(servers)
        .await
        .into_diagnostic()?;
    let js = jetstream::new(client);
    if js.get_stream("trellis").await.is_ok() {
        return Ok(());
    }
    js.create_stream(stream::Config {
        name: "trellis".to_string(),
        subjects: vec!["events.>".to_string()],
        num_replicas: 1,
        ..Default::default()
    })
    .await
    .into_diagnostic()?;
    Ok(())
}

pub(crate) async fn ensure_jobs_shared_streams(servers: &str, trellis_creds: &Path) -> Result<()> {
    let client = ConnectOptions::new()
        .credentials_file(trellis_creds)
        .await
        .into_diagnostic()?
        .connect(servers)
        .await
        .into_diagnostic()?;
    let js = jetstream::new(client);
    ensure_stream(
        &js,
        "JOBS",
        &["trellis.jobs.>"],
        stream::RetentionPolicy::Limits,
        true,
        None,
    )
    .await?;
    ensure_stream(
        &js,
        "JOBS_WORK",
        &["trellis.work.>"],
        stream::RetentionPolicy::WorkQueue,
        false,
        Some(vec![stream::Source {
            name: "JOBS".to_string(),
            subject_transforms: vec![
                stream::SubjectTransform {
                    source: "trellis.jobs.*.*.*.created".to_string(),
                    destination: "trellis.work.$1.$2".to_string(),
                },
                stream::SubjectTransform {
                    source: "trellis.jobs.*.*.*.retried".to_string(),
                    destination: "trellis.work.$1.$2".to_string(),
                },
            ],
            ..Default::default()
        }]),
    )
    .await?;
    ensure_stream(
        &js,
        "JOBS_ADVISORIES",
        &["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>"],
        stream::RetentionPolicy::Limits,
        false,
        None,
    )
    .await?;
    Ok(())
}

pub(crate) async fn ensure_resource_conflict_streams(
    servers: &str,
    trellis_creds: &Path,
    deployment_id: &str,
    contract_id: &str,
    aliases: &[(&str, &str)],
) -> Result<()> {
    let client = ConnectOptions::new()
        .credentials_file(trellis_creds)
        .await
        .into_diagnostic()?
        .connect(servers)
        .await
        .into_diagnostic()?;
    let js = jetstream::new(client);
    for (kind, alias) in aliases {
        let resource_name = build_resource_name(deployment_id, contract_id, alias);
        let stream_name = match *kind {
            "kv" => format!("KV_{resource_name}"),
            "store" => format!("OBJ_{resource_name}"),
            other => return Err(miette!("unsupported resource conflict kind `{other}`")),
        };
        if js.get_stream(&stream_name).await.is_ok() {
            continue;
        }
        let mut config = stream::Config {
            name: stream_name.clone(),
            subjects: vec![format!("trellis.resource-conflict.{stream_name}.>")],
            num_replicas: 1,
            ..Default::default()
        };
        js.create_stream(config.clone())
            .await
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create resource conflict stream `{stream_name}`: {error}")
            })?;
        config.sealed = true;
        js.update_stream(config)
            .await
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to seal resource conflict stream `{stream_name}`: {error}")
            })?;
    }
    Ok(())
}

fn sanitize_resource_token(value: &str) -> String {
    let mut sanitized = String::new();
    let mut last_was_underscore = false;
    for character in value.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
            sanitized.push(character);
            last_was_underscore = false;
        } else if !last_was_underscore {
            sanitized.push('_');
            last_was_underscore = true;
        }
    }
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "resource".to_string()
    } else {
        trimmed.to_string()
    }
}

fn stable_resource_hash(parts: &[&str]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in parts.join("\u{001f}").bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")[..12].to_string()
}

fn build_resource_name(deployment_id: &str, contract_id: &str, alias: &str) -> String {
    let service = sanitize_resource_token(deployment_id)
        .chars()
        .take(12)
        .collect::<String>();
    let contract = sanitize_resource_token(contract_id)
        .chars()
        .take(12)
        .collect::<String>();
    let logical = sanitize_resource_token(alias)
        .chars()
        .take(20)
        .collect::<String>();
    let hash = stable_resource_hash(&[deployment_id, contract_id, alias]);
    format!("svc_{service}_{contract}_{logical}_{hash}")
}

async fn ensure_stream(
    js: &jetstream::Context,
    name: &str,
    subjects: &[&str],
    retention: stream::RetentionPolicy,
    allow_direct: bool,
    sources: Option<Vec<stream::Source>>,
) -> Result<()> {
    if js.get_stream(name).await.is_ok() {
        return Ok(());
    }
    js.create_stream(stream::Config {
        name: name.to_string(),
        subjects: subjects.iter().map(|subject| subject.to_string()).collect(),
        retention,
        allow_direct,
        sources,
        num_replicas: 1,
        ..Default::default()
    })
    .await
    .into_diagnostic()
    .map_err(|error| miette!("failed to create shared stream `{name}`: {error}"))?;
    Ok(())
}

pub(crate) async fn assert_jobs_shared_streams(servers: &str, trellis_creds: &Path) -> Result<()> {
    let client = ConnectOptions::new()
        .credentials_file(trellis_creds)
        .await
        .into_diagnostic()?
        .connect(servers)
        .await
        .into_diagnostic()?;
    let js = jetstream::new(client);
    assert_stream_config(
        &js,
        "JOBS",
        &["trellis.jobs.>"],
        stream::RetentionPolicy::Limits,
        true,
    )
    .await?;
    assert_stream_config(
        &js,
        "JOBS_WORK",
        &["trellis.work.>"],
        stream::RetentionPolicy::WorkQueue,
        false,
    )
    .await?;
    assert_stream_config(
        &js,
        "JOBS_ADVISORIES",
        &["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>"],
        stream::RetentionPolicy::Limits,
        false,
    )
    .await?;
    assert_jobs_work_sources(&js).await?;
    Ok(())
}

async fn assert_stream_config(
    js: &jetstream::Context,
    name: &str,
    expected_subjects: &[&str],
    expected_retention: stream::RetentionPolicy,
    expected_allow_direct: bool,
) -> Result<()> {
    let mut stream = js
        .get_stream(name)
        .await
        .into_diagnostic()
        .map_err(|error| miette!("expected shared Jobs stream `{name}` to exist: {error}"))?;
    let info = stream
        .info()
        .await
        .into_diagnostic()
        .map_err(|error| miette!("failed to inspect shared Jobs stream `{name}`: {error}"))?;
    let expected_subjects = expected_subjects
        .iter()
        .map(|subject| (*subject).to_string())
        .collect::<Vec<_>>();
    if info.config.subjects != expected_subjects {
        return Err(miette!(
            "shared Jobs stream `{name}` subjects {:?} did not match {:?}",
            info.config.subjects,
            expected_subjects
        ));
    }
    if info.config.retention != expected_retention {
        return Err(miette!(
            "shared Jobs stream `{name}` retention {:?} did not match {:?}",
            info.config.retention,
            expected_retention
        ));
    }
    if info.config.allow_direct != expected_allow_direct {
        return Err(miette!(
            "shared Jobs stream `{name}` allow_direct {} did not match {}",
            info.config.allow_direct,
            expected_allow_direct
        ));
    }
    Ok(())
}

async fn assert_jobs_work_sources(js: &jetstream::Context) -> Result<()> {
    let mut stream = js
        .get_stream("JOBS_WORK")
        .await
        .into_diagnostic()
        .map_err(|error| miette!("expected shared Jobs stream `JOBS_WORK` to exist: {error}"))?;
    let info =
        stream.info().await.into_diagnostic().map_err(|error| {
            miette!("failed to inspect shared Jobs stream `JOBS_WORK`: {error}")
        })?;
    let sources = info.config.sources.as_deref().unwrap_or(&[]);
    let expected = [
        ("trellis.jobs.*.*.*.created", "trellis.work.$1.$2"),
        ("trellis.jobs.*.*.*.retried", "trellis.work.$1.$2"),
    ];
    let transform_count = sources
        .iter()
        .flat_map(|source| source.subject_transforms.iter())
        .count();
    if transform_count != expected.len() {
        return Err(miette!(
            "shared Jobs stream `JOBS_WORK` sources {:?} did not match expected transforms",
            sources
        ));
    }
    for (expected_source, expected_destination) in expected {
        let found = sources.iter().any(|source| {
            source.name == "JOBS"
                && source.subject_transforms.iter().any(|transform| {
                    transform.source == expected_source
                        && transform.destination == expected_destination
                })
        });
        if !found {
            return Err(miette!(
                "shared Jobs stream `JOBS_WORK` sources {:?} did not include expected transform ({expected_source}, {expected_destination})",
                sources
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        container_config_mount, container_data_mount, container_jwt_config_mount,
        parse_published_port,
    };
    use crate::container::ContainerBackend;

    #[test]
    fn container_config_mount_relabels_podman_volume() {
        let path = std::path::Path::new("/tmp/trellis/nats.conf");

        assert_eq!(
            container_config_mount(ContainerBackend::new("podman"), path),
            "/tmp/trellis/nats.conf:/etc/nats/nats.conf:ro,Z"
        );
        assert_eq!(
            container_config_mount(ContainerBackend::new("docker"), path),
            "/tmp/trellis/nats.conf:/etc/nats/nats.conf:ro"
        );
    }

    #[test]
    fn container_jwt_config_mount_relabels_podman_volume() {
        let path = std::path::Path::new("/tmp/trellis/jwt.conf");

        assert_eq!(
            container_jwt_config_mount(ContainerBackend::new("podman"), path),
            "/tmp/trellis/jwt.conf:/etc/nats/jwt.conf:ro,Z"
        );
        assert_eq!(
            container_jwt_config_mount(ContainerBackend::new("docker"), path),
            "/tmp/trellis/jwt.conf:/etc/nats/jwt.conf:ro"
        );
    }

    #[test]
    fn container_data_mount_relabels_podman_volume() {
        let path = std::path::Path::new("/tmp/trellis/data");

        assert_eq!(
            container_data_mount(ContainerBackend::new("podman"), path),
            "/tmp/trellis/data:/data:Z"
        );
        assert_eq!(
            container_data_mount(ContainerBackend::new("docker"), path),
            "/tmp/trellis/data:/data:rw"
        );
    }

    #[test]
    fn parse_published_port_accepts_container_runtime_output() {
        assert_eq!(
            parse_published_port("127.0.0.1:49152\n").expect("parse localhost port"),
            49152
        );
        assert_eq!(
            parse_published_port("0.0.0.0:42221\n").expect("parse wildcard port"),
            42221
        );
        assert_eq!(
            parse_published_port("[::1]:43333\n").expect("parse ipv6 port"),
            43333
        );
    }

    #[test]
    fn parse_published_port_accepts_nats_and_websocket_ports() {
        assert_eq!(
            parse_published_port("127.0.0.1:4222\n").expect("parse NATS port"),
            4222
        );
        assert_eq!(
            parse_published_port("127.0.0.1:8080\n").expect("parse websocket port"),
            8080
        );
    }

    #[test]
    fn parse_published_port_rejects_missing_port() {
        let error = parse_published_port("4222/tcp").expect_err("port should be missing");

        assert!(error
            .to_string()
            .contains("failed to parse published NATS port"));
    }
}
