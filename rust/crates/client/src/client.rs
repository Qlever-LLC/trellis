use async_nats::header::HeaderMap;
use async_nats::ConnectOptions;
use bytes::Bytes;
use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use nkeys::KeyPair;
use serde_json::Value;
use tokio::time::timeout;

use crate::operations::{OperationDescriptor, OperationInvoker, OperationTransport};
use crate::proof::now_iat_seconds;
use crate::transfer::{put_upload_grant, FileInfo, UploadTransferGrant};
use crate::{EventDescriptor, RpcDescriptor, SessionAuth, TrellisClientError};

/// Connection options for a Trellis service/session-key principal.
pub struct ServiceConnectOptions<'a> {
    pub servers: &'a str,
    pub sentinel_creds_path: &'a str,
    pub session_key_seed_base64url: &'a str,
    pub timeout_ms: u64,
}

/// Connection options for a user/session-key principal.
pub struct UserConnectOptions<'a> {
    pub servers: &'a str,
    pub sentinel_jwt: &'a str,
    pub sentinel_seed: &'a str,
    pub session_key_seed_base64url: &'a str,
    pub contract_digest: &'a str,
    pub timeout_ms: u64,
}

/// A low-level Trellis client over NATS request/reply and publish primitives.
pub struct TrellisClient {
    nats: async_nats::Client,
    auth: SessionAuth,
    timeout_ms: u64,
}

impl TrellisClient {
    /// Construct a client from an existing NATS connection and session auth.
    pub fn from_native(nats: async_nats::Client, auth: SessionAuth, timeout_ms: u64) -> Self {
        Self {
            nats,
            auth,
            timeout_ms,
        }
    }

    /// Expose the underlying NATS client for advanced use.
    pub fn nats(&self) -> &async_nats::Client {
        &self.nats
    }

    /// Return the session auth helper used by this client.
    pub fn auth(&self) -> &SessionAuth {
        &self.auth
    }

    /// Return the request timeout configured for this client.
    pub fn timeout_ms(&self) -> u64 {
        self.timeout_ms
    }

    /// Connect using sentinel credentials plus an `iat`-based service token.
    pub async fn connect_service(
        opts: ServiceConnectOptions<'_>,
    ) -> Result<Self, TrellisClientError> {
        let auth = SessionAuth::from_seed_base64url(opts.session_key_seed_base64url)?;
        let token = auth.nats_connect_token(now_iat_seconds());
        let inbox_prefix = auth.inbox_prefix();

        let nats = ConnectOptions::new()
            .credentials(opts.sentinel_creds_path)?
            .token(token)
            .custom_inbox_prefix(inbox_prefix)
            .connect(opts.servers)
            .await
            .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?;

        Ok(Self {
            nats,
            auth,
            timeout_ms: opts.timeout_ms,
        })
    }

    /// Connect using reconnect-safe session-key runtime auth for one contract digest.
    pub async fn connect_user(opts: UserConnectOptions<'_>) -> Result<Self, TrellisClientError> {
        let auth = SessionAuth::from_seed_base64url(opts.session_key_seed_base64url)?;
        let inbox_prefix = auth.inbox_prefix();
        let callback_auth = std::sync::Arc::new(SessionAuth::from_seed_base64url(
            opts.session_key_seed_base64url,
        )?);
        let key_pair = std::sync::Arc::new(
            KeyPair::from_seed(opts.sentinel_seed)
                .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?,
        );
        let sentinel_jwt = opts.sentinel_jwt.to_string();
        let contract_digest = opts.contract_digest.to_string();

        let nats = ConnectOptions::with_auth_callback(move |nonce| {
            let auth = callback_auth.clone();
            let key_pair = key_pair.clone();
            let sentinel_jwt = sentinel_jwt.clone();
            let contract_digest = contract_digest.clone();
            async move {
                let mut credentials = async_nats::Auth::new();
                credentials.jwt = Some(sentinel_jwt);
                credentials.signature =
                    Some(key_pair.sign(&nonce).map_err(async_nats::AuthError::new)?);
                credentials.token =
                    Some(auth.nats_connect_user_token(now_iat_seconds(), &contract_digest));
                Ok(credentials)
            }
        })
        .custom_inbox_prefix(inbox_prefix)
        .connect(opts.servers)
        .await
        .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?;

        Ok(Self {
            nats,
            auth,
            timeout_ms: opts.timeout_ms,
        })
    }

    async fn request(
        &self,
        subject: &str,
        payload: Bytes,
    ) -> Result<async_nats::Message, TrellisClientError> {
        let proof = self.auth.create_proof(subject, &payload);

        let mut headers = HeaderMap::new();
        headers.insert("session-key", self.auth.session_key.as_str());
        headers.insert("proof", proof.as_str());

        let future = self
            .nats
            .request_with_headers(subject.to_string(), headers, payload);
        let message = timeout(std::time::Duration::from_millis(self.timeout_ms), future)
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        Ok(message)
    }

    async fn request_json(&self, subject: &str, body: Value) -> Result<Value, TrellisClientError> {
        let payload = Bytes::from(serde_json::to_vec(&body)?);
        let message = self.request(subject, payload).await?;

        decode_json_message(message)
    }

    /// Call a raw subject with a JSON value payload.
    pub async fn request_json_value(
        &self,
        subject: &str,
        body: &Value,
    ) -> Result<Value, TrellisClientError> {
        self.request_json(subject, body.clone()).await
    }

    /// Call one descriptor-backed RPC.
    pub async fn call<D>(&self, input: &D::Input) -> Result<D::Output, TrellisClientError>
    where
        D: RpcDescriptor,
    {
        let value = serde_json::to_value(input)?;
        let response = self.request_json(D::SUBJECT, value).await?;
        Ok(serde_json::from_value(response)?)
    }

    /// Publish one descriptor-backed event.
    pub async fn publish<D>(&self, event: &D::Event) -> Result<(), TrellisClientError>
    where
        D: EventDescriptor,
    {
        let payload = Bytes::from(serde_json::to_vec(event)?);
        self.nats
            .publish(D::SUBJECT.to_string(), payload)
            .await
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        Ok(())
    }

    /// Start or control one descriptor-backed operation.
    pub fn operation<D>(&self) -> OperationInvoker<'_, Self, D>
    where
        D: OperationDescriptor,
    {
        OperationInvoker::new(self)
    }
}

impl OperationTransport for TrellisClient {
    async fn request_json_value(
        &self,
        subject: String,
        body: Value,
    ) -> Result<Value, TrellisClientError> {
        TrellisClient::request_json_value(self, &subject, &body).await
    }

    async fn watch_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> Result<BoxStream<'a, Result<Value, TrellisClientError>>, TrellisClientError> {
        let payload = Bytes::from(serde_json::to_vec(&body)?);
        let proof = self.auth.create_proof(&subject, &payload);

        let mut headers = HeaderMap::new();
        headers.insert("session-key", self.auth.session_key.as_str());
        headers.insert("proof", proof.as_str());

        let inbox = self.nats.new_inbox();
        let subscriber = timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats.subscribe(inbox.clone()),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats
                .publish_with_reply_and_headers(subject, inbox, headers, payload),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        let stream = stream::try_unfold((subscriber, false), |(mut subscriber, done)| async move {
            if done {
                return Ok(None);
            }

            match subscriber.next().await {
                Some(message) => {
                    let event = decode_watch_message(message)?;
                    let terminal = is_terminal_event(&event);
                    Ok(Some((event, (subscriber, terminal))))
                }
                None => Ok(None),
            }
        });

        Ok(Box::pin(stream) as BoxStream<'a, Result<Value, TrellisClientError>>)
    }

    async fn put_upload_transfer<'a>(
        &'a self,
        grant: UploadTransferGrant,
        body: Vec<u8>,
    ) -> Result<FileInfo, TrellisClientError> {
        put_upload_grant(self, &grant, body).await
    }
}

fn decode_json_message(message: async_nats::Message) -> Result<Value, TrellisClientError> {
    if let Some(headers) = &message.headers {
        if headers
            .get("status")
            .is_some_and(|status| status.as_str() == "error")
        {
            let value: Value = serde_json::from_slice(&message.payload)?;
            return Err(TrellisClientError::RpcError(value.to_string()));
        }
    }

    Ok(serde_json::from_slice(&message.payload)?)
}

fn decode_watch_message(message: async_nats::Message) -> Result<Value, TrellisClientError> {
    decode_json_message(message)
}

fn is_terminal_event(event: &Value) -> bool {
    matches!(
        event.get("type").and_then(Value::as_str),
        Some("completed" | "failed" | "cancelled")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use futures_util::StreamExt;
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use std::process::Command;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use crate::control_subject;
    use crate::operations::OperationEvent;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundInput {
        charge_id: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundProgress {
        message: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundOutput {
        refund_id: String,
    }

    struct RefundOperation;

    impl OperationDescriptor for RefundOperation {
        type Input = RefundInput;
        type Progress = RefundProgress;
        type Output = RefundOutput;

        const KEY: &'static str = "Billing.Refund";
        const SUBJECT: &'static str = "operations.v1.Billing.Refund";
        const CALLER_CAPABILITIES: &'static [&'static str] = &["billing.refund"];
        const READ_CAPABILITIES: &'static [&'static str] = &["billing.read"];
        const CANCEL_CAPABILITIES: &'static [&'static str] = &["billing.cancel"];
        const CANCELABLE: bool = true;
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
        let name = format!("trellis-client-watch-it-{}-{}", std::process::id(), now);

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
        SessionAuth::from_seed_base64url(&crate::proof::base64url_encode(&[7u8; 32]))
            .expect("session auth")
    }

    #[tokio::test]
    #[ignore = "needs podman/docker runtime"]
    async fn watch_stream_uses_reply_subject_and_stops_after_terminal_event() {
        let (_container, server) = start_nats_container();

        let service_client = connect_with_retry(&server).await;
        let requester_client = connect_with_retry(&server).await;
        let auth = test_auth();
        let client = TrellisClient::from_native(requester_client, auth, 2_000);

        let mut start_sub = service_client
            .subscribe(RefundOperation::SUBJECT.to_string())
            .await
            .expect("subscribe start subject");
        let mut control_sub = service_client
            .subscribe(control_subject(RefundOperation::SUBJECT))
            .await
            .expect("subscribe control subject");

        let service_for_start = service_client.clone();
        let start_task = tokio::spawn(async move {
            if let Some(msg) = start_sub.next().await {
                let body: Value = serde_json::from_slice(&msg.payload).expect("start request json");
                assert_eq!(body["charge_id"], "ch_123");
                let accepted = json!({
                    "kind": "accepted",
                    "ref": {
                        "id": "op_123",
                        "service": "billing",
                        "operation": "Billing.Refund"
                    },
                    "snapshot": {
                        "revision": 1,
                        "state": "pending"
                    }
                });
                let reply = msg.reply.as_ref().expect("start reply subject").clone();
                service_for_start
                    .publish(
                        reply,
                        Bytes::from(serde_json::to_vec(&accepted).expect("serialize accepted")),
                    )
                    .await
                    .expect("publish accepted reply");
            }
        });

        let service_for_control = service_client.clone();
        let control_task = tokio::spawn(async move {
            if let Some(msg) = control_sub.next().await {
                let body: Value =
                    serde_json::from_slice(&msg.payload).expect("control request json");
                assert_eq!(body["action"], "watch");
                assert_eq!(body["operationId"], "op_123");

                let reply = msg.reply.as_ref().expect("watch reply subject").clone();
                let frames = [
                    json!({
                        "kind": "snapshot",
                        "snapshot": {
                            "revision": 2,
                            "state": "running",
                            "progress": {
                                "message": "working"
                            }
                        }
                    }),
                    json!({
                        "kind": "event",
                        "event": {
                            "type": "progress",
                            "snapshot": {
                                "revision": 3,
                                "state": "running",
                                "progress": {
                                    "message": "almost there"
                                }
                            }
                        }
                    }),
                    json!({"kind": "keepalive"}),
                    json!({
                        "kind": "event",
                        "event": {
                            "type": "completed",
                            "snapshot": {
                                "revision": 4,
                                "state": "completed",
                                "output": {
                                    "refund_id": "rf_123"
                                }
                            }
                        }
                    }),
                    json!({
                        "kind": "event",
                        "event": {
                            "type": "progress",
                            "snapshot": {
                                "revision": 5,
                                "state": "running",
                                "progress": {
                                    "message": "ignored"
                                }
                            }
                        }
                    }),
                ];

                for frame in frames {
                    service_for_control
                        .publish(
                            reply.clone(),
                            Bytes::from(serde_json::to_vec(&frame).expect("serialize frame")),
                        )
                        .await
                        .expect("publish watch frame");
                }
            }
        });

        tokio::time::sleep(Duration::from_millis(100)).await;

        let operation = client
            .operation::<RefundOperation>()
            .start(&RefundInput {
                charge_id: "ch_123".to_string(),
            })
            .await
            .expect("start should succeed");
        let stream = operation.watch().await.expect("watch should succeed");
        let events: Vec<_> = stream.collect().await;

        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], Ok(OperationEvent::Started { .. })));
        assert!(matches!(events[1], Ok(OperationEvent::Progress { .. })));
        assert!(matches!(events[2], Ok(OperationEvent::Completed { .. })));

        start_task.await.expect("start task should complete");
        control_task.await.expect("control task should complete");
    }
}
