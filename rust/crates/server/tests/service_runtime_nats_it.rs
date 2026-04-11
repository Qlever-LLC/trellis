use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_nats::header::HeaderMap;
use bytes::Bytes;
use futures_util::future::{ready, BoxFuture, FutureExt};
use serde::{Deserialize, Serialize};
use trellis_server::{
    bootstrap_and_run_single_subject_service, bootstrap_service_host, run_single_subject_service,
    BootstrapBinding, RequestContext, RequestValidator, Router, RpcDescriptor, ServerError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PingInput {
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PingOutput {
    echoed: String,
}

struct PingRpc;

impl RpcDescriptor for PingRpc {
    type Input = PingInput;
    type Output = PingOutput;
    const KEY: &'static str = "Ping";
    const SUBJECT: &'static str = "rpc.v1.Ping";
}

struct AllowValidator;

impl RequestValidator for AllowValidator {
    fn validate<'a>(
        &'a self,
        _subject: &'a str,
        _payload: &'a Bytes,
        _context: &'a RequestContext,
    ) -> BoxFuture<'a, Result<bool, ServerError>> {
        ready(Ok(true)).boxed()
    }
}

fn matching_binding() -> BootstrapBinding {
    BootstrapBinding {
        contract_id: "trellis.jobs@v1".to_string(),
        digest: "sha256:expected".to_string(),
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
        if Command::new(runtime)
            .arg("--version")
            .status()
            .ok()?
            .success()
        {
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
        .expect("clock after epoch")
        .as_nanos();
    let name = format!("trellis-runtime-it-{}-{}", std::process::id(), now);

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
        .expect("port output should include ':'")
        .trim()
        .to_string();

    (
        RuntimeContainer {
            runtime: runtime.to_string(),
            name,
        },
        format!("127.0.0.1:{host_port}"),
    )
}

async fn connect_with_retry(server: &str) -> async_nats::Client {
    for _ in 0..30 {
        if let Ok(client) = async_nats::connect(server).await {
            return client;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    panic!("failed to connect to nats server {server}");
}

fn make_ping_router() -> Router {
    let mut router = Router::new();
    router.register_rpc::<PingRpc, _, _>(|_ctx, input| async move {
        Ok(PingOutput {
            echoed: input.value,
        })
    });
    router
}

#[tokio::test]
#[ignore = "needs podman/docker runtime"]
async fn run_single_subject_service_handles_authenticated_rpc() {
    let (_container, server) = start_nats_container();

    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;

    let router = make_ping_router();

    let host = bootstrap_service_host("jobs-service", matching_binding(), router, AllowValidator);

    let loop_task = tokio::spawn(run_single_subject_service(
        service_client.clone(),
        PingRpc::SUBJECT,
        host,
    ));
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");

    let response = requester_client
        .request_with_headers(
            PingRpc::SUBJECT.to_string(),
            headers,
            Bytes::from_static(br#"{"value":"hello"}"#),
        )
        .await
        .expect("request should get reply");

    let payload: PingOutput = serde_json::from_slice(&response.payload).expect("decode payload");
    assert_eq!(
        payload,
        PingOutput {
            echoed: "hello".to_string(),
        }
    );

    loop_task.abort();
    let _ = loop_task.await;
}

#[tokio::test]
#[ignore = "needs podman/docker runtime"]
async fn bootstrap_and_run_single_subject_service_handles_authenticated_rpc() {
    let (_container, server) = start_nats_container();

    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let loop_task = tokio::spawn(async move {
        bootstrap_and_run_single_subject_service(
            service_client.clone(),
            "jobs-service",
            matching_binding(),
            PingRpc::SUBJECT,
            make_ping_router(),
            AllowValidator,
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    let mut headers = HeaderMap::new();
    headers.insert("session-key", "svc_session");
    headers.insert("proof", "proof");
    let response = requester_client
        .request_with_headers(
            PingRpc::SUBJECT.to_string(),
            headers,
            Bytes::from_static(br#"{"value":"hello"}"#),
        )
        .await
        .expect("request should get reply");

    let payload: PingOutput = serde_json::from_slice(&response.payload).expect("decode payload");
    assert_eq!(
        payload,
        PingOutput {
            echoed: "hello".to_string(),
        }
    );

    loop_task.abort();
    let _ = loop_task.await;
}
