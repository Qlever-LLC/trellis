use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use futures_util::StreamExt;
use trellis_client::{verify_proof, OperationDescriptor, SessionAuth, TrellisClient};

use serde::Serialize;

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
    assert!(
        output.status.success(),
        "runtime command failed: {} {}\nstdout: {}\nstderr: {}",
        runtime,
        args.join(" "),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
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
    let name = format!("trellis-transfer-it-{}-{}", std::process::id(), now);

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

fn test_auth() -> SessionAuth {
    SessionAuth::from_seed_base64url("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        .expect("session auth")
}

#[derive(Debug, Clone, Serialize)]
struct UploadInput {
    key: String,
}

struct UploadOperation;

impl OperationDescriptor for UploadOperation {
    type Input = UploadInput;
    type Progress = serde_json::Value;
    type Output = serde_json::Value;

    const KEY: &'static str = "Demo.Files.Upload";
    const SUBJECT: &'static str = "operations.v1.Demo.Files.Upload";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["uploader"];
    const READ_CAPABILITIES: &'static [&'static str] = &["uploader"];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}

#[tokio::test]
#[ignore = "needs podman/docker runtime"]
async fn transfer_put_and_get_use_raw_chunk_transport() {
    let (_container, server) = start_nats_container();

    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let auth = test_auth();
    let client = TrellisClient::from_native(requester_client, auth, 2_000);
    let session_key = client.auth().session_key.clone();

    let operation_subject = UploadOperation::SUBJECT;
    let upload_subject = "transfer.v1.upload.test.tx1";

    let mut operation_sub = service_client
        .subscribe(operation_subject.to_string())
        .await
        .expect("subscribe operation subject");
    service_client
        .flush()
        .await
        .expect("flush operation subscription");
    let service_for_operation = service_client.clone();
    let accepted_session_key = session_key.clone();
    tokio::spawn(async move {
        let msg = operation_sub.next().await.expect("operation start message");
        let reply = msg.reply.clone().expect("operation reply subject");
        let payload = serde_json::to_vec(&serde_json::json!({
            "kind": "accepted",
            "ref": {
                "id": "op_123",
                "service": "files",
                "operation": "Demo.Files.Upload"
            },
            "snapshot": {
                "revision": 1,
                "state": "pending"
            },
            "transfer": {
                "type": "TransferGrant",
                "kind": "upload",
                "service": "files",
                "sessionKey": accepted_session_key,
                "transferId": "tx1",
                "subject": upload_subject,
                "expiresAt": "2099-01-01T00:00:00.000Z",
                "chunkBytes": 6,
                "maxBytes": 1024
            }
        }))
        .unwrap();
        service_for_operation
            .publish(reply, Bytes::from(payload))
            .await
            .expect("publish accepted envelope");
    });

    let upload_session_key = session_key.clone();
    let mut upload_sub = service_client
        .subscribe(upload_subject.to_string())
        .await
        .expect("subscribe upload subject");
    service_client
        .flush()
        .await
        .expect("flush upload subscription");
    let service_for_upload = service_client.clone();
    let upload_task = tokio::spawn(async move {
        let expected = [b"hello ".as_slice(), b"world".as_slice(), b"".as_slice()];
        for (seq, expected_chunk) in expected.iter().enumerate() {
            let msg = upload_sub.next().await.expect("upload message");
            let headers = msg.headers.as_ref().expect("upload headers");
            assert_eq!(
                headers.get("session-key").unwrap().as_str(),
                upload_session_key
            );
            let proof = headers.get("proof").unwrap().as_str();
            assert!(
                verify_proof(&upload_session_key, upload_subject, &msg.payload, proof)
                    .expect("verify proof")
            );
            assert_eq!(
                headers.get("trellis-transfer-seq").unwrap().as_str(),
                seq.to_string()
            );
            assert_eq!(&msg.payload[..], *expected_chunk);

            let reply = msg.reply.clone().expect("upload reply subject");
            let payload = if seq == 2 {
                serde_json::to_vec(&serde_json::json!({
                    "status": "complete",
                    "info": {
                        "key": "incoming/test.txt",
                        "size": 11,
                        "updatedAt": "2026-04-12T00:00:00.000Z",
                        "digest": "sha256:test",
                        "contentType": "text/plain",
                        "metadata": {}
                    }
                }))
                .unwrap()
            } else {
                serde_json::to_vec(&serde_json::json!({ "status": "continue" })).unwrap()
            };

            service_for_upload
                .publish(reply, Bytes::from(payload))
                .await
                .expect("publish upload ack");
        }
    });

    let operation = client
        .operation::<UploadOperation>()
        .start(&UploadInput {
            key: "incoming/test.txt".into(),
        })
        .await
        .expect("operation start succeeds");

    let uploaded = operation
        .transfer("hello world".as_bytes())
        .await
        .expect("upload succeeds");
    assert_eq!(uploaded.key, "incoming/test.txt");
    assert_eq!(uploaded.size, 11);

    upload_task.await.expect("upload task joins");
}
