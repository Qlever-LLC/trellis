use std::fs::{self, File};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use miette::{miette, IntoDiagnostic, Result, WrapErr};
use trellis_local_bootstrap::{
    render_trellis_config, LocalTrellisBootstrapManifest, LocalTrellisBootstrapOptions,
};

use crate::container::IntegrationWorkdir;
use crate::process::CommandSpec;
use crate::workspace::repo_root;

#[derive(Debug)]
pub(crate) struct TrellisRuntime {
    child: Child,
    public_url: String,
    stdout_log: PathBuf,
}

impl TrellisRuntime {
    pub(crate) fn start(
        workdir: &IntegrationWorkdir,
        manifest: &LocalTrellisBootstrapManifest,
        mut options: LocalTrellisBootstrapOptions,
        nats_server_url: &str,
        nats_websocket_url: &str,
        portal_build_dir: &Path,
    ) -> Result<Self> {
        options.nats_server_url = nats_server_url.to_string();
        options.nats_websocket_url = nats_websocket_url.to_string();
        rewrite_trellis_config(workdir.path(), manifest, &options)?;

        let config_path = workdir.path().join(&manifest.paths.trellis_config);
        let spec = trellis_command_spec(&repo_root()?, &config_path, portal_build_dir);
        let stdout_log = workdir.path().join("trellis.stdout.log");
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .wrap_err("failed to create Trellis stdout log")?;
        let stderr = File::create(workdir.path().join("trellis.stderr.log"))
            .into_diagnostic()
            .wrap_err("failed to create Trellis stderr log")?;
        let mut command = spec.command();
        let child = command
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to start `{}`", spec.display_command()))?;

        let runtime = Self {
            child,
            public_url: options.public_origin.clone(),
            stdout_log,
        };
        let listen_url = format!("http://127.0.0.1:{}", options.trellis_port);
        if let Err(error) = wait_for_version(&listen_url, Duration::from_secs(60)) {
            drop(runtime);
            return Err(error);
        }
        Ok(runtime)
    }

    pub(crate) fn public_url(&self) -> &str {
        &self.public_url
    }

    pub(crate) fn stdout_log(&self) -> &Path {
        &self.stdout_log
    }
}

impl Drop for TrellisRuntime {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect Trellis runtime child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill Trellis runtime child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for Trellis runtime child: {error}");
        }
    }
}

pub(crate) fn reserve_local_port() -> Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .into_diagnostic()
        .wrap_err("failed to reserve local port")?;
    Ok(listener
        .local_addr()
        .into_diagnostic()
        .wrap_err("failed to inspect reserved local port")?
        .port())
}

pub(crate) fn trellis_command_spec(
    repo_root: &Path,
    config_path: &Path,
    portal_build_dir: &Path,
) -> CommandSpec {
    CommandSpec::new("deno")
        .arg("run")
        .arg("--env")
        .arg("--allow-env")
        .arg("--allow-sys")
        .arg("--allow-read")
        .arg("--allow-write")
        .arg("--allow-net")
        .arg("--allow-ffi")
        .arg("main.ts")
        .current_dir(repo_root.join("js/services/trellis"))
        .env("TRELLIS_CONFIG", config_path.as_os_str())
        .env("TRELLIS_BUILTIN_PORTAL_DIR", portal_build_dir.as_os_str())
}

pub(crate) fn extract_bootstrap_url_from_log(log: &str) -> Result<String> {
    let marker = "\"bootstrapUrl\":\"";
    for line in log.lines() {
        if let Some(start) = line.find(marker) {
            let url_start = start + marker.len();
            if let Some(end) = line[url_start..].find('"') {
                return Ok(line[url_start..url_start + end].replace("\\/", "/"));
            }
        }
    }
    Err(miette!(
        "failed to extract bootstrapUrl from Trellis stdout log"
    ))
}

pub(crate) fn rewrite_trellis_config(
    workdir: &Path,
    manifest: &LocalTrellisBootstrapManifest,
    options: &LocalTrellisBootstrapOptions,
) -> Result<PathBuf> {
    let config_path = workdir.join(&manifest.paths.trellis_config);
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .into_diagnostic()
            .wrap_err_with(|| {
                format!(
                    "failed to create Trellis config directory {}",
                    parent.display()
                )
            })?;
    }
    fs::write(&config_path, render_trellis_config(options, &manifest.nats))
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to write Trellis config {}", config_path.display()))?;
    Ok(config_path)
}

fn wait_for_version(public_url: &str, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let endpoint = format!("{}/version", public_url.trim_end_matches('/'));
    loop {
        match get_json(&endpoint) {
            Ok(()) => return Ok(()),
            Err(error) if Instant::now() >= deadline => {
                return Err(miette!(
                    "timed out waiting for Trellis runtime at {endpoint}: {error}"
                ));
            }
            Err(_) => thread::sleep(Duration::from_millis(250)),
        }
    }
}

fn get_json(endpoint: &str) -> Result<()> {
    let url = endpoint
        .strip_prefix("http://")
        .ok_or_else(|| miette!("only http:// Trellis URLs are supported by the harness"))?;
    let (host_port, path) = url.split_once('/').unwrap_or((url, ""));
    let (host, port) = host_port
        .rsplit_once(':')
        .ok_or_else(|| miette!("Trellis URL is missing a port: {endpoint}"))?;
    let port = port
        .parse::<u16>()
        .into_diagnostic()
        .wrap_err_with(|| format!("invalid Trellis URL port in {endpoint}"))?;
    let mut stream = TcpStream::connect((host, port)).into_diagnostic()?;
    let request = format!(
        "GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nConnection: close\r\nAccept: application/json\r\n\r\n"
    );
    std::io::Write::write_all(&mut stream, request.as_bytes()).into_diagnostic()?;
    let mut response = String::new();
    std::io::Read::read_to_string(&mut stream, &mut response).into_diagnostic()?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| miette!("Trellis response was not valid HTTP"))?;
    let status_ok = headers
        .lines()
        .next()
        .is_some_and(|line| line.starts_with("HTTP/1.1 2") || line.starts_with("HTTP/1.0 2"));
    if !status_ok {
        return Err(miette!("Trellis /version returned non-success status"));
    }
    let body = if headers
        .lines()
        .any(|line| line.eq_ignore_ascii_case("transfer-encoding: chunked"))
    {
        decode_chunked_body(body)?
    } else {
        body.to_string()
    };
    serde_json::from_str::<serde_json::Value>(&body)
        .into_diagnostic()
        .wrap_err("Trellis /version response was not JSON")?;
    Ok(())
}

fn decode_chunked_body(body: &str) -> Result<String> {
    let mut decoded = String::new();
    let mut remaining = body;
    loop {
        let (size_hex, rest) = remaining
            .split_once("\r\n")
            .ok_or_else(|| miette!("chunked response was missing chunk size"))?;
        let size = usize::from_str_radix(size_hex.trim(), 16)
            .into_diagnostic()
            .wrap_err("chunked response had invalid chunk size")?;
        if size == 0 {
            return Ok(decoded);
        }
        if rest.len() < size + 2 {
            return Err(miette!("chunked response ended before declared chunk size"));
        }
        decoded.push_str(&rest[..size]);
        remaining = &rest[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use trellis_local_bootstrap::{
        BootstrapAccounts, BootstrapPaths, BootstrapUsers, LocalNatsBootstrapManifest,
        LocalTrellisBootstrapManifest, LocalTrellisBootstrapOptions, LocalTrellisBootstrapPaths,
        LocalTrellisBootstrapUrls, PublicAccount, PublicUser,
    };

    use super::{
        decode_chunked_body, extract_bootstrap_url_from_log, rewrite_trellis_config,
        trellis_command_spec,
    };

    #[test]
    fn trellis_command_spec_sets_directory_args_and_config_env() {
        let spec = trellis_command_spec(
            std::path::Path::new("/repo"),
            std::path::Path::new("/tmp/config.jsonc"),
            std::path::Path::new("/tmp/portal-build"),
        );

        assert_eq!(
            spec.display_command(),
            "deno run --env --allow-env --allow-sys --allow-read --allow-write --allow-net --allow-ffi main.ts"
        );
        assert_eq!(spec.envs()[0].0, "TRELLIS_CONFIG");
        assert_eq!(spec.envs()[0].1, "/tmp/config.jsonc");
        assert_eq!(spec.envs()[1].0, "TRELLIS_BUILTIN_PORTAL_DIR");
        assert_eq!(spec.envs()[1].1, "/tmp/portal-build");
    }

    #[test]
    fn extract_bootstrap_url_from_log_reads_structured_log_field() {
        let log = r#"{"level":30,"bootstrapUrl":"http://127.0.0.1:3000/_trellis/portal/admin/bootstrap?flowId=abc","msg":"ready"}"#;

        assert_eq!(
            extract_bootstrap_url_from_log(log).expect("extract URL"),
            "http://127.0.0.1:3000/_trellis/portal/admin/bootstrap?flowId=abc"
        );
    }

    #[test]
    fn rewrite_trellis_config_renders_dynamic_urls() {
        let temp = tempfile::tempdir().expect("temp dir");
        let manifest = trellis_manifest();
        let mut options = LocalTrellisBootstrapOptions::new(temp.path());
        options.trellis_port = 49111;
        options.public_origin = "http://127.0.0.1:49111".to_string();
        options.nats_server_url = "nats://127.0.0.1:49112".to_string();
        options.nats_websocket_url = "ws://127.0.0.1:49113".to_string();

        let config_path = rewrite_trellis_config(temp.path(), &manifest, &options)
            .expect("rewrite Trellis config");
        let config = std::fs::read_to_string(config_path).expect("read config");

        assert!(config.contains("\"port\": 49111"));
        assert!(config.contains("nats://127.0.0.1:49112"));
        assert!(config.contains("ws://127.0.0.1:49113"));
    }

    #[test]
    fn decode_chunked_body_returns_json_payload() {
        assert_eq!(
            decode_chunked_body("8\r\n{\"ok\":1}\r\n0\r\n\r\n").expect("decode chunked body"),
            "{\"ok\":1}"
        );
    }

    fn trellis_manifest() -> LocalTrellisBootstrapManifest {
        LocalTrellisBootstrapManifest {
            version: 1,
            nats: LocalNatsBootstrapManifest {
                version: 1,
                nats_box_image: "nats-box".to_string(),
                operator_name: "Qlever".to_string(),
                server_name: "trellis-local".to_string(),
                accounts: BootstrapAccounts {
                    system: account("SYS", "ADSYS"),
                    auth: account("AUTH", "ADAUTH"),
                    trellis: account("TRELLIS", "ADTRELLIS"),
                },
                users: BootstrapUsers {
                    system: user("system", "UDSYS"),
                    auth_service: user("auth", "UDAUTH"),
                    trellis_service: user("auth", "UDTRELLIS"),
                    sentinel: user("sentinel", "UDSENTINEL"),
                },
                paths: BootstrapPaths {
                    nats_config: "nats.conf".to_string(),
                    jwt_config: "jwt.conf".to_string(),
                    account_jwts: BTreeMap::new(),
                    creds: BTreeMap::new(),
                    secrets: BTreeMap::new(),
                    auth_callout_env: "auth-callout.env".to_string(),
                },
            },
            paths: LocalTrellisBootstrapPaths {
                nats_manifest: "nats/manifest.json".to_string(),
                trellis_config: "trellis/config.jsonc".to_string(),
                session_seed: "trellis/session.seed".to_string(),
                trellis_data: "trellis/data".to_string(),
            },
            urls: LocalTrellisBootstrapUrls {
                public_origin: "http://127.0.0.1:49111".to_string(),
                nats_server: "nats://127.0.0.1:49112".to_string(),
                nats_websocket: "ws://127.0.0.1:49113".to_string(),
                oauth_redirect_base: "http://127.0.0.1:49111/auth/callback".to_string(),
            },
        }
    }

    fn account(name: &str, public_key: &str) -> PublicAccount {
        PublicAccount {
            name: name.to_string(),
            public_key: public_key.to_string(),
        }
    }

    fn user(name: &str, public_key: &str) -> PublicUser {
        PublicUser {
            name: name.to_string(),
            public_key: public_key.to_string(),
        }
    }
}
