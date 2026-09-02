use std::collections::BTreeMap;
use std::future::pending;
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWrite};
use tokio::task::JoinHandle;
use trellis_rs::client::OperationState as ClientOpState;
use trellis_rs::client::{OperationDescriptor, TransferOperationDescriptor};
use trellis_rs::service::{
    AcceptedOperation, FileTransferInfo, OperationRefData, OperationSnapshot,
    OperationState as ServiceOpState, ServerError, ServiceRuntimeError, StoreObjectInfo,
    StoreResourceClient, TransferDownloadGrantArgs, TransferUploadGrantArgs,
    UploadTransferCompletion, UploadTransferSession,
};

use crate::support::assertions::{assert_case_registered, assert_generated_service_contract};

const TRANSFER_SERVICE_ID: &str = "integration.transfer-service@v1";
const TRANSFER_CLIENT_ID: &str = "integration.transfer-client@v1";

const TRANSFER_SERVICE_API_SOURCE_JSON: &str = r#"{
  "format": "trellis.api.v1",
  "id": "integration.transfer-service@v1",
  "version": "1.0.0",
  "displayName": "Trellis Integration Transfer Service",
  "description": "Exercises generated operation and RPC transfer surfaces.",
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
  "operations": {
    "Files.Upload": {
      "version": "v1",
      "input": { "schema": "UploadInput" },
      "output": { "schema": "UploadOutput" },
      "transfer": { "direction": "send" },
      "cancel": false
    }
  },
  "rpc": {
    "Files.Download": {
      "version": "v1",
      "input": { "schema": "DownloadInput" },
      "output": { "schema": "DownloadGrant" },
      "transfer": { "direction": "receive" },
      "errors": []
    }
  }
}"#;

const TRANSFER_SERVICE_PARTICIPANT_JSON: &str = r#"{
  "format": "trellis.participant.v1",
  "id": "integration.transfer-service@v1",
  "displayName": "Trellis Integration Transfer Service",
  "description": "Exercises generated operation and RPC transfer surfaces.",
  "kind": "service",
  "implements": {},
  "resources": {
    "store": {
      "uploads": {
        "purpose": "Temporary integration transfer files",
        "required": true,
        "ttlMs": 0,
        "maxObjectBytes": 1024,
        "maxTotalBytes": 4194304
      }
    }
  }
}"#;

struct TransferServiceContract;

impl trellis_rs::service::GeneratedServiceContract for TransferServiceContract {
    const PARTICIPANT_ID: &'static str = TRANSFER_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "4y54UucbNCkYpTcFSbz4YBWHifp9HCT25-cF-rFL5cU";
    const PARTICIPANT_NEEDS_DIGEST: &'static str = "IXvEk3BVDQBmspUmTA2QM2StaXmSHlbBF-2INL9oyjQ";
    const PARTICIPANT_JSON: &'static str = r#"{"description":"Exercises generated operation and RPC transfer surfaces.","displayName":"Trellis Integration Transfer Service","format":"trellis.participant.v1","id":"integration.transfer-service@v1","implements":{"self":{"api":"integration.transfer-service@v1","apiDigest":"H91GA0bQ-av3V8Mmv3kXqak_IFXOqERPQ4fw8uIddqA","operationTransfers":{"Files.Upload":{"contentType":"/contentType","expiresInMs":60000,"key":"/key","maxBytes":1048576,"store":"uploads"}}}},"kind":"service","resources":{"store":{"uploads":{"maxObjectBytes":1024,"maxTotalBytes":4194304,"purpose":"Temporary integration transfer files"}}}}"#;
    const API_JSON: &'static str = r#"{"description":"Exercises generated operation and RPC transfer surfaces.","displayName":"Trellis Integration Transfer Service","format":"trellis.api.v1","id":"integration.transfer-service@v1","version":"1.0.0","operations":{"Files.Upload":{"input":{"schema":"UploadInput"},"output":{"schema":"UploadOutput"},"transfer":{"direction":"send"},"version":"v1"}},"rpc":{"Files.Download":{"input":{"schema":"DownloadInput"},"output":{"schema":"DownloadGrant"},"transfer":{"direction":"receive"},"version":"v1"}},"schemas":{"DownloadGrant":{"properties":{"chunkBytes":{"type":"integer"},"direction":{"type":"string"},"expiresAt":{"type":"string"},"info":{"properties":{"contentType":{"type":"string"},"key":{"type":"string"},"metadata":{"type":"object"},"size":{"type":"integer"},"updatedAt":{"type":"string"}},"type":"object"},"service":{"type":"string"},"sessionKey":{"type":"string"},"subject":{"type":"string"},"transferId":{"type":"string"},"type":{"type":"string"}},"type":"object"},"DownloadInput":{"properties":{"key":{"type":"string"}},"required":["key"],"type":"object"},"UploadInput":{"properties":{"contentType":{"type":"string"},"key":{"type":"string"}},"required":["key"],"type":"object"},"UploadOutput":{"properties":{"contentType":{"type":"string"},"key":{"type":"string"},"size":{"type":"integer"}},"required":["key","size"],"type":"object"}}}"#;
    const API_DIGEST: &'static str = "H91GA0bQ-av3V8Mmv3kXqak_IFXOqERPQ4fw8uIddqA";
    const REFERENCED_API_ARTIFACTS: &'static [(&'static str, &'static str)] = &[];
}

#[test]
fn transfer_service_contract_evidence_is_exact() {
    assert_generated_service_contract::<TransferServiceContract>(&transfer_service_contract());
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
    type Update = Value;
    type UpdateEvidence = trellis_rs::client::NoOperationUpdates;
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
    const UPDATE_SCHEMA_JSON: Option<&'static str> = None;
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
    stored_uploads: tokio::sync::Mutex<std::collections::HashMap<String, StoredUpload>>,
    download_reads: Arc<AtomicUsize>,
    stalled_upload_started: Arc<tokio::sync::Notify>,
    stalled_upload_dropped: Arc<AtomicBool>,
}

type UploadFuture<T> = futures_util::future::BoxFuture<'static, Result<T, ServerError>>;
type UploadStart = Box<
    dyn Fn(
            trellis_rs::service::RequestContext,
            UploadInput,
        ) -> UploadFuture<AcceptedOperation<Value, UploadOutput>>
        + Send
        + Sync,
>;
type UploadSnapshot = Box<
    dyn Fn(
            trellis_rs::service::RequestContext,
            String,
        ) -> UploadFuture<OperationSnapshot<Value, UploadOutput>>
        + Send
        + Sync,
>;
type UploadWatch = Box<
    dyn Fn(
            trellis_rs::service::RequestContext,
            String,
        ) -> trellis_rs::service::OperationLiveWatch<Value, Value, UploadOutput>
        + Send
        + Sync,
>;

struct UploadProvider {
    start: UploadStart,
    get: UploadSnapshot,
    watch: UploadWatch,
}

impl trellis_rs::service::ServiceOperationProvider<FilesUploadOp> for UploadProvider {
    fn start(
        &self,
        context: trellis_rs::service::RequestContext,
        input: UploadInput,
    ) -> UploadFuture<AcceptedOperation<Value, UploadOutput>> {
        (self.start)(context, input)
    }
    fn get(
        &self,
        context: trellis_rs::service::RequestContext,
        operation_id: String,
    ) -> UploadFuture<OperationSnapshot<Value, UploadOutput>> {
        (self.get)(context, operation_id)
    }
    fn wait(
        &self,
        context: trellis_rs::service::RequestContext,
        operation_id: String,
    ) -> UploadFuture<OperationSnapshot<Value, UploadOutput>> {
        let mut snapshots = self.watch(context, operation_id.clone());
        Box::pin(async move {
            while let Some(event) = snapshots.next().await {
                if let trellis_rs::service::OperationLiveEvent::Snapshot(snapshot) = event? {
                    if snapshot.state.is_terminal() {
                        return Ok(snapshot);
                    }
                }
            }
            Err(ServerError::Nats(format!(
                "operation {operation_id} watch ended before terminal state"
            )))
        })
    }
    fn watch(
        &self,
        context: trellis_rs::service::RequestContext,
        operation_id: String,
    ) -> trellis_rs::service::OperationLiveWatch<Value, Value, UploadOutput> {
        (self.watch)(context, operation_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StoredUpload {
    key: String,
    body: Bytes,
    size: u64,
}

struct BlockingWriter;

#[derive(Debug, Clone)]
struct CountingStore<C> {
    inner: C,
    reads: Arc<AtomicUsize>,
}

#[derive(Debug, Clone)]
struct StallingUploadStore<C> {
    inner: C,
    started: Arc<tokio::sync::Notify>,
    dropped: Arc<AtomicBool>,
}

impl<C> StoreResourceClient for StallingUploadStore<C>
where
    C: StoreResourceClient,
{
    async fn read_into<W>(
        &self,
        key: &str,
        writer: &mut W,
    ) -> Result<Option<StoreObjectInfo>, ServerError>
    where
        W: tokio::io::AsyncWrite + Unpin + Send,
    {
        self.inner.read_into(key, writer).await
    }

    async fn write_from<R>(&self, key: &str, reader: &mut R) -> Result<StoreObjectInfo, ServerError>
    where
        R: tokio::io::AsyncRead + Unpin + Send,
    {
        if !key.ends_with(".stall") {
            return self.inner.write_from(key, reader).await;
        }

        struct DropFlag(Arc<AtomicBool>);
        impl Drop for DropFlag {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }

        let mut byte = [0_u8; 1];
        reader
            .read_exact(&mut byte)
            .await
            .map_err(|error| ServerError::Nats(error.to_string()))?;
        let _drop_flag = DropFlag(Arc::clone(&self.dropped));
        self.started.notify_one();
        pending().await
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        self.inner.list().await
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.inner.delete(key).await
    }
}

impl<C> StoreResourceClient for CountingStore<C>
where
    C: StoreResourceClient,
{
    async fn read_into<W>(
        &self,
        key: &str,
        writer: &mut W,
    ) -> Result<Option<StoreObjectInfo>, ServerError>
    where
        W: tokio::io::AsyncWrite + Unpin + Send,
    {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.inner.read_into(key, writer).await
    }

    async fn write_from<R>(&self, key: &str, reader: &mut R) -> Result<StoreObjectInfo, ServerError>
    where
        R: tokio::io::AsyncRead + Unpin + Send,
    {
        self.inner.write_from(key, reader).await
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        self.inner.list().await
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.inner.delete(key).await
    }
}

impl AsyncWrite for BlockingWriter {
    fn poll_write(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        _buffer: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Poll::Pending
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

impl SharedOpState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshots: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            stored_uploads: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            download_reads: Arc::new(AtomicUsize::new(0)),
            stalled_upload_started: Arc::new(tokio::sync::Notify::new()),
            stalled_upload_dropped: Arc::new(AtomicBool::new(false)),
        })
    }
}

fn now_iso() -> Result<String, ServerError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| ServerError::Nats(e.to_string()))
}

struct TransferFixture {
    _runtime: trellis_test::TrellisTestRuntime,
    admin: trellis_test::TrellisTestAdmin,
    bootstrap_url: String,
    service_task: Option<JoinHandle<Result<(), ServiceRuntimeError>>>,
    client_contract: trellis_test::TrellisTestContract,
    shared: Arc<SharedOpState>,
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

        let service_contract = transfer_service_contract();
        let client_contract = transfer_client_contract(&service_contract)
            .expect("build transfer client test contract");

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
        register_download_handler(&mut service, Arc::clone(&shared));

        let service_task = tokio::spawn(async move { service.run().await });

        TransferFixture {
            _runtime: runtime,
            admin,
            bootstrap_url,
            service_task: Some(service_task),
            client_contract,
            shared,
        }
    }

    async fn connect_client(&mut self) -> trellis_rs::generated::Caller {
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

    async fn stored_upload(&self, key: &str) -> Option<StoredUpload> {
        self.shared.stored_uploads.lock().await.get(key).cloned()
    }
}

fn transfer_service_contract() -> trellis_test::TrellisTestContract {
    let api: Value =
        serde_json::from_str(TRANSFER_SERVICE_API_SOURCE_JSON).expect("parse transfer service API");
    let api_digest = trellis_rs::contracts::ApiBuilder::new(api)
        .build()
        .expect("validate transfer service API")
        .digest()
        .expect("digest transfer service API");
    let mut participant: Value = serde_json::from_str(TRANSFER_SERVICE_PARTICIPANT_JSON)
        .expect("parse transfer service participant");
    participant["implements"] = serde_json::json!({
        "self": {
            "api": TRANSFER_SERVICE_ID,
            "apiDigest": api_digest,
            "operationTransfers": {
                "Files.Upload": {
                    "store": "uploads",
                    "key": "/key",
                    "contentType": "/contentType",
                    "expiresInMs": 60000,
                    "maxBytes": 1048576
                }
            }
        }
    });
    trellis_test::TrellisTestContract::from_native_json(
        TRANSFER_SERVICE_API_SOURCE_JSON,
        &participant.to_string(),
    )
    .expect("build transfer service test contract")
}

fn register_upload_handler(
    service: &mut trellis_rs::service::ConnectedServiceRuntime<TransferServiceContract>,
    shared: Arc<SharedOpState>,
) {
    let handle = service.generated_handle();
    service.register_operation_provider::<FilesUploadOp, _>(UploadProvider {
        start: Box::new({
            let shared = Arc::clone(&shared);
            move |context: trellis_rs::service::RequestContext, input: UploadInput| {
                let shared = Arc::clone(&shared);
                let handle = handle.clone();
                Box::pin(async move {
                    let caller_session_key = context.session_key.clone().unwrap_or_default();
                    let service_session_key = handle.session_key().to_string();
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
                            chunk_bytes: 256,
                            max_bytes: Some(1_048_576),
                            content_type: input.content_type.as_deref(),
                            metadata: BTreeMap::new(),
                        })
                        .map_err(|e| ServerError::Nats(e.to_string()))?;

                    let session = UploadTransferSession::new(plan.clone(), &updated_at);
                    let store = StallingUploadStore {
                        inner: handle.store_client("uploads").await?,
                        started: Arc::clone(&shared.stalled_upload_started),
                        dropped: Arc::clone(&shared.stalled_upload_dropped),
                    };
                    let completion: UploadTransferCompletion = handle
                        .spawn_upload_transfer_endpoint_with_completion(session, store.clone())
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
                                match store.read(&completion_key).await {
                                    Ok(Some(body)) => {
                                        shared_clone.stored_uploads.lock().await.insert(
                                            op_id.clone(),
                                            StoredUpload {
                                                key: completion_key.clone(),
                                                size: body.len() as u64,
                                                body,
                                            },
                                        );
                                    }
                                    Ok(None) => {}
                                    Err(_) => {}
                                }
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
                })
            }
        }),
        get: Box::new({
            let shared = Arc::clone(&shared);
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
                let shared = Arc::clone(&shared);
                Box::pin(async move {
                    let snapshots = shared.snapshots.lock().await;
                    snapshots
                        .get(&operation_id)
                        .cloned()
                        .ok_or(ServerError::OperationNotFound { operation_id })
                })
            }
        }),
        watch: Box::new({
            let shared = Arc::clone(&shared);
            move |_context: trellis_rs::service::RequestContext, operation_id: String| {
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
                Box::pin(stream.map(|snapshot| {
                    snapshot.map(trellis_rs::service::OperationLiveEvent::Snapshot)
                }))
            }
        }),
    });
}

fn register_download_handler(
    service: &mut trellis_rs::service::ConnectedServiceRuntime<TransferServiceContract>,
    shared: Arc<SharedOpState>,
) {
    service.register_rpc::<FilesDownloadRpc, _, _>(move |context, input| {
        let shared = Arc::clone(&shared);
        async move {
            let handle = context.handle();
            let service_session_key = handle.session_key().to_string();
            let service_name = handle.service_name().to_string();
            let resources = handle.resources().clone();
            let caller_session_key = context.request().session_key.clone().unwrap_or_default();

            let payload = if input.key.ends_with(".multi") {
                Bytes::from(
                    (0..(3 * 256 + 17))
                        .map(|index| (index % 251) as u8)
                        .collect::<Vec<_>>(),
                )
            } else {
                Bytes::from(format!("download:{}", input.key))
            };
            let store = handle.store_client("uploads").await?;
            let mut payload_reader = std::io::Cursor::new(payload.clone());
            let stored = trellis_rs::service::StoreResourceClient::write_from(
                &store,
                &input.key,
                &mut payload_reader,
            )
            .await?;

            let transfer_id = format!("download-{}", input.key.replace(['/', '.'], "-"));
            let expires_in = if input.key.ends_with(".unused") {
                time::Duration::milliseconds(200)
            } else {
                time::Duration::minutes(5)
            };
            let expires_at = (time::OffsetDateTime::now_utc() + expires_in)
                .format(&time::format_description::well_known::Rfc3339)
                .map_err(|e| ServerError::Nats(e.to_string()))?;
            let updated_at = now_iso()?;

            let plan =
                trellis_rs::service::plan_download_transfer_grant(TransferDownloadGrantArgs {
                    service_name: &service_name,
                    session_key: &caller_session_key,
                    service_session_key: &service_session_key,
                    resources: &resources,
                    store: "uploads",
                    transfer_id: &transfer_id,
                    expires_at: &expires_at,
                    chunk_bytes: 256,
                    info: FileTransferInfo {
                        key: input.key.clone(),
                        size: payload.len() as u64,
                        updated_at,
                        digest: stored.digest.ok_or_else(|| {
                            ServerError::Nats(
                                "download object is missing a SHA-256 digest".to_string(),
                            )
                        })?,
                        content_type: Some("text/plain".to_string()),
                        metadata: BTreeMap::new(),
                    },
                })
                .map_err(|e| ServerError::Nats(e.to_string()))?;

            handle
                .spawn_download_transfer_endpoint(
                    plan.clone(),
                    CountingStore {
                        inner: store,
                        reads: Arc::clone(&shared.download_reads),
                    },
                )
                .await?;

            let grant_value = serde_json::to_value(&plan.grant).map_err(ServerError::Json)?;
            Ok(grant_value)
        }
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

    let upload_bytes = (0..(3 * 256 + 17))
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
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
    assert_eq!(
        fixture
            .stored_upload(operation_ref.id())
            .await
            .expect("service should retain the multiframe upload")
            .body,
        upload_bytes
    );

    let stalled_input = UploadInput {
        key: "client/upload.stall".to_string(),
        content_type: None,
    };
    let stalled_body = vec![7_u8; 3 * 256];
    let cancellation = trellis_rs::generated::TransferCancellation::new();
    let mut reader = std::io::Cursor::new(&stalled_body);
    let stalled_operation = client
        .operation::<FilesUploadOp>()
        .start(&stalled_input)
        .await
        .expect("start stalled upload operation");
    let stalled_upload = stalled_operation.transfer_from_with_cancel(
        &mut reader,
        Some(stalled_body.len() as u64),
        &cancellation,
    );
    tokio::pin!(stalled_upload);
    tokio::select! {
        () = fixture.shared.stalled_upload_started.notified() => {}
        result = &mut stalled_upload => panic!("stalled upload completed before cancellation: {result:?}"),
    }
    cancellation.cancel();
    let result = tokio::time::timeout(Duration::from_secs(2), stalled_upload)
        .await
        .expect("stalled upload cancellation must be prompt");
    assert!(result.is_err(), "stalled upload should report cancellation");
    assert!(
        fixture.shared.stalled_upload_dropped.load(Ordering::SeqCst),
        "service must abort and join the stalled store upload before acknowledging cancellation"
    );

    fixture.shutdown().await;
}

#[tokio::test]
async fn transfer_upload_rejects_over_max_bytes() {
    assert_case_registered(
        "transfer.upload-rejects-over-max-bytes",
        "transfer",
        "transfer",
    );

    let mut fixture = TransferFixture::start().await;
    let client = fixture.connect_client().await;
    let upload_input = UploadInput {
        key: "client/too-large.bin".to_string(),
        content_type: Some("application/octet-stream".to_string()),
    };
    let upload_bytes = vec![0u8; 2048];
    let result = start_upload_result_with_retry(&client, &upload_input, &upload_bytes).await;

    let error = result.expect_err("oversized upload should be rejected");
    match error.source() {
        trellis_rs::generated::TrellisClientError::TransferProtocol(message) => {
            assert!(message.contains("attempted 2048"));
            assert!(message.contains("max 1024"));
        }
        other => panic!("expected transfer protocol error, got {other:?}"),
    }

    fixture.shutdown().await;
}

#[tokio::test]
async fn transfer_upload_stores_object_before_completion() {
    assert_case_registered(
        "transfer.upload-stores-object-before-completion",
        "transfer",
        "transfer",
    );

    let mut fixture = TransferFixture::start().await;
    let client = fixture.connect_client().await;
    let upload_bytes = Bytes::from_static(b"stored callback");
    let upload_input = UploadInput {
        key: "client/stored.txt".to_string(),
        content_type: Some("text/plain".to_string()),
    };
    let started_upload = start_upload_with_retry(&client, &upload_input, &upload_bytes).await;
    let operation_ref = started_upload.into_operation_ref();
    let final_snapshot = tokio::time::timeout(Duration::from_secs(15), operation_ref.wait())
        .await
        .expect("wait for upload operation completion timed out")
        .expect("wait for upload operation completion");
    assert_eq!(final_snapshot.state, ClientOpState::Completed);

    let stored = fixture
        .stored_upload(operation_ref.id())
        .await
        .expect("service should observe stored upload bytes");
    assert_eq!(stored.key, "client/stored.txt");
    assert_eq!(stored.body, upload_bytes);
    assert_eq!(stored.size, upload_bytes.len() as u64);

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

    let download_key = "client/download.multi";
    let download_input = DownloadInput {
        key: download_key.to_string(),
    };
    let grant_value = call_download_with_retry(&client, &download_input).await;

    let download_grant = trellis_rs::client::download_transfer_grant_from_value(grant_value)
        .expect("parse download transfer grant");
    assert_eq!(
        download_grant.direction,
        trellis_rs::client::DownloadTransferDirection::Receive
    );
    assert_eq!(download_grant.info.key, download_key);
    assert_eq!(
        download_grant.info.content_type.as_deref(),
        Some("text/plain")
    );

    let mut downloaded = Vec::new();
    let info = client
        .download_transfer_into(&download_grant, &mut downloaded)
        .await
        .expect("stream download transfer bytes");
    assert_eq!(info.size, downloaded.len() as u64);
    assert_eq!(downloaded.len(), 3 * 256 + 17);
    assert!(downloaded
        .iter()
        .enumerate()
        .all(|(index, byte)| *byte == (index % 251) as u8));

    let cancellation_grant = call_download_with_retry(
        &client,
        &DownloadInput {
            key: "client/download-cancel.multi".to_string(),
        },
    )
    .await;
    let cancellation_grant =
        trellis_rs::client::download_transfer_grant_from_value(cancellation_grant)
            .expect("parse cancellation download grant");
    let cancellation = trellis_rs::generated::TransferCancellation::new();
    let cancellation_task = {
        let cancellation = cancellation.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            cancellation.cancel();
        })
    };
    let cancelled = client
        .download_transfer_into_with_cancel(&cancellation_grant, &mut BlockingWriter, &cancellation)
        .await;
    cancellation_task.await.expect("cancellation task");
    assert!(matches!(
        cancelled,
        Err(trellis_rs::generated::TrellisClientError::TransferCancelled)
    ));

    let reads_before_unused_grant = fixture.shared.download_reads.load(Ordering::SeqCst);
    let unused_grant = call_download_with_retry(
        &client,
        &DownloadInput {
            key: "client/download.unused".to_string(),
        },
    )
    .await;
    let unused_grant = trellis_rs::client::download_transfer_grant_from_value(unused_grant)
        .expect("parse unused download grant");
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(
        fixture.shared.download_reads.load(Ordering::SeqCst),
        reads_before_unused_grant,
        "unused grant must not open the object reader"
    );
    let expired = client.download_transfer(&unused_grant).await;
    assert!(matches!(
        expired,
        Err(trellis_rs::generated::TrellisClientError::NatsRequest(_))
    ));

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
    let result = trellis_test::download_transfer(&client_b, &download_grant).await;
    assert!(
        result.is_err(),
        "cross-session grant usage should be rejected"
    );

    fixture.shutdown().await;
}

async fn start_upload_with_retry<'a>(
    client: &'a trellis_rs::generated::Caller,
    input: &UploadInput,
    body: &[u8],
) -> trellis_rs::generated::StartedOperationTransfer<'a, trellis_rs::generated::Caller, FilesUploadOp>
{
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let mut reader = std::io::Cursor::new(body);
        match client
            .operation::<FilesUploadOp>()
            .input(input)
            .transfer_from(&mut reader, Some(body.len() as u64))
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

async fn start_upload_result_with_retry<'a>(
    client: &'a trellis_rs::generated::Caller,
    input: &UploadInput,
    body: &[u8],
) -> Result<
    trellis_rs::generated::StartedOperationTransfer<
        'a,
        trellis_rs::generated::Caller,
        FilesUploadOp,
    >,
    trellis_rs::generated::OperationTransferStartError<
        'a,
        trellis_rs::generated::Caller,
        FilesUploadOp,
    >,
> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let mut reader = std::io::Cursor::new(body);
        match client
            .operation::<FilesUploadOp>()
            .input(input)
            .transfer_from(&mut reader, Some(body.len() as u64))
            .start()
            .await
        {
            Err(ref error)
                if is_retryable_transfer_start_error(error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            result => return result,
        }
    }
}

async fn call_download_with_retry(
    client: &trellis_rs::generated::Caller,
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
    error: &trellis_rs::generated::OperationTransferStartError<
        '_,
        trellis_rs::generated::Caller,
        FilesUploadOp,
    >,
) -> bool {
    is_retryable_service_startup_error(error.source())
}

fn is_retryable_service_startup_error(error: &trellis_rs::generated::TrellisClientError) -> bool {
    match error {
        trellis_rs::generated::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::generated::TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn transfer_client_contract(
    service_contract: &trellis_test::TrellisTestContract,
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractBuilder::authoring(
        TRANSFER_CLIENT_ID,
        TRANSFER_CLIENT_ID,
        "1.0.0",
        "Trellis Integration Transfer Client",
        "App/client participant for the transfer integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "transferService",
        trellis_rs::contracts::use_contract(TRANSFER_SERVICE_ID)
            .with_operation_call(["Files.Upload"])
            .with_rpc_call(["Files.Download"]),
    );

    trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
        manifest,
        &[service_contract],
    )
}
