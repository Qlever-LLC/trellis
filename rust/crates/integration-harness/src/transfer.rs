use std::collections::BTreeMap;
use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::future::BoxFuture;
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use trellis_rs::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis_rs::client::{
    OperationState, ServiceConnectWithContractOptions, TrellisClient, TrellisClientError,
};
use trellis_rs::contracts::{
    digest_contract_json, operation, rpc, store, use_contract, ContractKind,
    ContractManifestBuilder,
};
use trellis_rs::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis_rs::service::{
    plan_download_transfer_grant, plan_upload_transfer_grant, spawn_download_transfer_endpoint,
    spawn_upload_transfer_endpoint_with_completion, ConnectedServiceRuntime,
    DefaultRequestValidator, FileTransferInfo, InMemoryOperationRuntime, OperationFailure,
    RequestContext, RequestValidation, RequestValidator, ServerError, ServiceResourceBindings,
    StoreResourceBinding, StoreResourceClient, TransferDownloadGrantArgs, TransferUploadGrantArgs,
    UploadTransferCompletion, UploadTransferSession,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::deno_fixture::{deno_fixture_log_paths, deno_fixture_path};
use crate::deployment_authority::plan_accept_reconcile_deployment_authority;
use crate::workspace::repo_root;

const HARNESS_DEPLOYMENT_ID: &str = "harness.transfer";
const HARNESS_RUST_SERVICE_NAME: &str = "harness-transfer-rust";
const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.transfer@v1";
const HARNESS_CALLER_CONTRACT_ID: &str = "trellis.integration-transfer-agent@v1";
const HARNESS_DENIED_CONTRACT_ID: &str = "trellis.integration-transfer-denied-agent@v1";
const HARNESS_RUST_UPLOAD_SUBJECT: &str = "operations.v1.Harness.Rust.TransferUpload";
const HARNESS_TS_UPLOAD_SUBJECT: &str = "operations.v1.Harness.Ts.TransferUpload";
const HARNESS_RUST_DOWNLOAD_SUBJECT: &str = "rpc.v1.Harness.Rust.TransferDownload";
const HARNESS_TS_DOWNLOAD_SUBJECT: &str = "rpc.v1.Harness.Ts.TransferDownload";
const TRACE_UPLOAD_KEY: &str = "ts-client/rust-transfer-trace.txt";
const PASSING_CASES: usize = 15;

fn harness_service_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration Harness Transfer",
        "Harness-owned service contract for full-stack Rust/TypeScript transfer verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .store_resource(
        "uploads",
        store("Temporary transfer uploads")
            .required(true)
            .ttl_ms(0)
            .max_object_bytes(1_048_576)
            .max_total_bytes(4_194_304),
    )
    .schema("UploadInput", upload_input_schema())
    .schema("UploadOutput", upload_output_schema())
    .schema("DownloadInput", download_input_schema())
    .schema("DownloadGrant", download_grant_schema())
    .operation(
        "Harness.Rust.TransferUpload",
        operation(
            "v1",
            HARNESS_RUST_UPLOAD_SUBJECT,
            "UploadInput",
            None::<&str>,
            Some("UploadOutput"),
        )
        .with_transfer(
            "uploads",
            "/key",
            Some("/contentType"),
            None::<&str>,
            Some(60_000),
            Some(1_024),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_observe_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .cancel(false),
    )
    .operation(
        "Harness.Ts.TransferUpload",
        operation(
            "v1",
            HARNESS_TS_UPLOAD_SUBJECT,
            "UploadInput",
            None::<&str>,
            Some("UploadOutput"),
        )
        .with_transfer(
            "uploads",
            "/key",
            Some("/contentType"),
            None::<&str>,
            Some(60_000),
            Some(1_024),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_observe_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .cancel(false),
    )
    .rpc(
        "Harness.Rust.TransferDownload",
        rpc(
            "v1",
            HARNESS_RUST_DOWNLOAD_SUBJECT,
            "DownloadInput",
            "DownloadGrant",
        )
        .with_receive_transfer()
        .with_call_capabilities(std::iter::empty::<&str>()),
    )
    .rpc(
        "Harness.Ts.TransferDownload",
        rpc(
            "v1",
            HARNESS_TS_DOWNLOAD_SUBJECT,
            "DownloadInput",
            "DownloadGrant",
        )
        .with_receive_transfer()
        .with_call_capabilities(std::iter::empty::<&str>()),
    )
    .build()
    .map_err(|error| miette!("failed to build transfer harness service contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize transfer harness service contract: {error}"))
}

fn harness_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        HARNESS_CALLER_CONTRACT_ID,
        "Trellis Integration Transfer Agent",
        "Verify delegated Rust agent login and harness transfer calls.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID)
            .with_operation_call(["Harness.Rust.TransferUpload", "Harness.Ts.TransferUpload"])
            .with_rpc_call([
                "Harness.Rust.TransferDownload",
                "Harness.Ts.TransferDownload",
            ]),
    )
    .build()
    .map_err(|error| miette!("failed to build transfer harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize transfer harness caller contract: {error}"))
}

fn harness_denied_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        HARNESS_DENIED_CONTRACT_ID,
        "Trellis Integration Transfer Denied Agent",
        "Verify transfer grants are bound to the authorized caller session.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .build()
    .map_err(|error| miette!("failed to build denied transfer harness contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize denied transfer harness contract: {error}"))
}

fn upload_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "key": { "type": "string" },
            "contentType": { "type": "string" }
        },
        "required": ["key"]
    })
}

fn upload_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "key": { "type": "string" },
            "size": { "type": "integer" },
            "contentType": { "type": "string" },
            "traceparent": { "type": "string" },
            "chunkTraceparent": { "type": "string" }
        },
        "required": ["key", "size"]
    })
}

fn download_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "key": { "type": "string" }
        },
        "required": ["key"]
    })
}

fn download_grant_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": true,
        "properties": {
            "type": { "type": "string", "const": "TransferGrant" },
            "direction": { "type": "string", "const": "receive" },
            "service": { "type": "string" },
            "sessionKey": { "type": "string" },
            "transferId": { "type": "string" },
            "subject": { "type": "string" },
            "expiresAt": { "type": "string" },
            "chunkBytes": { "type": "integer" },
            "info": {
                "type": "object",
                "additionalProperties": true,
                "properties": {
                    "key": { "type": "string" },
                    "size": { "type": "integer" },
                    "updatedAt": { "type": "string" }
                },
                "required": ["key", "size", "updatedAt"]
            }
        },
        "required": ["type", "direction", "service", "sessionKey", "transferId", "subject", "expiresAt", "chunkBytes", "info"]
    })
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
    #[serde(skip_serializing_if = "Option::is_none")]
    traceparent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk_traceparent: Option<String>,
}

#[derive(Debug)]
struct RecordingTransferValidator<V> {
    inner: V,
    traceparent: Arc<Mutex<Option<String>>>,
}

impl<V> RecordingTransferValidator<V> {
    fn new(inner: V, traceparent: Arc<Mutex<Option<String>>>) -> Self {
        Self { inner, traceparent }
    }
}

impl<V> RequestValidator for RecordingTransferValidator<V>
where
    V: RequestValidator,
{
    fn validate<'a>(
        &'a self,
        subject: &'a str,
        payload: &'a Bytes,
        context: &'a RequestContext,
    ) -> BoxFuture<'a, std::result::Result<RequestValidation, ServerError>> {
        Box::pin(async move {
            if let Some(traceparent) = context.traceparent.as_ref() {
                *self.traceparent.lock().await = Some(traceparent.clone());
            }
            self.inner.validate(subject, payload, context).await
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct DownloadInput {
    key: String,
}

struct HarnessRustUploadOperation;

impl trellis_rs::client::OperationDescriptor for HarnessRustUploadOperation {
    type Input = UploadInput;
    type Progress = Value;
    type Output = UploadOutput;

    const KEY: &'static str = "Harness.Rust.TransferUpload";
    const SUBJECT: &'static str = HARNESS_RUST_UPLOAD_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}

impl trellis_rs::client::TransferOperationDescriptor for HarnessRustUploadOperation {}

struct HarnessTsUploadOperation;

impl trellis_rs::client::OperationDescriptor for HarnessTsUploadOperation {
    type Input = UploadInput;
    type Progress = Value;
    type Output = UploadOutput;

    const KEY: &'static str = "Harness.Ts.TransferUpload";
    const SUBJECT: &'static str = HARNESS_TS_UPLOAD_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}

impl trellis_rs::client::TransferOperationDescriptor for HarnessTsUploadOperation {}

struct HarnessRustDownloadRpc;

impl trellis_rs::client::RpcDescriptor for HarnessRustDownloadRpc {
    type Input = DownloadInput;
    type Output = Value;

    const KEY: &'static str = "Harness.Rust.TransferDownload";
    const SUBJECT: &'static str = HARNESS_RUST_DOWNLOAD_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
}

struct HarnessTsDownloadRpc;

impl trellis_rs::client::RpcDescriptor for HarnessTsDownloadRpc {
    type Input = DownloadInput;
    type Output = Value;

    const KEY: &'static str = "Harness.Ts.TransferDownload";
    const SUBJECT: &'static str = HARNESS_TS_DOWNLOAD_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
}

pub(crate) async fn run_transfer_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let service_contract_json = harness_service_contract_json()?;
    let (contract_digest, rust_service_seed, ts_service_seed) = {
        let admin_client = connect_admin_client_async(&setup_login.state)
            .await
            .into_diagnostic()?;
        let auth_client = trellis_rs::auth::AuthClient::new(&admin_client);
        auth_client
            .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
            .await
            .into_diagnostic()?;

        let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
        let sdk_auth_client = SdkAuthClient::new(&admin_client);
        plan_accept_reconcile_deployment_authority(
            &sdk_auth_client,
            HARNESS_DEPLOYMENT_ID,
            &service_contract_json,
            &contract_digest,
            "integration harness transfer service setup",
        )
        .await?;

        let (rust_service_seed, rust_service_key) = generate_session_keypair();
        auth_client
            .provision_service_instance(
                &trellis_rs::sdk::auth::AuthServiceInstancesProvisionRequest {
                    deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                    instance_key: rust_service_key,
                },
            )
            .await
            .into_diagnostic()?;
        let (ts_service_seed, ts_service_key) = generate_session_keypair();
        auth_client
            .provision_service_instance(
                &trellis_rs::sdk::auth::AuthServiceInstancesProvisionRequest {
                    deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                    instance_key: ts_service_key,
                },
            )
            .await
            .into_diagnostic()?;

        (contract_digest, rust_service_seed, ts_service_seed)
    };

    let service_client = Arc::new(
        connect_service_with_retry(
            trellis_url,
            &contract_digest,
            &service_contract_json,
            &rust_service_seed,
        )
        .await
        .into_diagnostic()?,
    );
    let rust_store = InMemoryStore::default();
    let resources = rust_resources();
    let operations = InMemoryOperationRuntime::new(HARNESS_RUST_SERVICE_NAME)
        .operation::<HarnessRustUploadOperation>();
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        HARNESS_RUST_SERVICE_NAME,
        Arc::clone(&service_client),
    )
    .map_err(|error| miette!("failed to create transfer service runtime: {error}"))?;
    service.register_operation::<HarnessRustUploadOperation, _, _, _, _, _, _, _, _>(
        {
            let operations = operations.clone();
            let service_client = Arc::clone(&service_client);
            let rust_store = rust_store.clone();
            let resources = resources.clone();
            move |ctx, input| {
                let operations = operations.clone();
                let service_client = Arc::clone(&service_client);
                let rust_store = rust_store.clone();
                let resources = resources.clone();
                async move {
                    let ctx = ctx.into_request_context();
                    let operation_id = format!("harness-transfer-{}", unique_suffix());
                    let mut accepted = operations.accept(operation_id.clone()).await?;
                    let session_key =
                        ctx.session_key
                            .ok_or_else(|| ServerError::MissingSessionKey {
                                subject: HARNESS_RUST_UPLOAD_SUBJECT.to_string(),
                            })?;
                    let plan = plan_upload_transfer_grant(TransferUploadGrantArgs {
                        service_name: HARNESS_RUST_SERVICE_NAME,
                        session_key: &session_key,
                        service_session_key: &service_client.auth().session_key,
                        resources: &resources,
                        store: "uploads",
                        key: &input.key,
                        transfer_id: &operation_id,
                        expires_at: "2099-01-01T00:00:00.000Z",
                        chunk_bytes: 65_536,
                        max_bytes: Some(1_024),
                        content_type: input.content_type.as_deref(),
                        metadata: BTreeMap::new(),
                    })?;
                    let traced_transfer = input.key == TRACE_UPLOAD_KEY;
                    let chunk_traceparent = Arc::new(Mutex::new(None));
                    let grant = plan.grant.clone();
                    accepted.transfer = Some(grant);
                    let completion = if traced_transfer {
                        spawn_upload_transfer_endpoint_with_completion(
                            service_client.nats().clone(),
                            UploadTransferSession::new(plan, "2026-05-11T00:00:00.000Z"),
                            rust_store.clone(),
                            RecordingTransferValidator::new(
                                DefaultRequestValidator::new(Arc::clone(&service_client)),
                                Arc::clone(&chunk_traceparent),
                            ),
                        )
                        .await?
                    } else {
                        spawn_upload_transfer_endpoint_with_completion(
                            service_client.nats().clone(),
                            UploadTransferSession::new(plan, "2026-05-11T00:00:00.000Z"),
                            rust_store.clone(),
                            DefaultRequestValidator::new(Arc::clone(&service_client)),
                        )
                        .await?
                    };
                    let control = operations.control(operation_id).await?;
                    let traceparent = if traced_transfer {
                        Some(ctx.traceparent.ok_or_else(|| {
                            ServerError::Nats("missing transfer upload traceparent".to_string())
                        })?)
                    } else {
                        None
                    };
                    if input.key.contains("oversized") {
                        tokio::spawn(async move {
                            if let Err(error) = async {
                                control.started().await?;
                                control
                                    .fail(OperationFailure {
                                        message: "oversized upload rejected".to_string(),
                                    })
                                    .await?;
                                Ok::<(), ServerError>(())
                            }
                            .await
                            {
                                eprintln!(
                                    "warning: failed to fail oversized Rust transfer operation: {error}"
                                );
                            }
                        });
                        return Ok(accepted);
                    }
                    tokio::spawn(async move {
                        if let Err(error) = complete_uploaded_operation(
                            control,
                            rust_store,
                            input,
                            completion,
                            traceparent,
                            traced_transfer.then_some(chunk_traceparent),
                        )
                        .await
                        {
                            eprintln!(
                                "warning: failed to complete Rust transfer operation: {error}"
                            );
                        }
                    });
                    Ok(accepted)
                }
            }
        },
        {
            let operations = operations.clone();
            move |_ctx, operation_id| {
                let operations = operations.clone();
                async move { operations.get(operation_id).await }
            }
        },
        move |_ctx, operation_id| {
            let operations = operations.clone();
            async move { operations.wait(operation_id).await }
        },
        |_ctx, _operation_id| async move {
            Err(ServerError::OperationUnsupportedControl {
                operation: "Harness.Rust.TransferUpload".to_string(),
                action: "cancel".to_string(),
            })
        },
    );
    service.register_rpc::<HarnessRustDownloadRpc, _, _>({
        let service_client = Arc::clone(&service_client);
        let rust_store = rust_store.clone();
        let resources = resources.clone();
        move |ctx, input| {
            let service_client = Arc::clone(&service_client);
            let rust_store = rust_store.clone();
            let resources = resources.clone();
            async move {
                let ctx = ctx.into_request_context();
                let bytes = Bytes::from(format!("rust-download:{}", input.key));
                rust_store.write(&input.key, bytes.clone()).await?;
                let session_key =
                    ctx.session_key
                        .ok_or_else(|| ServerError::MissingSessionKey {
                            subject: HARNESS_RUST_DOWNLOAD_SUBJECT.to_string(),
                        })?;
                let plan = plan_download_transfer_grant(TransferDownloadGrantArgs {
                    service_name: HARNESS_RUST_SERVICE_NAME,
                    session_key: &session_key,
                    service_session_key: &service_client.auth().session_key,
                    resources: &resources,
                    store: "uploads",
                    transfer_id: &format!("download-{}", unique_suffix()),
                    expires_at: "2099-01-01T00:00:00.000Z",
                    chunk_bytes: 65_536,
                    info: FileTransferInfo {
                        key: input.key,
                        size: bytes.len() as u64,
                        updated_at: "2026-05-11T00:00:00.000Z".to_string(),
                        digest: None,
                        content_type: Some("text/plain".to_string()),
                        metadata: BTreeMap::new(),
                    },
                })?;
                let grant = plan.grant.clone();
                spawn_download_transfer_endpoint(
                    service_client.nats().clone(),
                    plan,
                    rust_store,
                    DefaultRequestValidator::new(Arc::clone(&service_client)),
                )
                .await?;
                serde_json::to_value(grant).map_err(ServerError::Json)
            }
        }
    });

    let service_task = tokio::spawn(async move { service.run().await });

    let ts_service = TsServiceProcess::start(trellis_url, &contract_digest, &ts_service_seed)?;
    ts_service.wait_ready().await?;

    let call_result = async {
        let caller_contract_json = harness_caller_contract_json()?;
        let caller_login = reauth_contract(
            &setup_login.state,
            &caller_contract_json,
            trellis_url,
            browser,
        )
        .await?;
        {
            let caller_client = connect_admin_client_async(&caller_login.state)
                .await
                .into_diagnostic()?;
            assert_rust_upload::<HarnessRustUploadOperation>(
                &caller_client,
                "rust-client/rust-upload.txt",
                b"rust to rust upload",
            )
            .await?;
            assert_rust_upload::<HarnessTsUploadOperation>(
                &caller_client,
                "rust-client/ts-upload.txt",
                b"rust to ts upload",
            )
            .await?;
            assert_rust_oversized_upload::<HarnessRustUploadOperation>(
                &caller_client,
                "rust-client/rust-oversized.bin",
            )
            .await?;
            assert_rust_oversized_upload::<HarnessTsUploadOperation>(
                &caller_client,
                "rust-client/ts-oversized.bin",
            )
            .await?;
            assert_rust_download::<HarnessRustDownloadRpc>(
                &caller_client,
                "rust-client/rust-download.txt",
                b"rust-download:rust-client/rust-download.txt",
            )
            .await?;
            assert_rust_download::<HarnessTsDownloadRpc>(
                &caller_client,
                "rust-client/ts-download.txt",
                b"ts-download:rust-client/ts-download.txt",
            )
            .await?;
        }

        run_ts_client(trellis_url, &caller_login.state.session_seed).await?;
        assert_session_mismatch_denied(trellis_url, &caller_login.state, browser).await?;
        Ok(PASSING_CASES)
    }
    .await;
    service_task.abort();
    drop(ts_service);
    call_result
}

async fn complete_uploaded_operation(
    control: trellis_rs::service::OperationControl<HarnessRustUploadOperation>,
    store: InMemoryStore,
    input: UploadInput,
    completion: UploadTransferCompletion,
    traceparent: Option<String>,
    chunk_traceparent: Option<Arc<Mutex<Option<String>>>>,
) -> Result<(), ServerError> {
    control.started().await?;
    let info = match tokio::time::timeout(Duration::from_secs(10), completion.completed()).await {
        Err(_) => {
            let error = ServerError::Nats("timed out waiting for upload completion".to_string());
            control
                .fail(OperationFailure {
                    message: error.to_string(),
                })
                .await?;
            return Err(error);
        }
        Ok(info) => info,
    };
    let info = match info {
        Ok(info) => info,
        Err(error) => {
            control
                .fail(OperationFailure {
                    message: error.to_string(),
                })
                .await?;
            return Err(error);
        }
    };
    let bytes = match store.read(&input.key).await {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            let error = ServerError::Nats(format!(
                "upload completion reported '{}', but the object was not readable",
                input.key
            ));
            control
                .fail(OperationFailure {
                    message: error.to_string(),
                })
                .await?;
            return Err(error);
        }
        Err(error) => {
            control
                .fail(OperationFailure {
                    message: error.to_string(),
                })
                .await?;
            return Err(error);
        }
    };
    if info.key != input.key || info.size != bytes.len() as u64 {
        let error = ServerError::Nats(format!(
            "upload completion info mismatch for '{}': {:?}",
            input.key, info
        ));
        control
            .fail(OperationFailure {
                message: error.to_string(),
            })
            .await?;
        return Err(error);
    }
    let chunk_traceparent = if let Some(recorded) = chunk_traceparent {
        let Some(chunk_traceparent) = recorded.lock().await.clone() else {
            let error = ServerError::Nats("missing transfer chunk traceparent".to_string());
            control
                .fail(OperationFailure {
                    message: error.to_string(),
                })
                .await?;
            return Err(error);
        };
        let Some(operation_trace_id) = traceparent.as_deref().and_then(trace_id_from_traceparent)
        else {
            let error = ServerError::Nats("invalid operation traceparent".to_string());
            control
                .fail(OperationFailure {
                    message: error.to_string(),
                })
                .await?;
            return Err(error);
        };
        let Some(chunk_trace_id) = trace_id_from_traceparent(&chunk_traceparent) else {
            let error = ServerError::Nats("invalid transfer chunk traceparent".to_string());
            control
                .fail(OperationFailure {
                    message: error.to_string(),
                })
                .await?;
            return Err(error);
        };
        if chunk_trace_id != operation_trace_id {
            let error = ServerError::Nats(format!(
                "transfer chunk trace id {chunk_trace_id} did not match operation trace id {operation_trace_id}"
            ));
            control
                .fail(OperationFailure {
                    message: error.to_string(),
                })
                .await?;
            return Err(error);
        }
        Some(chunk_traceparent)
    } else {
        None
    };
    control
        .complete(UploadOutput {
            key: input.key,
            size: info.size,
            content_type: input.content_type,
            traceparent,
            chunk_traceparent,
        })
        .await?;
    Ok(())
}

fn trace_id_from_traceparent(traceparent: &str) -> Option<&str> {
    traceparent
        .split('-')
        .nth(1)
        .filter(|trace_id| trace_id.len() == 32)
}

async fn assert_rust_upload<O>(client: &TrellisClient, key: &str, bytes: &[u8]) -> Result<()>
where
    O: trellis_rs::client::TransferOperationDescriptor<
        Input = UploadInput,
        Progress = Value,
        Output = UploadOutput,
    >,
{
    let input = UploadInput {
        key: key.to_string(),
        content_type: Some("text/plain".to_string()),
    };
    let started = client
        .operation::<O>()
        .input(&input)
        .transfer(bytes)
        .start()
        .await
        .map_err(|error| miette!("{} transfer start failed: {error:?}", O::KEY))?;
    if started.file_info().size != bytes.len() as u64 {
        return Err(miette!("{} upload file info mismatch", O::KEY));
    }
    let terminal = started.operation_ref().wait().await.into_diagnostic()?;
    if terminal.state != OperationState::Completed {
        return Err(miette!("{} wait returned {:?}", O::KEY, terminal.state));
    }
    let output = terminal
        .output
        .ok_or_else(|| miette!("{} completed without output", O::KEY))?;
    if output.key != key || output.size != bytes.len() as u64 {
        return Err(miette!("{} output mismatch: {output:?}", O::KEY));
    }
    if output.traceparent.is_some() {
        return Err(miette!(
            "{} unexpectedly returned traceparent {:?}",
            O::KEY,
            output.traceparent
        ));
    }
    Ok(())
}

async fn assert_rust_oversized_upload<O>(client: &TrellisClient, key: &str) -> Result<()>
where
    O: trellis_rs::client::TransferOperationDescriptor<
        Input = UploadInput,
        Progress = Value,
        Output = UploadOutput,
    >,
{
    let input = UploadInput {
        key: key.to_string(),
        content_type: Some("application/octet-stream".to_string()),
    };
    let oversized = vec![b'x'; 1_025];
    match client
        .operation::<O>()
        .input(&input)
        .transfer(&oversized)
        .start()
        .await
    {
        Ok(started) => Err(miette!(
            "{} unexpectedly accepted oversized upload with file info {:?}",
            O::KEY,
            started.file_info()
        )),
        Err(error) if matches!(error.source(), TrellisClientError::TransferProtocol(_)) => {
            let TrellisClientError::TransferProtocol(message) = error.source() else {
                unreachable!("matches! checked transfer protocol error")
            };
            if !message.contains("max") {
                return Err(miette!(
                    "{} oversized upload returned unexpected transfer error `{message}`",
                    O::KEY
                ));
            }
            Ok(())
        }
        Err(error) => Err(miette!(
            "{} oversized upload returned unexpected error: {:?}",
            O::KEY,
            error
        )),
    }
}

async fn assert_rust_download<R>(
    client: &TrellisClient,
    key: &str,
    expected: &[u8],
) -> Result<Value>
where
    R: trellis_rs::client::RpcDescriptor<Input = DownloadInput, Output = Value>,
{
    let grant_value = client
        .call::<R>(&DownloadInput {
            key: key.to_string(),
        })
        .await
        .into_diagnostic()?;
    let grant = trellis_rs::client::download_transfer_grant_from_value(grant_value.clone())
        .into_diagnostic()?;
    let bytes = client.download_transfer(&grant).await.into_diagnostic()?;
    if bytes != expected {
        return Err(miette!(
            "{} download mismatch: {}",
            R::KEY,
            String::from_utf8_lossy(&bytes)
        ));
    }
    Ok(grant_value)
}

async fn assert_session_mismatch_denied(
    trellis_url: &str,
    caller_state: &trellis_rs::auth::AdminSessionState,
    browser: &BrowserContainer,
) -> Result<()> {
    let grant = {
        let caller_client = connect_admin_client_async(caller_state)
            .await
            .into_diagnostic()?;
        let grant_value = assert_rust_download::<HarnessRustDownloadRpc>(
            &caller_client,
            "denied/session-bound.txt",
            b"rust-download:denied/session-bound.txt",
        )
        .await?;
        trellis_rs::client::download_transfer_grant_from_value(grant_value).into_diagnostic()?
    };
    let denied_login = reauth_contract(
        caller_state,
        &harness_denied_contract_json()?,
        trellis_url,
        browser,
    )
    .await?;
    let denied_client = connect_admin_client_async(&denied_login.state)
        .await
        .into_diagnostic()?;
    if denied_client.download_transfer(&grant).await.is_ok() {
        return Err(miette!(
            "download transfer unexpectedly succeeded with a different caller session"
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Default)]
struct InMemoryStore {
    objects: Arc<Mutex<BTreeMap<String, Bytes>>>,
}

impl StoreResourceClient for InMemoryStore {
    async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        Ok(self.objects.lock().await.get(key).cloned())
    }

    async fn write(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        self.objects.lock().await.insert(key.to_string(), value);
        Ok(())
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        Ok(self.objects.lock().await.keys().cloned().collect())
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.objects.lock().await.remove(key);
        Ok(())
    }
}

fn rust_resources() -> ServiceResourceBindings {
    ServiceResourceBindings {
        store: BTreeMap::from([(
            "uploads".to_string(),
            StoreResourceBinding {
                name: "harness_transfer_uploads".to_string(),
                max_object_bytes: Some(1_048_576),
                max_total_bytes: Some(4_194_304),
                ttl_ms: 0,
            },
        )]),
        ..ServiceResourceBindings::default()
    }
}

#[derive(Debug)]
struct TsServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsServiceProcess {
    fn start(trellis_url: &str, contract_digest: &str, service_seed: &str) -> Result<Self> {
        let repo = repo_root()?;
        let script_path = deno_fixture_path("transfer/service.ts")?;
        let (stdout_log, stderr_log) = deno_fixture_log_paths("transfer-service")?;
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create TS transfer service stdout log: {error}"))?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| miette!("failed to create TS transfer service stderr log: {error}"))?;
        let child = std::process::Command::new("deno")
            .arg("run")
            .arg("-c")
            .arg(repo.join("js/deno.json"))
            .arg("--allow-env")
            .arg("--allow-sys")
            .arg("--allow-net")
            .arg("--allow-read")
            .arg(&script_path)
            .current_dir(repo.join("js"))
            .env("TRELLIS_URL", trellis_url)
            .env("HARNESS_CONTRACT_DIGEST", contract_digest)
            .env("HARNESS_TS_SERVICE_SEED", service_seed)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .map_err(|error| miette!("failed to start TS transfer service fixture: {error}"))?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    async fn wait_ready(&self) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if std::fs::read_to_string(&self.stdout_log)
                .unwrap_or_default()
                .contains("TS_TRANSFER_SERVICE_READY")
            {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS transfer service fixture readiness; stdout: {}; stderr: {}",
                    stdout,
                    stderr
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

impl Drop for TsServiceProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect TS transfer service child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS transfer service child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS transfer service child: {error}");
        }
    }
}

async fn run_ts_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    let repo = repo_root()?;
    let script_path = deno_fixture_path("transfer/client.ts")?;
    let caller_contract_json = harness_caller_contract_json()?;
    let caller_digest = digest_contract_json(&caller_contract_json).into_diagnostic()?;
    let output = std::process::Command::new("deno")
        .arg("run")
        .arg("-c")
        .arg(repo.join("js/deno.json"))
        .arg("--allow-env")
        .arg("--allow-sys")
        .arg("--allow-net")
        .arg("--allow-read")
        .arg(&script_path)
        .current_dir(repo.join("js"))
        .env("TRELLIS_URL", trellis_url)
        .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_digest)
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed)
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS transfer client fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS transfer client fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_TRANSFER_CLIENT_OK") {
        return Err(miette!(
            "TS transfer client fixture did not report success: {stdout}"
        ));
    }
    Ok(())
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    match trellis_rs::auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_rs::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_rs::auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge
                .complete(&admin_login.state.trellis_url)
                .await
                .into_diagnostic()
        }
    }
}

async fn reauth_contract(
    state: &trellis_rs::auth::AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis_rs::auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_rs::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_rs::auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge.complete(trellis_url).await.into_diagnostic()
        }
    }
}

async fn connect_service_with_retry(
    trellis_url: &str,
    contract_digest: &str,
    contract_json: &str,
    service_seed: &str,
) -> Result<TrellisClient, trellis_rs::client::TrellisClientError> {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url,
        contract_id: HARNESS_CONTRACT_ID,
        contract_digest,
        contract_json,
        session_key_seed_base64url: service_seed,
        timeout_ms: 5_000,
        retry_delay_ms: 250,
        authority_pending_timeout_ms: 30_000,
    })
    .await
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}
