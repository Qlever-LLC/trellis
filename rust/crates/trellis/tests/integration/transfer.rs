use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::stream::{self, BoxStream};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::task::JoinHandle;
use trellis_rs::client::OperationState as ClientOpState;
use trellis_rs::client::{OperationDescriptor, TransferOperationDescriptor};
use trellis_rs::service::StoreResourceClient;
use trellis_rs::service::{
    AcceptedOperation, DefaultRequestValidator, FileTransferInfo, GeneratedServiceContract,
    OperationRefData, OperationSnapshot, OperationState as ServiceOpState, ServerError,
    ServiceHandlerContext, ServiceRuntimeError, TransferDownloadGrantArgs, TransferUploadGrantArgs,
    UploadTransferCompletion, UploadTransferSession,
};

use crate::support::assertions::assert_case_registered;

const TRANSFER_SERVICE_ID: &str = "trellis.integration.transfer-service@v1";
const TRANSFER_CLIENT_ID: &str = "trellis.integration.transfer-client@v1";

const TRANSFER_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.transfer-service@v1",
  "displayName": "Trellis Integration Transfer Service",
  "description": "Exercises generated operation and RPC transfer surfaces.",
  "kind": "service",
  "schemas": {
    "DownloadGrant": {
      "properties": {
        "chunkBytes": { "type": "integer" },
        "direction": { "type": "string" },
        "expiresAt": { "type": "string" },
        "info": {
          "properties": {
            "contentType": { "type": "string" },
            "key": { "type": "string" },
            "metadata": { "type": "object" },
            "size": { "type": "integer" },
            "updatedAt": { "type": "string" }
          },
          "type": "object"
        },
        "sessionKey": { "type": "string" },
        "service": { "type": "string" },
        "subject": { "type": "string" },
        "transferId": { "type": "string" },
        "type": { "type": "string" }
      },
      "type": "object"
    },
    "DownloadInput": {
      "properties": { "key": { "type": "string" } },
      "required": ["key"],
      "type": "object"
    },
    "UploadInput": {
      "properties": {
        "contentType": { "type": "string" },
        "key": { "type": "string" }
      },
      "required": ["key"],
      "type": "object"
    },
    "UploadOutput": {
      "properties": {
        "contentType": { "type": "string" },
        "key": { "type": "string" },
        "size": { "type": "integer" }
      },
      "required": ["key", "size"],
      "type": "object"
    }
  },
  "uses": {
    "required": {
      "health": {
        "contract": "trellis.health@v1",
        "events": { "publish": ["Health.Heartbeat"] }
      }
    }
  },
  "resources": {
    "store": {
      "uploads": {
        "purpose": "Temporary integration transfer files",
        "required": true,
        "ttlMs": 0,
        "maxObjectBytes": 1048576,
        "maxTotalBytes": 4194304
      }
    }
  },
  "operations": {
    "Files.Upload": {
      "version": "v1",
      "subject": "operations.v1.Files.Upload",
      "input": { "schema": "UploadInput" },
      "output": { "schema": "UploadOutput" },
      "transfer": {
        "direction": "send",
        "store": "uploads",
        "key": "/key",
        "contentType": "/contentType",
        "expiresInMs": 60000,
        "maxBytes": 1048576
      },
      "capabilities": { "call": [], "observe": [], "cancel": [] },
      "cancel": false
    }
  },
  "rpc": {
    "Files.Download": {
      "version": "v1",
      "subject": "rpc.v1.Files.Download",
      "input": { "schema": "DownloadInput" },
      "output": { "schema": "DownloadGrant" },
      "transfer": { "direction": "receive" },
      "capabilities": { "call": [] },
      "errors": []
    }
  }
}"#;

struct TransferServiceContract;

impl GeneratedServiceContract for TransferServiceContract {
    const CONTRACT_ID: &'static str = TRANSFER_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "O8f4jzJ7FeuNJrP6TYd-8M0v2yVZUPo2x9h398TsXzA";
    const CONTRACT_JSON: &'static str = TRANSFER_SERVICE_CONTRACT_JSON;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct UploadInput {
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct UploadOutput {
    key: String,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DownloadInput {
    key: String,
}

struct FilesUploadOp;

impl trellis_rs::client::OperationDescriptor for FilesUploadOp {
    type Input = UploadInput;
    type Progress = Value;
    type Output = UploadOutput;
    type Error = trellis_rs::service::OperationFailure;

    const KEY: &'static str = "Files.Upload";
    const SUBJECT: &'static str = "operations.v1.Files.Upload";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["key"],"properties":{"key":{"type":"string"},"contentType":{"type":"string"}}}"#;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> = None;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["key","size"],"properties":{"key":{"type":"string"},"size":{"type":"integer"},"contentType":{"type":"string"}}}"#;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = "{}";
}

impl TransferOperationDescriptor for FilesUploadOp {}

struct FilesDownloadRpc;

impl trellis_rs::client::RpcDescriptor for FilesDownloadRpc {
    type Input = DownloadInput;
    type Output = Value;

    const KEY: &'static str = "Files.Download";
    const SUBJECT: &'static str = "rpc.v1.Files.Download";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["key"],"properties":{"key":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object"}"#;
}

struct SharedOpState {
    snapshots: tokio::sync::Mutex<
        std::collections::HashMap<String, OperationSnapshot<Value, UploadOutput>>,
    >,
}

impl SharedOpState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshots: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }
}

fn now_iso() -> Result<String, ServerError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| ServerError::Nats(e.to_string()))
}

#[allow(dead_code)]
struct TransferFixture {
    runtime: trellis_test::TrellisTestRuntime,
    admin: trellis_test::TrellisTestAdmin,
    bootstrap_url: String,
    service_task: Option<JoinHandle<Result<(), ServiceRuntimeError>>>,
    client_contract: trellis_test::TrellisTestContract,
}

impl TransferFixture {
    async fn start() -> Self {
        let runtime = trellis_test::TrellisTestRuntime::start(
            trellis_test::TrellisTestRuntimeOptions::default(),
        )
        .await
        .expect("start live Trellis test runtime");
        let bootstrap_url = runtime
            .wait_for_bootstrap_url(Duration::from_secs(10))
            .await
            .expect("observe first admin bootstrap URL");
        let mut admin = runtime.admin();

        let service_contract =
            trellis_test::TrellisTestContract::from_manifest_json(TRANSFER_SERVICE_CONTRACT_JSON)
                .expect("build transfer service test contract");
        assert_eq!(
            service_contract.digest(),
            TransferServiceContract::CONTRACT_DIGEST
        );
        let client_contract =
            transfer_client_contract().expect("build transfer client test contract");

        let service_key = admin
            .provision_service_instance(&bootstrap_url, &service_contract, None, None)
            .await
            .expect("provision live transfer service instance");
        let mut service =
            trellis_rs::service::ConnectedServiceRuntime::<TransferServiceContract>::connect(
                runtime.service_connect_options("transfer-fixture-service", &service_key),
            )
            .await
            .expect("connect live Rust transfer service");

        let shared = SharedOpState::new();

        register_upload_handler(&mut service, Arc::clone(&shared));
        register_download_handler(&mut service);

        let service_task = tokio::spawn(async move { service.run().await });

        TransferFixture {
            runtime,
            admin,
            bootstrap_url,
            service_task: Some(service_task),
            client_contract,
        }
    }

    async fn connect_client(&mut self) -> trellis_rs::client::TrellisClient {
        self.admin
            .connect_client(&self.bootstrap_url, &self.client_contract)
            .await
            .expect("connect live Rust transfer client")
    }

    async fn shutdown(mut self) {
        if let Some(handle) = self.service_task.take() {
            handle.abort();
            let _ = handle.await;
        }
    }
}

fn register_upload_handler(
    service: &mut trellis_rs::service::ConnectedServiceRuntime<TransferServiceContract>,
    shared: Arc<SharedOpState>,
) {
    service.register_operation_with_watch::<FilesUploadOp, _, _, _, _, _, _, _>(
        {
            let shared = Arc::clone(&shared);
            move |context: ServiceHandlerContext, input: UploadInput| {
                let shared = Arc::clone(&shared);
                async move {
                    let caller_session_key =
                        context.request().session_key.clone().unwrap_or_default();
                    let handle = context.handle();
                    let client = Arc::clone(handle.client());
                    let service_session_key = client.auth().session_key.clone();
                    let service_name = handle.service_name().to_string();
                    let resources = handle.resources().clone();

                    let operation_id = format!("tx-upload-{}", input.key.replace(['/', '.'], "-"));
                    let transfer_id = format!("upload-{operation_id}");
                    let expires_at = (time::OffsetDateTime::now_utc() + time::Duration::minutes(5))
                        .format(&time::format_description::well_known::Rfc3339)
                        .map_err(|e| ServerError::Nats(e.to_string()))?;
                    let updated_at = now_iso()?;

                    let plan =
                        trellis_rs::service::plan_upload_transfer_grant(TransferUploadGrantArgs {
                            service_name: &service_name,
                            session_key: &caller_session_key,
                            service_session_key: &service_session_key,
                            resources: &resources,
                            store: "uploads",
                            key: &input.key,
                            transfer_id: &transfer_id,
                            expires_at: &expires_at,
                            chunk_bytes: 64 * 1024,
                            max_bytes: Some(1_048_576),
                            content_type: input.content_type.as_deref(),
                            metadata: BTreeMap::new(),
                        })
                        .map_err(|e| ServerError::Nats(e.to_string()))?;

                    let session = UploadTransferSession::new(plan.clone(), &updated_at);
                    let store = handle.store_client("uploads").await?;
                    let validator = DefaultRequestValidator::new(Arc::clone(&client));
                    let completion: UploadTransferCompletion = handle
                        .spawn_upload_transfer_endpoint_with_completion(session, store, validator)
                        .await?;

                    let initial_snapshot = OperationSnapshot {
                        revision: 1,
                        state: ServiceOpState::Pending,
                        ..Default::default()
                    };

                    shared
                        .snapshots
                        .lock()
                        .await
                        .insert(operation_id.clone(), initial_snapshot.clone());

                    let shared_clone = Arc::clone(&shared);
                    let op_id = operation_id.clone();
                    let completion_key = input.key.clone();
                    let completion_content_type = input.content_type.clone();

                    tokio::spawn(async move {
                        match completion.completed().await {
                            Ok(file_info) => {
                                let completed = OperationSnapshot {
                                    revision: 2,
                                    state: ServiceOpState::Completed,
                                    output: Some(UploadOutput {
                                        key: completion_key.clone(),
                                        size: file_info.size,
                                        content_type: completion_content_type.clone(),
                                    }),
                                    ..Default::default()
                                };
                                shared_clone
                                    .snapshots
                                    .lock()
                                    .await
                                    .insert(op_id.clone(), completed.clone());
                            }
                            Err(error) => {
                                let failed = OperationSnapshot {
                                    revision: 2,
                                    state: ServiceOpState::Failed,
                                    error: Some(trellis_rs::service::OperationError {
                                        error_type: "TransferError".to_string(),
                                        message: error.to_string(),
                                    }),
                                    ..Default::default()
                                };
                                shared_clone
                                    .snapshots
                                    .lock()
                                    .await
                                    .insert(op_id.clone(), failed.clone());
                            }
                        }
                    });

                    Ok(AcceptedOperation {
                        kind: "accepted".to_string(),
                        operation_ref: OperationRefData {
                            id: operation_id,
                            service: service_name,
                            operation: FilesUploadOp::KEY.to_string(),
                        },
                        snapshot: initial_snapshot,
                        transfer: Some(plan.grant),
                    })
                }
            }
        },
        {
            let shared = Arc::clone(&shared);
            move |_context: ServiceHandlerContext, operation_id: String| {
                let shared = Arc::clone(&shared);
                async move {
                    let snapshots = shared.snapshots.lock().await;
                    snapshots
                        .get(&operation_id)
                        .cloned()
                        .ok_or_else(|| ServerError::OperationNotFound { operation_id })
                }
            }
        },
        {
            let shared = Arc::clone(&shared);
            move |_context: ServiceHandlerContext, operation_id: String| {
                let shared = Arc::clone(&shared);
                let op_id = operation_id;
                let stream: BoxStream<
                    'static,
                    Result<OperationSnapshot<Value, UploadOutput>, ServerError>,
                > = Box::pin(stream::unfold(
                    (shared, op_id, 0u8),
                    |(shared, op_id, count)| async move {
                        let snapshot = shared
                            .snapshots
                            .lock()
                            .await
                            .get(&op_id)
                            .cloned()
                            .unwrap_or(OperationSnapshot {
                                revision: 0,
                                state: ServiceOpState::Pending,
                                ..Default::default()
                            });
                        let terminal = snapshot.state.is_terminal();
                        if count > 0 && !terminal {
                            tokio::time::sleep(Duration::from_millis(25)).await;
                        }
                        Some((Ok(snapshot), (shared, op_id, count + 1)))
                    },
                ));
                stream
            }
        },
        |_context: ServiceHandlerContext, _operation_id: String| async move {
            Err(ServerError::OperationUnsupportedControl {
                operation: FilesUploadOp::KEY.to_string(),
                action: "cancel".to_string(),
            })
        },
    );
}

fn register_download_handler(
    service: &mut trellis_rs::service::ConnectedServiceRuntime<TransferServiceContract>,
) {
    service.register_rpc::<FilesDownloadRpc, _, _>(move |context, input| async move {
        let handle = context.handle();
        let client = Arc::clone(handle.client());
        let service_session_key = client.auth().session_key.clone();
        let service_name = handle.service_name().to_string();
        let resources = handle.resources().clone();
        let caller_session_key = context.request().session_key.clone().unwrap_or_default();

        let payload = Bytes::from(format!("download:{}", input.key));
        let store = handle.store_client("uploads").await?;
        store.write(&input.key, payload.clone()).await?;

        let transfer_id = format!("download-{}", input.key.replace(['/', '.'], "-"));
        let expires_at = (time::OffsetDateTime::now_utc() + time::Duration::minutes(5))
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|e| ServerError::Nats(e.to_string()))?;
        let updated_at = now_iso()?;

        let plan = trellis_rs::service::plan_download_transfer_grant(TransferDownloadGrantArgs {
            service_name: &service_name,
            session_key: &caller_session_key,
            service_session_key: &service_session_key,
            resources: &resources,
            store: "uploads",
            transfer_id: &transfer_id,
            expires_at: &expires_at,
            chunk_bytes: 64 * 1024,
            info: FileTransferInfo {
                key: input.key.clone(),
                size: payload.len() as u64,
                updated_at,
                digest: None,
                content_type: Some("text/plain".to_string()),
                metadata: BTreeMap::new(),
            },
        })
        .map_err(|e| ServerError::Nats(e.to_string()))?;

        let validator = DefaultRequestValidator::new(Arc::clone(&client));
        handle
            .spawn_download_transfer_endpoint(plan.clone(), store, validator)
            .await?;

        let grant_value = serde_json::to_value(&plan.grant).map_err(ServerError::Json)?;
        Ok(grant_value)
    });
}

#[tokio::test]
async fn transfer_client_uploads_file_via_operation() {
    assert_case_registered(
        "transfer.client-uploads-file-via-operation",
        "transfer",
        "transfer",
    );

    let mut fixture = TransferFixture::start().await;
    let client = fixture.connect_client().await;

    let upload_bytes = Bytes::from_static(b"uploaded through transfer");
    let upload_input = UploadInput {
        key: "client/upload.txt".to_string(),
        content_type: Some("text/plain".to_string()),
    };
    let started_upload = start_upload_with_retry(&client, &upload_input, &upload_bytes).await;
    let file_info = started_upload.file_info();
    assert_eq!(file_info.key, "client/upload.txt");
    assert_eq!(file_info.size, upload_bytes.len() as u64);
    assert_eq!(file_info.content_type.as_deref(), Some("text/plain"));

    let operation_ref = started_upload.into_operation_ref();
    let final_snapshot = tokio::time::timeout(Duration::from_secs(15), operation_ref.wait())
        .await
        .expect("wait for upload operation completion timed out")
        .expect("wait for upload operation completion");
    assert_eq!(final_snapshot.state, ClientOpState::Completed);
    let output = final_snapshot
        .output
        .expect("upload operation should have output");
    assert_eq!(output.key, "client/upload.txt");
    assert_eq!(output.size, upload_bytes.len() as u64);
    assert_eq!(output.content_type.as_deref(), Some("text/plain"));

    fixture.shutdown().await;
}

#[tokio::test]
async fn transfer_client_downloads_file_via_receive_grant() {
    assert_case_registered(
        "transfer.client-downloads-file-via-receive-grant",
        "transfer",
        "transfer",
    );

    let mut fixture = TransferFixture::start().await;
    let client = fixture.connect_client().await;

    let download_key = "client/download.txt";
    let download_input = DownloadInput {
        key: download_key.to_string(),
    };
    let grant_value = call_download_with_retry(&client, &download_input).await;

    let download_grant = trellis_rs::client::download_transfer_grant_from_value(grant_value)
        .expect("parse download transfer grant");
    assert_eq!(download_grant.kind, "receive");
    assert_eq!(download_grant.info.key, download_key);
    assert_eq!(
        download_grant.info.content_type.as_deref(),
        Some("text/plain")
    );

    let downloaded = client
        .download_transfer(&download_grant)
        .await
        .expect("download transfer bytes");
    assert_eq!(
        String::from_utf8_lossy(&downloaded),
        format!("download:{download_key}")
    );

    fixture.shutdown().await;
}

#[tokio::test]
async fn transfer_download_grant_is_session_bound() {
    assert_case_registered(
        "transfer.download-grant-is-session-bound",
        "transfer",
        "transfer",
    );

    let mut fixture = TransferFixture::start().await;

    // Client A gets a download grant
    let client_a = fixture.connect_client().await;
    let download_key = "client/session-bound.txt";
    let download_input = DownloadInput {
        key: download_key.to_string(),
    };
    let grant_value = call_download_with_retry(&client_a, &download_input).await;
    let download_grant = trellis_rs::client::download_transfer_grant_from_value(grant_value)
        .expect("parse download transfer grant");

    // Client B attempts to use client A's grant
    let client_b = fixture.connect_client().await;
    let result = client_b.download_transfer(&download_grant).await;
    assert!(
        result.is_err(),
        "cross-session grant usage should be rejected"
    );

    fixture.shutdown().await;
}

async fn start_upload_with_retry<'a>(
    client: &'a trellis_rs::client::TrellisClient,
    input: &UploadInput,
    body: &[u8],
) -> trellis_rs::client::StartedOperationTransfer<
    'a,
    trellis_rs::client::TrellisClient,
    FilesUploadOp,
> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .operation::<FilesUploadOp>()
            .input(input)
            .transfer(body)
            .start()
            .await
        {
            Ok(started) => return started,
            Err(ref error)
                if is_retryable_transfer_start_error(error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("start live Files.Upload transfer operation: {error:?}"),
        }
    }
}

async fn call_download_with_retry(
    client: &trellis_rs::client::TrellisClient,
    input: &DownloadInput,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client.call::<FilesDownloadRpc>(input).await {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Files.Download RPC: {error}"),
        }
    }
}

fn is_retryable_transfer_start_error(
    error: &trellis_rs::client::OperationTransferStartError<
        '_,
        trellis_rs::client::TrellisClient,
        FilesUploadOp,
    >,
) -> bool {
    is_retryable_service_startup_error(error.source())
}

fn is_retryable_service_startup_error(error: &trellis_rs::client::TrellisClientError) -> bool {
    match error {
        trellis_rs::client::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::client::TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn transfer_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        TRANSFER_CLIENT_ID,
        "Trellis Integration Transfer Client",
        "App/client participant for the transfer integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "transferService",
        trellis_rs::contracts::use_contract(TRANSFER_SERVICE_ID)
            .with_operation_call(["Files.Upload"])
            .with_rpc_call(["Files.Download"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
