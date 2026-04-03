use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_nats::header::HeaderMap;
use bytes::Bytes;
use futures_util::future::{BoxFuture, FutureExt};
use trellis_server::{run_nats_request_loop, RequestContext, RequestHandler, ServerError};

struct IntegrationHandler;

impl RequestHandler for IntegrationHandler {
    fn handle<'a>(
        &'a self,
        _subject: &'a str,
        payload: Bytes,
        _context: RequestContext,
    ) -> BoxFuture<'a, Result<Bytes, ServerError>> {
        async move {
            let request: serde_json::Value = serde_json::from_slice(&payload)?;
            if request
                .get("mode")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|mode| mode == "fail")
            {
                return Err(ServerError::RequestDenied {
                    subject: "rpc.v1.Test.Health".to_string(),
                    session_key: "svc_session".to_string(),
                });
            }

            Ok(Bytes::from_static(br#"{"status":"ok"}"#))
        }
        .boxed()
    }
}

struct RuntimeContainer {
    runtime: String,
    name: String,
}

impl Drop for RuntimeContainer {
    fn drop(&mut self) {
        let _ = Command::new(&self.runtime)
            .args(["rm", "-f", &self.name])
            .output();
    }
}

fn detect_runtime() -> Option<&'static str> {
    for runtime in ["podman", "docker"] {
        let status = Command::new(runtime).arg("--version").status().ok()?;
        if status.success() {
            return Some(runtime);
        }
    }
    None
}

fn run_command(runtime: &str, args: &[&str]) -> String {
    let output = Command::new(runtime)
        .args(args)
        .output()
        .expect("runtime command should execute");
    if !output.status.success() {
        panic!(
            "runtime command failed: {} {}\nstdout: {}\nstderr: {}",
            runtime,
            args.join(" "),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }
    String::from_utf8(output.stdout)
        .expect("stdout should be utf-8")
        .trim()
        .to_string()
}

fn start_nats_container() -> (RuntimeContainer, String) {
    let runtime = detect_runtime().expect("podman or docker runtime is required");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    let name = format!("trellis-nats-it-{}-{}", std::process::id(), now);

    run_command(
        runtime,
        &[
            "run",
            "-d",
            "--rm",
            "--name",
            &name,
            "-p",
            "127.0.0.1::4222",
            "docker.io/library/nats:2.10-alpine",
        ],
    );

    let mapping = run_command(runtime, &["port", &name, "4222/tcp"]);
    let host_port = mapping
        .split(':')
        .next_back()
        .expect("port mapping should include ':'")
        .trim()
        .to_string();
    let server = format!("127.0.0.1:{}", host_port);

    (
        RuntimeContainer {
            runtime: runtime.to_string(),
            name,
        },
        server,
    )
}

async fn connect_with_retry(server: &str) -> async_nats::Client {
    let mut last_error = None;
    for _ in 0..30 {
        match async_nats::connect(server).await {
            Ok(client) => return client,
            Err(error) => {
                last_error = Some(error.to_string());
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }

    panic!(
        "failed to connect to nats server {}: {}",
        server,
        last_error.unwrap_or_else(|| "unknown error".to_string())
    );
}

async fn request_with_retry(
    client: &async_nats::Client,
    subject: &str,
    headers: HeaderMap,
    payload: Bytes,
) -> async_nats::Message {
    let mut last_error = None;
    for _ in 0..20 {
        match client
            .request_with_headers(subject.to_string(), headers.clone(), payload.clone())
            .await
        {
            Ok(message) => return message,
            Err(error) if error.to_string().contains("no responders") => {
                last_error = Some(error.to_string());
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(error) => panic!("request failed unexpectedly: {error}"),
        }
    }

    panic!(
        "request failed after retries: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    );
}

#[tokio::test]
#[ignore = "needs podman/docker runtime"]
async fn run_nats_request_loop_replies_success_and_error_over_nats() {
    let (_container, server) = start_nats_container();

    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let subscriber = service_client
        .subscribe("rpc.v1.Test.Health".to_string())
        .await
        .expect("subscribe should succeed");

    let loop_task = tokio::spawn(run_nats_request_loop(
        service_client.clone(),
        subscriber,
        IntegrationHandler,
    ));

    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");

    let success = request_with_retry(
        &requester_client,
        "rpc.v1.Test.Health",
        headers.clone(),
        Bytes::from_static(br#"{"mode":"ok"}"#),
    )
    .await;

    assert_eq!(success.payload, Bytes::from_static(br#"{"status":"ok"}"#));
    let success_status = success
        .headers
        .as_ref()
        .and_then(|map| map.get("status"))
        .map(|value| value.as_str().to_string());
    assert_ne!(success_status.as_deref(), Some("error"));

    let failure = request_with_retry(
        &requester_client,
        "rpc.v1.Test.Health",
        headers,
        Bytes::from_static(br#"{"mode":"fail"}"#),
    )
    .await;

    let failure_status = failure
        .headers
        .as_ref()
        .and_then(|map| map.get("status"))
        .map(|value| value.as_str().to_string());
    assert_eq!(failure_status.as_deref(), Some("error"));

    let body: serde_json::Value =
        serde_json::from_slice(&failure.payload).expect("error payload should be json");
    assert!(body
        .get("error")
        .and_then(serde_json::Value::as_str)
        .is_some());

    loop_task.abort();
    let _ = loop_task.await;
}
