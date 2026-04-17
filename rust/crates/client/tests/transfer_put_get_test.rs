use std::collections::BTreeMap;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_nats::header::HeaderMap;
use bytes::Bytes;
use futures_util::StreamExt;
use trellis_client::{
    verify_proof, DownloadTransferGrant, FileInfo, SessionAuth, TrellisClient, UploadTransferGrant,
};

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

#[tokio::test]
#[ignore = "needs podman/docker runtime"]
async fn transfer_put_and_get_use_raw_chunk_transport() {
    let (_container, server) = start_nats_container();

    let service_client = connect_with_retry(&server).await;
    let requester_client = connect_with_retry(&server).await;
    let auth = test_auth();
    let client = TrellisClient::from_native(requester_client, auth, 2_000);
    let session_key = client.auth().session_key.clone();

    let upload_subject = "transfer.v1.upload.test.tx1";
    let download_subject = "transfer.v1.download.test.tx2";
    let upload_grant = UploadTransferGrant {
        type_name: "TransferGrant".into(),
        kind: "upload".into(),
        service: "files".into(),
        session_key: client.auth().session_key.clone(),
        transfer_id: "tx1".into(),
        subject: upload_subject.into(),
        expires_at: "2099-01-01T00:00:00.000Z".into(),
        chunk_bytes: 6,
        max_bytes: Some(1024),
        content_type: None,
        metadata: None,
    };
    let download_grant = DownloadTransferGrant {
        type_name: "TransferGrant".into(),
        kind: "download".into(),
        service: "files".into(),
        session_key: client.auth().session_key.clone(),
        transfer_id: "tx2".into(),
        subject: download_subject.into(),
        expires_at: "2099-01-01T00:00:00.000Z".into(),
        chunk_bytes: 6,
        info: FileInfo {
            key: "incoming/test.txt".into(),
            size: 11,
            updated_at: "2026-04-12T00:00:00.000Z".into(),
            digest: Some("sha256:test".into()),
            content_type: Some("text/plain".into()),
            metadata: BTreeMap::new(),
        },
    };

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

    let uploaded = client
        .transfer(upload_grant)
        .put("hello world".as_bytes())
        .await
        .expect("upload succeeds");
    assert_eq!(uploaded.key, "incoming/test.txt");
    assert_eq!(uploaded.size, 11);

    let download_session_key = session_key.clone();
    let mut download_sub = service_client
        .subscribe(download_subject.to_string())
        .await
        .expect("subscribe download subject");
    service_client
        .flush()
        .await
        .expect("flush download subscription");
    let service_for_download = service_client.clone();
    let download_task = tokio::spawn(async move {
        let msg = download_sub.next().await.expect("download request");
        let reply = msg.reply.clone().expect("download reply subject");
        let headers = msg.headers.as_ref().expect("download headers");
        assert_eq!(
            headers.get("session-key").unwrap().as_str(),
            download_session_key
        );
        let proof = headers.get("proof").unwrap().as_str();
        assert!(
            verify_proof(&download_session_key, download_subject, &msg.payload, proof)
                .expect("verify proof")
        );

        for (seq, chunk) in [b"hello ".as_slice(), b"world".as_slice()]
            .into_iter()
            .enumerate()
        {
            let mut headers = HeaderMap::new();
            headers.insert("trellis-transfer-seq", seq.to_string().as_str());
            service_for_download
                .publish_with_headers(reply.clone(), headers, Bytes::copy_from_slice(chunk))
                .await
                .expect("publish download chunk");
        }

        let mut final_headers = HeaderMap::new();
        final_headers.insert("trellis-transfer-seq", "2");
        final_headers.insert("trellis-transfer-eof", "true");
        service_for_download
            .publish_with_headers(reply, final_headers, Bytes::new())
            .await
            .expect("publish eof");
    });

    let downloaded = client
        .transfer(download_grant)
        .get_bytes()
        .await
        .expect("download succeeds");
    assert_eq!(downloaded, b"hello world");

    upload_task.await.expect("upload task joins");
    download_task.await.expect("download task joins");
}
