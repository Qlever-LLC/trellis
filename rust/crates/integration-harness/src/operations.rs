use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::time::Duration;

use async_nats::jetstream::{self, kv};
use bytes::Bytes;
use futures_util::{StreamExt, TryStreamExt};
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_rs::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis_rs::client::{
    OperationEvent, OperationSnapshot, OperationState, ServiceConnectOptions, TrellisClient,
};
use trellis_rs::contracts::{
    digest_contract_json, operation, use_contract, ContractCapabilityMetadata, ContractKind,
    ContractManifestBuilder,
};
use trellis_rs::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis_rs::sdk::auth::types::AuthUsersUpdateRequest;
use trellis_rs::service::{
    ConnectedServiceRuntime, InMemoryOperationRuntime, ServerError, ServiceRuntimeError,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::deno_fixture::{deno_fixture_log_paths, deno_fixture_path};
use crate::deployment_authority::plan_accept_reconcile_deployment_authority;
use crate::nats::connect_service_nats_with_retry;
use crate::rpc::{trace_context_response, HarnessTraceContextResponse};
use crate::workspace::repo_root;

const HARNESS_DEPLOYMENT_ID: &str = "harness.operations";
const HARNESS_RUST_SERVICE_NAME: &str = "harness-operations-rust";
const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.operations@v1";
const HARNESS_RUST_OPERATION_SUBJECT: &str = "operations.v1.Harness.Rust.Operation";
const HARNESS_TS_OPERATION_SUBJECT: &str = "operations.v1.Harness.Ts.Operation";
const HARNESS_RUST_STATUS_SUBJECT: &str = "operations.v1.Harness.Rust.Status";
const HARNESS_TS_STATUS_SUBJECT: &str = "operations.v1.Harness.Ts.Status";
const HARNESS_RUST_CAPABILITY_SUBJECT: &str = "operations.v1.Harness.Rust.Capability";
const HARNESS_RUST_TRACE_OPERATION_SUBJECT: &str = "operations.v1.Harness.Rust.TraceOperation";
const HARNESS_CAPABILITY_CALL: &str = "trellis.integration-harness.operations::operation.call";
const HARNESS_CAPABILITY_READ: &str = "trellis.integration-harness.operations::operation.read";
const HARNESS_CAPABILITY_CANCEL: &str = "trellis.integration-harness.operations::operation.cancel";
const PASSING_CASES: usize = 70;

fn harness_service_contract_json() -> Result<String> {
    let payload_schema = json!({
        "type": "object",
        "properties": {
            "message": { "type": "string" },
            "mode": { "type": "string" }
        },
        "required": ["message"]
    });
    let select_workspace_signal_schema = json!({
        "type": "object",
        "properties": {
            "workspaceId": { "type": "string" }
        },
        "required": ["workspaceId"]
    });
    let continue_signal_schema = json!({
        "type": "object",
        "properties": {
            "confirmed": { "type": "boolean" }
        },
        "required": ["confirmed"]
    });
    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration Harness Operations",
        "Harness-owned service contract for full-stack Rust/TypeScript operations verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("OperationInput", payload_schema.clone())
    .schema("OperationProgress", payload_schema.clone())
    .schema("OperationOutput", payload_schema)
    .schema(
        "TraceContextResponse",
        json!({
            "type": "object",
            "properties": {
                "provider": { "type": "string" },
                "traceId": { "type": "string" },
                "traceparent": { "type": "string" }
            },
            "required": ["provider", "traceId", "traceparent"]
        }),
    )
    .schema("SelectWorkspaceSignal", select_workspace_signal_schema)
    .schema("ContinueSignal", continue_signal_schema)
    .capability(
        "operation.call",
        capability_metadata("Call capability-gated operation"),
    )
    .capability(
        "operation.read",
        capability_metadata("Read capability-gated operation"),
    )
    .capability(
        "operation.cancel",
        capability_metadata("Cancel capability-gated operation"),
    )
    .operation(
        "Harness.Rust.Operation",
        operation(
            "v1",
            HARNESS_RUST_OPERATION_SUBJECT,
            "OperationInput",
            Some("OperationProgress"),
            Some("OperationOutput"),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_observe_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .signal("selectWorkspace", "SelectWorkspaceSignal")
        .signal("continue", "ContinueSignal")
        .cancel(true),
    )
    .operation(
        "Harness.Ts.Operation",
        operation(
            "v1",
            HARNESS_TS_OPERATION_SUBJECT,
            "OperationInput",
            Some("OperationProgress"),
            Some("OperationOutput"),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_observe_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .signal("selectWorkspace", "SelectWorkspaceSignal")
        .signal("continue", "ContinueSignal")
        .cancel(true),
    )
    .operation(
        "Harness.Rust.Status",
        operation(
            "v1",
            HARNESS_RUST_STATUS_SUBJECT,
            "OperationInput",
            Some("OperationProgress"),
            Some("OperationOutput"),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_observe_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .cancel(false),
    )
    .operation(
        "Harness.Ts.Status",
        operation(
            "v1",
            HARNESS_TS_STATUS_SUBJECT,
            "OperationInput",
            Some("OperationProgress"),
            Some("OperationOutput"),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_observe_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .cancel(false),
    )
    .operation(
        "Harness.Rust.Capability",
        operation(
            "v1",
            HARNESS_RUST_CAPABILITY_SUBJECT,
            "OperationInput",
            Some("OperationProgress"),
            Some("OperationOutput"),
        )
        .with_call_capabilities(["operation.call"])
        .with_observe_capabilities(["operation.read"])
        .with_cancel_capabilities(["operation.cancel"])
        .cancel(true),
    )
    .operation(
        "Harness.Rust.TraceOperation",
        operation(
            "v1",
            HARNESS_RUST_TRACE_OPERATION_SUBJECT,
            "OperationInput",
            Some("TraceContextResponse"),
            Some("TraceContextResponse"),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_observe_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .cancel(false),
    )
    .build()
    .map_err(|error| miette!("failed to build operations harness service contract: {error}"))?;

    serde_json::to_string(&manifest).map_err(|error| {
        miette!("failed to serialize operations harness service contract: {error}")
    })
}

fn capability_metadata(description: &str) -> ContractCapabilityMetadata {
    ContractCapabilityMetadata {
        display_name: description.to_string(),
        description: description.to_string(),
        consequence: None,
    }
}

fn harness_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-operations-agent@v1",
        "Trellis Integration Agent",
        "Verify delegated Rust agent login and harness operation calls.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID).with_operation_call([
            "Harness.Rust.Operation",
            "Harness.Ts.Operation",
            "Harness.Rust.Status",
            "Harness.Ts.Status",
            "Harness.Rust.Capability",
            "Harness.Rust.TraceOperation",
        ]),
    )
    .build()
    .map_err(|error| miette!("failed to build operations harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize operations harness caller contract: {error}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HarnessOperationPayload {
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
}

struct HarnessRustOperation;

impl trellis_rs::client::OperationDescriptor for HarnessRustOperation {
    type Input = HarnessOperationPayload;
    type Progress = HarnessOperationPayload;
    type Output = HarnessOperationPayload;

    const KEY: &'static str = "Harness.Rust.Operation";
    const SUBJECT: &'static str = HARNESS_RUST_OPERATION_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = true;
}

struct HarnessRustStatus;

impl trellis_rs::client::OperationDescriptor for HarnessRustStatus {
    type Input = HarnessOperationPayload;
    type Progress = HarnessOperationPayload;
    type Output = HarnessOperationPayload;

    const KEY: &'static str = "Harness.Rust.Status";
    const SUBJECT: &'static str = HARNESS_RUST_STATUS_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}

struct HarnessRustCapability;

impl trellis_rs::client::OperationDescriptor for HarnessRustCapability {
    type Input = HarnessOperationPayload;
    type Progress = HarnessOperationPayload;
    type Output = HarnessOperationPayload;

    const KEY: &'static str = "Harness.Rust.Capability";
    const SUBJECT: &'static str = HARNESS_RUST_CAPABILITY_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[HARNESS_CAPABILITY_CALL];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[HARNESS_CAPABILITY_READ];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[HARNESS_CAPABILITY_CANCEL];
    const CANCELABLE: bool = true;
}

struct HarnessRustTraceOperation;

impl trellis_rs::client::OperationDescriptor for HarnessRustTraceOperation {
    type Input = HarnessOperationPayload;
    type Progress = HarnessTraceContextResponse;
    type Output = HarnessTraceContextResponse;

    const KEY: &'static str = "Harness.Rust.TraceOperation";
    const SUBJECT: &'static str = HARNESS_RUST_TRACE_OPERATION_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}

struct HarnessTsOperation;

impl trellis_rs::client::OperationDescriptor for HarnessTsOperation {
    type Input = HarnessOperationPayload;
    type Progress = HarnessOperationPayload;
    type Output = HarnessOperationPayload;

    const KEY: &'static str = "Harness.Ts.Operation";
    const SUBJECT: &'static str = HARNESS_TS_OPERATION_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = true;
}

struct HarnessTsStatus;

impl trellis_rs::client::OperationDescriptor for HarnessTsStatus {
    type Input = HarnessOperationPayload;
    type Progress = HarnessOperationPayload;
    type Output = HarnessOperationPayload;

    const KEY: &'static str = "Harness.Ts.Status";
    const SUBJECT: &'static str = HARNESS_TS_STATUS_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}

#[derive(Clone)]
struct RustOperationDurableStore {
    store: async_nats::jetstream::kv::Store,
}

impl RustOperationDurableStore {
    async fn open(nats: async_nats::Client, service_key: &str) -> Result<Self> {
        let bucket_suffix = service_key
            .get(..16)
            .ok_or_else(|| miette!("Rust operations service key was too short"))?;
        let bucket = format!("trellis_operations_{bucket_suffix}");
        let jetstream = jetstream::new(nats);
        let store = match jetstream.get_key_value(bucket.clone()).await {
            Ok(store) => store,
            Err(_) => jetstream
                .create_key_value(kv::Config {
                    bucket,
                    history: 5,
                    ..Default::default()
                })
                .await
                .map_err(|error| {
                    miette!("failed to create Rust operations durable KV bucket: {error}")
                })?,
        };
        Ok(Self { store })
    }

    async fn save_snapshot(
        &self,
        snapshot: &trellis_rs::service::OperationSnapshot<
            HarnessOperationPayload,
            HarnessOperationPayload,
        >,
    ) -> Result<(), ServerError> {
        let operation_id =
            snapshot
                .id
                .as_deref()
                .ok_or_else(|| ServerError::OperationInvalidId {
                    operation_id: String::new(),
                })?;
        let value = serde_json::to_vec(snapshot)?;
        self.store
            .put(operation_id, Bytes::from(value))
            .await
            .map_err(|error| ServerError::Nats(format!("failed to persist operation: {error}")))?;
        Ok(())
    }

    async fn load_snapshot(
        &self,
        operation_id: &str,
    ) -> Result<Option<trellis_rs::service::OperationSnapshot<Value, Value>>, ServerError> {
        let Some(value) = self
            .store
            .get(operation_id.to_string())
            .await
            .map_err(|error| ServerError::Nats(format!("failed to load operation: {error}")))?
        else {
            return Ok(None);
        };
        serde_json::from_slice(&value)
            .map(Some)
            .map_err(ServerError::Json)
    }
}

pub(crate) async fn run_operations_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis_rs::auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let service_contract_json = harness_service_contract_json()?;
    let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    let sdk_auth_client = SdkAuthClient::new(&admin_client);
    plan_accept_reconcile_deployment_authority(
        &sdk_auth_client,
        HARNESS_DEPLOYMENT_ID,
        &service_contract_json,
        &contract_digest,
        "integration harness operations service setup",
    )
    .await?;

    let (rust_service_seed, rust_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(
            &trellis_rs::sdk::auth::AuthServiceInstancesProvisionRequest {
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                instance_key: rust_service_key.clone(),
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

    let service_client = Arc::new(
        connect_service_with_retry(trellis_url, &contract_digest, &rust_service_seed)
            .await
            .into_diagnostic()?,
    );
    let service_nats = connect_service_nats_with_retry(
        trellis_url,
        HARNESS_CONTRACT_ID,
        &contract_digest,
        &rust_service_seed,
    )
    .await?;

    let rust_operation_store =
        RustOperationDurableStore::open(service_nats, &rust_service_key).await?;
    let mut rust_runtime = InMemoryOperationRuntime::new(HARNESS_RUST_SERVICE_NAME);
    assert_rust_provider_invalid_control(&rust_runtime).await?;
    let mut service_task = spawn_rust_operations_service(
        Arc::clone(&service_client),
        rust_runtime.clone(),
        rust_operation_store.clone(),
        contract_digest.clone(),
    );

    let mut ts_service = Some(TsServiceProcess::start(
        trellis_url,
        &contract_digest,
        &ts_service_seed,
    )?);
    ts_service
        .as_ref()
        .expect("TS service is set")
        .wait_ready()
        .await?;

    let call_result = async {
        let caller_contract_json = harness_caller_contract_json()?;
        set_user_capabilities(
            &auth_client,
            &setup_login.user.user_id,
            &[
                HARNESS_CAPABILITY_CALL,
                HARNESS_CAPABILITY_READ,
                HARNESS_CAPABILITY_CANCEL,
            ],
        )
        .await?;
        let caller_login =
            match trellis_rs::auth::start_admin_reauth(&setup_login.state, &caller_contract_json)
                .await
                .into_diagnostic()?
            {
                trellis_rs::auth::AdminReauthOutcome::Bound(outcome) => outcome,
                trellis_rs::auth::AdminReauthOutcome::Flow(challenge) => {
                    let login_url = challenge.login_url().to_string();
                    let driver = browser.driver().await?;
                    let login_result = complete_local_login(
                        &driver,
                        &login_url,
                        "admin",
                        "trellis-admin-password",
                    )
                    .await;
                    let quit_result = driver
                        .quit()
                        .await
                        .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
                    login_result?;
                    quit_result?;
                    challenge.complete(trellis_url).await.into_diagnostic()?
                }
            };
        let caller_client = connect_admin_client_async(&caller_login.state)
            .await
            .into_diagnostic()?;
        let capability_admin_login = login_admin_setup(trellis_url, browser).await?;
        let capability_admin_client = connect_admin_client_async(&capability_admin_login.state)
            .await
            .into_diagnostic()?;
        let capability_auth_client = trellis_rs::auth::AuthClient::new(&capability_admin_client);
        assert_operation_capability_derivation(
            &capability_auth_client,
            &caller_login.user.user_id,
            &caller_login.state,
        )
        .await?;
        assert_rust_client_normal::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-operation",
        )
        .await?;
        assert_rust_client_normal::<HarnessTsOperation>(&caller_client, "rust-client-ts-operation")
            .await?;
        assert_rust_client_watch::<HarnessRustOperation>(&caller_client, "rust-client-rust-watch")
            .await?;
        assert_rust_client_watch::<HarnessTsOperation>(&caller_client, "rust-client-ts-watch")
            .await?;
        assert_rust_client_cancel::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-cancel",
        )
        .await?;
        assert_rust_client_cancel::<HarnessTsOperation>(&caller_client, "rust-client-ts-cancel")
            .await?;
        assert_rust_client_deferred::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-deferred",
        )
        .await?;
        assert_rust_client_deferred::<HarnessTsOperation>(
            &caller_client,
            "rust-client-ts-deferred",
        )
        .await?;
        assert_rust_client_attach::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-attach",
        )
        .await?;
        assert_rust_client_attach::<HarnessTsOperation>(&caller_client, "rust-client-ts-attach")
            .await?;
        assert_rust_client_signal::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-signal",
        )
        .await?;
        assert_rust_client_signal::<HarnessTsOperation>(&caller_client, "rust-client-ts-signal")
            .await?;
        assert_rust_client_invalid_signal::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-invalid-signal",
        )
        .await?;
        assert_rust_client_invalid_signal::<HarnessTsOperation>(
            &caller_client,
            "rust-client-ts-invalid-signal",
        )
        .await?;
        assert_rust_client_invalid_control::<HarnessRustOperation, HarnessRustStatus>(
            &caller_client,
            "rust-client-rust-invalid-control",
        )
        .await?;
        assert_rust_client_invalid_control::<HarnessTsOperation, HarnessTsStatus>(
            &caller_client,
            "rust-client-ts-invalid-control",
        )
        .await?;
        run_ts_client(trellis_url, &caller_login.state.session_seed).await?;

        let (rust_rust_operation_id, rust_rust_input) =
            start_rust_client_completed::<HarnessRustOperation>(
                &caller_client,
                "rust-client-rust-durable-restart",
            )
            .await?;
        restart_rust_operations_service(
            &mut service_task,
            &mut rust_runtime,
            Arc::clone(&service_client),
            rust_operation_store.clone(),
            &rust_rust_operation_id,
            contract_digest.clone(),
        )
        .await?;
        assert_rust_client_resumed_completed::<HarnessRustOperation>(
            &caller_client,
            rust_rust_operation_id,
            &rust_rust_input,
        )
        .await?;
        let (rust_ts_operation_id, rust_ts_input) =
            start_rust_client_completed::<HarnessTsOperation>(
                &caller_client,
                "rust-client-ts-durable-restart",
            )
            .await?;
        restart_ts_operations_service(
            &mut ts_service,
            trellis_url,
            &contract_digest,
            &ts_service_seed,
        )
        .await?;
        assert_rust_client_resumed_completed::<HarnessTsOperation>(
            &caller_client,
            rust_ts_operation_id,
            &rust_ts_input,
        )
        .await?;
        let ts_rust_operation_ref = run_ts_client_durable_start(
            trellis_url,
            &caller_login.state.session_seed,
            "Harness.Rust.Operation",
            "ts-client-rust-durable-restart",
        )
        .await?;
        restart_rust_operations_service(
            &mut service_task,
            &mut rust_runtime,
            Arc::clone(&service_client),
            rust_operation_store.clone(),
            &parse_ts_operation_ref_id(&ts_rust_operation_ref)?,
            contract_digest.clone(),
        )
        .await?;
        run_ts_client_durable_assert(
            trellis_url,
            &caller_login.state.session_seed,
            "Harness.Rust.Operation",
            &ts_rust_operation_ref,
            "ts-client-rust-durable-restart",
        )
        .await?;
        let ts_ts_operation_ref = run_ts_client_durable_start(
            trellis_url,
            &caller_login.state.session_seed,
            "Harness.Ts.Operation",
            "ts-client-ts-durable-restart",
        )
        .await?;
        restart_ts_operations_service(
            &mut ts_service,
            trellis_url,
            &contract_digest,
            &ts_service_seed,
        )
        .await?;
        run_ts_client_durable_assert(
            trellis_url,
            &caller_login.state.session_seed,
            "Harness.Ts.Operation",
            &ts_ts_operation_ref,
            "ts-client-ts-durable-restart",
        )
        .await?;

        let (rust_rust_running_id, rust_rust_running_input) = accept_rust_running_operation(
            &rust_runtime,
            &rust_operation_store,
            "rust-client-rust-running-restart",
        )
        .await?;
        restart_rust_operations_service(
            &mut service_task,
            &mut rust_runtime,
            Arc::clone(&service_client),
            rust_operation_store.clone(),
            &rust_rust_running_id,
            contract_digest.clone(),
        )
        .await?;
        let rust_rust_complete = complete_rust_running_operation_after_signal(
            rust_runtime.clone(),
            rust_operation_store.clone(),
            rust_rust_running_id.clone(),
            rust_rust_running_input.clone(),
        );
        assert_rust_client_resumed_running_completed::<HarnessRustOperation>(
            &caller_client,
            rust_rust_running_id.clone(),
            &rust_rust_running_input,
            true,
        )
        .await?;
        rust_rust_complete.await.into_diagnostic()??;
        restart_rust_operations_service(
            &mut service_task,
            &mut rust_runtime,
            Arc::clone(&service_client),
            rust_operation_store.clone(),
            &rust_rust_running_id,
            contract_digest.clone(),
        )
        .await?;
        assert_rust_client_resumed_completed::<HarnessRustOperation>(
            &caller_client,
            rust_rust_running_id,
            &rust_rust_running_input,
        )
        .await?;

        let rust_ts_running_ref = start_ts_provider_running_operation(
            &mut ts_service,
            trellis_url,
            &contract_digest,
            &ts_service_seed,
            &caller_login.state.session_key,
        )
        .await?;
        let rust_ts_running_id = parse_ts_operation_ref_id(&rust_ts_running_ref)?;
        restart_ts_operations_service_with_env(
            &mut ts_service,
            trellis_url,
            &contract_digest,
            &ts_service_seed,
            &[
                ("HARNESS_TS_SERVICE_DURABLE_ACTION", "complete"),
                ("HARNESS_TS_SERVICE_DURABLE_ID", rust_ts_running_id.as_str()),
                ("HARNESS_TS_SERVICE_DURABLE_SIGNAL_COMPLETE", "1"),
                (
                    "HARNESS_TS_SERVICE_DURABLE_MESSAGE",
                    "rust-client-ts-running-restart",
                ),
            ],
        )
        .await?;
        assert_rust_client_resumed_running_completed::<HarnessTsOperation>(
            &caller_client,
            rust_ts_running_id,
            &HarnessOperationPayload {
                message: "rust-client-ts-running-restart".to_string(),
                mode: Some("durable-running".to_string()),
            },
            true,
        )
        .await?;

        let (ts_rust_running_id, ts_rust_running_input) = accept_rust_running_operation(
            &rust_runtime,
            &rust_operation_store,
            "ts-client-rust-running-restart",
        )
        .await?;
        let ts_rust_running_ref = rust_operation_ref_json::<HarnessRustOperation>(
            &ts_rust_running_id,
            HARNESS_RUST_SERVICE_NAME,
        )?;
        restart_rust_operations_service(
            &mut service_task,
            &mut rust_runtime,
            Arc::clone(&service_client),
            rust_operation_store.clone(),
            &ts_rust_running_id,
            contract_digest.clone(),
        )
        .await?;
        let ts_rust_complete = complete_rust_running_operation_after_signal(
            rust_runtime.clone(),
            rust_operation_store.clone(),
            ts_rust_running_id.clone(),
            ts_rust_running_input.clone(),
        );
        run_ts_client_durable_assert_running(
            trellis_url,
            &caller_login.state.session_seed,
            "Harness.Rust.Operation",
            &ts_rust_running_ref,
            "ts-client-rust-running-restart",
            true,
        )
        .await?;
        ts_rust_complete.await.into_diagnostic()??;
        restart_rust_operations_service(
            &mut service_task,
            &mut rust_runtime,
            Arc::clone(&service_client),
            rust_operation_store.clone(),
            &ts_rust_running_id,
            contract_digest.clone(),
        )
        .await?;
        run_ts_client_durable_assert(
            trellis_url,
            &caller_login.state.session_seed,
            "Harness.Rust.Operation",
            &ts_rust_running_ref,
            "ts-client-rust-running-restart",
        )
        .await?;

        let ts_ts_running_ref = start_ts_provider_running_operation(
            &mut ts_service,
            trellis_url,
            &contract_digest,
            &ts_service_seed,
            &caller_login.state.session_key,
        )
        .await?;
        let ts_ts_running_id = parse_ts_operation_ref_id(&ts_ts_running_ref)?;
        restart_ts_operations_service_with_env(
            &mut ts_service,
            trellis_url,
            &contract_digest,
            &ts_service_seed,
            &[
                ("HARNESS_TS_SERVICE_DURABLE_ACTION", "complete"),
                ("HARNESS_TS_SERVICE_DURABLE_ID", ts_ts_running_id.as_str()),
                ("HARNESS_TS_SERVICE_DURABLE_SIGNAL_COMPLETE", "1"),
                (
                    "HARNESS_TS_SERVICE_DURABLE_MESSAGE",
                    "ts-client-ts-running-restart",
                ),
            ],
        )
        .await?;
        run_ts_client_durable_assert_running(
            trellis_url,
            &caller_login.state.session_seed,
            "Harness.Ts.Operation",
            &ts_ts_running_ref,
            "ts-client-ts-running-restart",
            true,
        )
        .await?;
        set_user_capabilities(&capability_auth_client, &caller_login.user.user_id, &[]).await?;

        Ok(PASSING_CASES)
    }
    .await;
    service_task.abort();
    drop(ts_service);
    call_result
}

async fn login_admin_setup(
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    let challenge = trellis_rs::auth::start_agent_login(&trellis_rs::auth::StartAgentLoginOpts {
        trellis_url,
        contract_json: &contract_json,
    })
    .await
    .into_diagnostic()?;
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

fn spawn_rust_operations_service(
    service_client: Arc<TrellisClient>,
    runtime: InMemoryOperationRuntime,
    store: RustOperationDurableStore,
    contract_digest: String,
) -> tokio::task::JoinHandle<Result<(), ServiceRuntimeError>> {
    let operations = runtime.operation::<HarnessRustOperation>();
    let statuses = runtime.operation::<HarnessRustStatus>();
    let capability_operations = runtime.operation::<HarnessRustCapability>();
    let trace_operations = runtime.operation::<HarnessRustTraceOperation>();
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        HARNESS_RUST_SERVICE_NAME,
        Arc::clone(&service_client),
    )
    .expect("operations service client should include bootstrap binding");
    service.register_operation_with_watch_and_signal::<HarnessRustOperation, _, _, _, _, _, _, _, _, _>(
        {
            let operations = operations.clone();
            let store = store.clone();
            move |_ctx, input| {
                let operations = operations.clone();
                let store = store.clone();
                async move {
                    let operation_id = format!("harness-rust-{}", unique_suffix());
                    let accepted = operations.accept(operation_id.clone()).await?;
                    let control = operations.control(operation_id).await?;
                    tokio::spawn(async move {
                        if let Err(error) = update_rust_operation(control, store, input).await {
                            eprintln!("warning: failed to update Rust operation fixture: {error}");
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
        {
            let operations = operations.clone();
            move |_ctx, operation_id| {
                let operations = operations.clone();
                Box::pin(
                    futures_util::stream::once(async move { operations.watch(operation_id).await })
                        .try_flatten(),
                )
            }
        },
        {
            let operations = operations.clone();
            move |_ctx, operation_id| {
                let operations = operations.clone();
                async move { operations.cancel(operation_id).await }
            }
        },
        {
            let operations = operations.clone();
            move |_ctx, operation_id, signal, input| {
                let operations = operations.clone();
                async move {
                    validate_rust_signal(&signal, input.as_ref())?;
                    operations.signal(operation_id, signal, input).await
                }
            }
        },
    );
    service.register_operation::<HarnessRustStatus, _, _, _, _, _, _, _, _>(
        {
            let statuses = statuses.clone();
            move |_ctx, input| {
                let statuses = statuses.clone();
                async move {
                    let operation_id = format!("harness-rust-status-{}", unique_suffix());
                    let accepted = statuses.accept(operation_id.clone()).await?;
                    let control = statuses.control(operation_id).await?;
                    tokio::spawn(async move {
                        if let Err(error) = update_rust_status(control, input).await {
                            eprintln!("warning: failed to update Rust status fixture: {error}");
                        }
                    });
                    Ok(accepted)
                }
            }
        },
        {
            let statuses = statuses.clone();
            move |_ctx, operation_id| {
                let statuses = statuses.clone();
                async move { statuses.get(operation_id).await }
            }
        },
        {
            let statuses = statuses.clone();
            move |_ctx, operation_id| {
                let statuses = statuses.clone();
                async move { statuses.wait(operation_id).await }
            }
        },
        {
            let statuses = statuses.clone();
            move |_ctx, operation_id| {
                let statuses = statuses.clone();
                async move { statuses.cancel(operation_id).await }
            }
        },
    );
    service.register_operation::<HarnessRustCapability, _, _, _, _, _, _, _, _>(
        {
            let capability_operations = capability_operations.clone();
            move |_ctx, input| {
                let capability_operations = capability_operations.clone();
                async move {
                    let operation_id = format!("harness-rust-capability-{}", unique_suffix());
                    let accepted = capability_operations.accept(operation_id.clone()).await?;
                    let control = capability_operations.control(operation_id).await?;
                    tokio::spawn(async move {
                        if let Err(error) = update_rust_capability(control, input).await {
                            eprintln!(
                                "warning: failed to update Rust capability operation fixture: {error}"
                            );
                        }
                    });
                    Ok(accepted)
                }
            }
        },
        {
            let capability_operations = capability_operations.clone();
            move |_ctx, operation_id| {
                let capability_operations = capability_operations.clone();
                async move { capability_operations.get(operation_id).await }
            }
        },
        {
            let capability_operations = capability_operations.clone();
            move |_ctx, operation_id| {
                let capability_operations = capability_operations.clone();
                async move { capability_operations.wait(operation_id).await }
            }
        },
        {
            let capability_operations = capability_operations.clone();
            move |_ctx, operation_id| {
                let capability_operations = capability_operations.clone();
                async move { capability_operations.cancel(operation_id).await }
            }
        },
    );
    service.register_operation::<HarnessRustTraceOperation, _, _, _, _, _, _, _, _>(
        {
            let trace_operations = trace_operations.clone();
            move |ctx, _input| {
                let trace_operations = trace_operations.clone();
                async move {
                    let operation_id = format!("harness-rust-trace-{}", unique_suffix());
                    let accepted = trace_operations.accept(operation_id.clone()).await?;
                    let control = trace_operations.control(operation_id).await?;
                    control
                        .complete(trace_context_response("rust-operation", ctx.request())?)
                        .await?;
                    Ok(accepted)
                }
            }
        },
        {
            let trace_operations = trace_operations.clone();
            move |_ctx, operation_id| {
                let trace_operations = trace_operations.clone();
                async move { trace_operations.get(operation_id).await }
            }
        },
        {
            let trace_operations = trace_operations.clone();
            move |_ctx, operation_id| {
                let trace_operations = trace_operations.clone();
                async move { trace_operations.wait(operation_id).await }
            }
        },
        {
            let trace_operations = trace_operations.clone();
            move |_ctx, operation_id| {
                let trace_operations = trace_operations.clone();
                async move { trace_operations.cancel(operation_id).await }
            }
        },
    );
    let _ = contract_digest;
    tokio::spawn(async move { service.run().await })
}

async fn restart_rust_operations_service(
    service_task: &mut tokio::task::JoinHandle<Result<(), ServiceRuntimeError>>,
    runtime: &mut InMemoryOperationRuntime,
    service_client: Arc<TrellisClient>,
    store: RustOperationDurableStore,
    operation_id: &str,
    contract_digest: String,
) -> Result<()> {
    service_task.abort();
    tokio::time::sleep(Duration::from_millis(250)).await;
    let restored_runtime = InMemoryOperationRuntime::new(HARNESS_RUST_SERVICE_NAME);
    let operations = restored_runtime.operation::<HarnessRustOperation>();
    let snapshot = store
        .load_snapshot(operation_id)
        .await
        .map_err(|error| miette!("failed to restore Rust operation snapshot: {error}"))?
        .ok_or_else(|| {
            miette!("Rust operation '{operation_id}' was not persisted before restart")
        })?;
    operations
        .restore_snapshot(snapshot)
        .await
        .map_err(|error| miette!("failed to restore Rust operation runtime: {error}"))?;
    *runtime = restored_runtime.clone();
    *service_task =
        spawn_rust_operations_service(service_client, restored_runtime, store, contract_digest);
    tokio::time::sleep(Duration::from_millis(250)).await;
    Ok(())
}

async fn restart_ts_operations_service(
    ts_service: &mut Option<TsServiceProcess>,
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<()> {
    restart_ts_operations_service_with_env(
        ts_service,
        trellis_url,
        contract_digest,
        service_seed,
        &[],
    )
    .await
}

async fn restart_ts_operations_service_with_env(
    ts_service: &mut Option<TsServiceProcess>,
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
    extra_env: &[(&str, &str)],
) -> Result<()> {
    *ts_service = None;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let restarted =
        TsServiceProcess::start_with_env(trellis_url, contract_digest, service_seed, extra_env)?;
    restarted.wait_ready().await?;
    *ts_service = Some(restarted);
    Ok(())
}

async fn start_ts_provider_running_operation(
    ts_service: &mut Option<TsServiceProcess>,
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
    caller_session_key: &str,
) -> Result<String> {
    restart_ts_operations_service_with_env(
        ts_service,
        trellis_url,
        contract_digest,
        service_seed,
        &[
            ("HARNESS_TS_SERVICE_DURABLE_ACTION", "start"),
            ("HARNESS_TS_SERVICE_DURABLE_SESSION_KEY", caller_session_key),
        ],
    )
    .await?;
    ts_service
        .as_ref()
        .expect("TS service is set")
        .wait_durable_ref()
        .await
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

async fn update_rust_operation(
    control: trellis_rs::service::OperationControl<HarnessRustOperation>,
    store: RustOperationDurableStore,
    input: HarnessOperationPayload,
) -> Result<(), ServerError> {
    let mut signals = if input.mode.as_deref() == Some("signal") {
        Some(control.signals().await?)
    } else {
        None
    };
    let started = control.started().await?;
    store.save_snapshot(&started).await?;
    if input.mode.as_deref() == Some("durable-running") {
        return Ok(());
    }
    if let Some(signals) = signals.as_mut() {
        let first = signals.try_next().await?.ok_or_else(|| {
            ServerError::Nats("signal stream ended before selectWorkspace".into())
        })?;
        if first.signal != "selectWorkspace" {
            return Err(ServerError::Nats(format!(
                "expected selectWorkspace signal, got {}",
                first.signal
            )));
        }
        control.progress(input.clone()).await?;
        let second = signals
            .try_next()
            .await?
            .ok_or_else(|| ServerError::Nats("signal stream ended before continue".into()))?;
        if second.signal != "continue" {
            return Err(ServerError::Nats(format!(
                "expected continue signal, got {}",
                second.signal
            )));
        }
        let snapshot = control.complete(input).await?;
        store.save_snapshot(&snapshot).await?;
        return Ok(());
    }
    if input.mode.as_deref() == Some("watch") {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    control.progress(input.clone()).await?;
    if input.mode.as_deref() == Some("attach") {
        let snapshot = control
            .attach(async {
                let mut signals = control.signals().await?;
                let signal = signals.try_next().await?.ok_or_else(|| {
                    ServerError::Nats("attach signal stream ended before continue".into())
                })?;
                if signal.signal != "continue" {
                    return Err(ServerError::Nats(format!(
                        "expected attach continue signal, got {}",
                        signal.signal
                    )));
                }
                control.complete(input).await?;
                Ok::<(), ServerError>(())
            })
            .await?;
        store.save_snapshot(&snapshot).await?;
        return Ok(());
    }
    if input.mode.as_deref() == Some("watch") {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if input.mode.as_deref() == Some("deferred") {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if input.mode.as_deref() != Some("cancel") {
        let snapshot = control.complete(input).await?;
        store.save_snapshot(&snapshot).await?;
    }
    Ok(())
}

async fn update_rust_status(
    control: trellis_rs::service::OperationControl<HarnessRustStatus>,
    input: HarnessOperationPayload,
) -> Result<(), ServerError> {
    control.started().await?;
    control.progress(input.clone()).await?;
    if input.mode.as_deref() == Some("status") {
        return Ok(());
    }
    control.complete(input).await?;
    Ok(())
}

async fn update_rust_capability(
    control: trellis_rs::service::OperationControl<HarnessRustCapability>,
    input: HarnessOperationPayload,
) -> Result<(), ServerError> {
    control.started().await?;
    control.progress(input.clone()).await?;
    if input.mode.as_deref() != Some("cancel") {
        control.complete(input).await?;
    }
    Ok(())
}

async fn assert_rust_provider_invalid_control(runtime: &InMemoryOperationRuntime) -> Result<()> {
    let operations = runtime.operation::<HarnessRustOperation>();
    let statuses = runtime.operation::<HarnessRustStatus>();
    let operation_id = format!("harness-rust-provider-{}", unique_suffix());
    operations
        .accept(operation_id.clone())
        .await
        .map_err(|error| miette!("Rust provider accept failed: {error}"))?;

    let missing = operations.get("missing-rust-provider-operation").await;
    if missing.is_ok() {
        return Err(miette!("Rust provider accepted missing id get"));
    }

    let wrong_operation = statuses.control(operation_id.clone()).await;
    if wrong_operation.is_ok() {
        return Err(miette!("Rust provider accepted wrong operation control"));
    }

    let status_id = format!("harness-rust-provider-status-{}", unique_suffix());
    statuses
        .accept(status_id.clone())
        .await
        .map_err(|error| miette!("Rust provider status accept failed: {error}"))?;
    let status_cancel = statuses
        .control(status_id)
        .await
        .map_err(|error| miette!("Rust provider status control failed: {error}"))?
        .cancel()
        .await;
    if status_cancel.is_ok() {
        return Err(miette!("Rust provider accepted non-cancelable cancel"));
    }

    let control = operations
        .control(operation_id)
        .await
        .map_err(|error| miette!("Rust provider operation control failed: {error}"))?;
    control
        .complete(HarnessOperationPayload {
            message: "rust-provider-terminal".to_string(),
            mode: None,
        })
        .await
        .map_err(|error| miette!("Rust provider operation complete failed: {error}"))?;
    let terminal_update = control
        .progress(HarnessOperationPayload {
            message: "too late".to_string(),
            mode: None,
        })
        .await;
    if terminal_update.is_ok() {
        return Err(miette!("Rust provider accepted terminal update"));
    }

    Ok(())
}

async fn accept_rust_running_operation(
    runtime: &InMemoryOperationRuntime,
    store: &RustOperationDurableStore,
    message: &str,
) -> Result<(String, HarnessOperationPayload)> {
    let operations = runtime.operation::<HarnessRustOperation>();
    let operation_id = format!("harness-rust-{}", unique_suffix());
    operations
        .accept(operation_id.clone())
        .await
        .map_err(|error| miette!("failed to accept Rust running operation: {error}"))?;
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("durable-running".to_string()),
    };
    let control = operations
        .control(operation_id.clone())
        .await
        .map_err(|error| miette!("failed to control Rust running operation: {error}"))?;
    let started = control
        .started()
        .await
        .map_err(|error| miette!("failed to start Rust running operation: {error}"))?;
    store
        .save_snapshot(&started)
        .await
        .map_err(|error| miette!("failed to persist Rust running operation: {error}"))?;
    Ok((operation_id, input))
}

fn complete_rust_running_operation_after_signal(
    runtime: InMemoryOperationRuntime,
    store: RustOperationDurableStore,
    operation_id: String,
    input: HarnessOperationPayload,
) -> tokio::task::JoinHandle<Result<()>> {
    tokio::spawn(async move {
        let operations = runtime.operation::<HarnessRustOperation>();
        let control = operations
            .control(operation_id)
            .await
            .map_err(|error| miette!("failed to control restarted Rust operation: {error}"))?;
        let mut signals = control
            .signals()
            .await
            .map_err(|error| miette!("failed to subscribe to Rust operation signals: {error}"))?;
        let signal = tokio::time::timeout(Duration::from_secs(10), signals.try_next())
            .await
            .map_err(|_| miette!("timed out waiting for Rust operation completion signal"))?
            .map_err(|error| miette!("failed to read Rust operation completion signal: {error}"))?
            .ok_or_else(|| miette!("Rust operation signal stream ended before completion"))?;
        if signal.signal != "continue" {
            return Err(miette!(
                "expected Rust operation completion signal 'continue', got '{}'",
                signal.signal
            ));
        }
        let snapshot = control
            .complete(input)
            .await
            .map_err(|error| miette!("failed to complete restarted Rust operation: {error}"))?;
        store
            .save_snapshot(&snapshot)
            .await
            .map_err(|error| miette!("failed to persist completed Rust operation: {error}"))?;
        Ok(())
    })
}

fn validate_rust_signal(signal: &str, input: Option<&Value>) -> Result<(), ServerError> {
    let valid = match signal {
        "selectWorkspace" => input
            .and_then(|value| value.get("workspaceId"))
            .and_then(Value::as_str)
            .is_some(),
        "continue" => input
            .and_then(|value| value.get("confirmed"))
            .and_then(Value::as_bool)
            .is_some(),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(ServerError::Nats(format!("invalid signal '{signal}'")))
    }
}

async fn assert_rust_client_normal<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: None,
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let snapshot = reference.get().await.into_diagnostic()?;
    if !matches!(
        snapshot.state,
        OperationState::Pending | OperationState::Running | OperationState::Completed
    ) {
        return Err(miette!("{} get returned {:?}", O::KEY, snapshot.state));
    }
    let terminal = reference.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, &input)
}

async fn assert_operation_capability_derivation(
    auth_client: &trellis_rs::auth::AuthClient<'_>,
    user_id: &str,
    caller_state: &trellis_rs::auth::AdminSessionState,
) -> Result<()> {
    set_user_capabilities(
        auth_client,
        user_id,
        &[
            HARNESS_CAPABILITY_CALL,
            HARNESS_CAPABILITY_READ,
            HARNESS_CAPABILITY_CANCEL,
        ],
    )
    .await?;
    let full_client = connect_admin_client_async(caller_state)
        .await
        .into_diagnostic()?;
    let input = HarnessOperationPayload {
        message: "operation-capability-full".to_string(),
        mode: Some("cancel".to_string()),
    };
    let operation_ref = full_client
        .operation::<HarnessRustCapability>()
        .start(&input)
        .await
        .map_err(|error| miette!("capability operation full start failed: {error}"))?;
    let snapshot = operation_ref
        .get()
        .await
        .map_err(|error| miette!("capability operation full get failed: {error}"))?;
    if snapshot.state != OperationState::Running {
        return Err(miette!(
            "capability operation full get returned {:?}, expected running",
            snapshot.state
        ));
    }
    let cancelled = operation_ref
        .cancel()
        .await
        .map_err(|error| miette!("capability operation full cancel failed: {error}"))?;
    if cancelled.state != OperationState::Cancelled {
        return Err(miette!(
            "capability operation full cancel returned {:?}, expected cancelled",
            cancelled.state
        ));
    }

    set_user_capabilities(auth_client, user_id, &[]).await?;
    if connect_admin_client_async(caller_state).await.is_ok() {
        return Err(miette!(
            "capability operation caller reconnected after required capabilities were removed"
        ));
    }
    set_user_capabilities(
        auth_client,
        user_id,
        &[
            HARNESS_CAPABILITY_CALL,
            HARNESS_CAPABILITY_READ,
            HARNESS_CAPABILITY_CANCEL,
        ],
    )
    .await?;
    connect_admin_client_async(caller_state)
        .await
        .into_diagnostic()?;
    Ok(())
}

async fn set_user_capabilities(
    auth_client: &trellis_rs::auth::AuthClient<'_>,
    user_id: &str,
    capabilities: &[&str],
) -> Result<()> {
    let mut updated = vec!["admin".to_string()];
    updated.extend(
        capabilities
            .iter()
            .map(|capability| (*capability).to_string()),
    );
    auth_client
        .update_user(&AuthUsersUpdateRequest {
            user_id: user_id.to_string(),
            active: None,
            capabilities: Some(updated),
            capability_groups: None,
            email: None,
            name: None,
        })
        .await
        .into_diagnostic()?;
    Ok(())
}

async fn assert_rust_client_watch<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("watch".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let mut events = reference.watch().await.into_diagnostic()?;
    let mut saw_progress = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);

    loop {
        let event = tokio::time::timeout_at(deadline, events.next())
            .await
            .map_err(|_| miette!("{} watch timed out before completion", O::KEY))?
            .ok_or_else(|| miette!("{} watch ended before completion", O::KEY))?
            .into_diagnostic()?;

        match event {
            OperationEvent::Progress { snapshot } => {
                if snapshot.progress.as_ref() != Some(&input) {
                    return Err(miette!("{} watch progress did not echo input", O::KEY));
                }
                saw_progress = true;
            }
            OperationEvent::Completed { snapshot } => {
                if !saw_progress {
                    return Err(miette!("{} watch completed before progress", O::KEY));
                }
                return assert_completed_output::<O>(snapshot, &input);
            }
            OperationEvent::Failed { snapshot } => {
                return Err(miette!("{} watch failed: {:?}", O::KEY, snapshot));
            }
            OperationEvent::Cancelled { snapshot } => {
                return Err(miette!("{} watch cancelled: {:?}", O::KEY, snapshot));
            }
            OperationEvent::Accepted { .. }
            | OperationEvent::Started { .. }
            | OperationEvent::Transfer { .. } => {}
        }
    }
}

async fn assert_rust_client_cancel<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("cancel".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let cancelled = reference.cancel().await.into_diagnostic()?;
    if cancelled.state != OperationState::Cancelled {
        return Err(miette!("{} cancel returned {:?}", O::KEY, cancelled.state));
    }
    Ok(())
}

async fn assert_rust_client_deferred<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("deferred".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let terminal = reference.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, &input)
}

async fn assert_rust_client_attach<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("attach".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .map_err(|error| miette!("{} attach start failed: {error}", O::KEY))?;
    wait_until_running::<O>(&reference).await?;
    let running = reference
        .get()
        .await
        .map_err(|error| miette!("{} attach get failed: {error}", O::KEY))?;
    if running.progress.as_ref() != Some(&input) {
        return Err(miette!("{} attach progress did not echo input", O::KEY));
    }
    let signal = reference
        .signal("continue", Some(json!({ "confirmed": true })))
        .await
        .map_err(|error| miette!("{} attach signal failed: {error}", O::KEY))?;
    if signal.kind != "signal-accepted"
        || signal.operation_id != reference.id()
        || signal.signal != "continue"
        || signal.signal_sequence != 1
    {
        return Err(miette!(
            "{} attach signal ack was unexpected: {:?}",
            O::KEY,
            signal
        ));
    }
    let terminal = reference
        .wait()
        .await
        .map_err(|error| miette!("{} attach wait failed: {error}", O::KEY))?;
    assert_completed_output::<O>(terminal, &input)
}

async fn start_rust_client_completed<O>(
    client: &TrellisClient,
    message: &str,
) -> Result<(String, HarnessOperationPayload)>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: None,
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let terminal = reference.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, &input)?;
    let operation_id = reference.id().to_string();
    Ok((operation_id, input))
}

async fn assert_rust_client_resumed_completed<O>(
    client: &TrellisClient,
    operation_id: String,
    input: &HarnessOperationPayload,
) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let resumed = client
        .operation::<O>()
        .control(operation_id)
        .into_diagnostic()?;
    let snapshot = resumed.get().await.into_diagnostic()?;
    assert_completed_output::<O>(snapshot, &input)
}

async fn assert_rust_client_resumed_running_completed<O>(
    client: &TrellisClient,
    operation_id: String,
    input: &HarnessOperationPayload,
    signal_completion: bool,
) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let resumed = client
        .operation::<O>()
        .control(operation_id)
        .into_diagnostic()?;
    let running = resumed.get().await.into_diagnostic()?;
    if running.state != OperationState::Running {
        return Err(miette!(
            "{} durable running get returned {:?}",
            O::KEY,
            running.state
        ));
    }
    if signal_completion {
        resumed
            .signal("continue", Some(json!({ "confirmed": true })))
            .await
            .into_diagnostic()?;
    }
    let terminal = resumed.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, input)
}

fn rust_operation_ref_json<O>(operation_id: &str, service: &str) -> Result<String>
where
    O: trellis_rs::client::OperationDescriptor,
{
    serde_json::to_string(&trellis_rs::client::OperationRefData {
        id: operation_id.to_string(),
        service: service.to_string(),
        operation: O::KEY.to_string(),
    })
    .map_err(|error| miette!("failed to serialize Rust operation ref: {error}"))
}

async fn assert_rust_client_signal<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("signal".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    wait_until_running::<O>(&reference).await?;

    let first = reference
        .signal("selectWorkspace", Some(json!({ "workspaceId": message })))
        .await
        .into_diagnostic()?;
    if first.signal_sequence != 1 {
        return Err(miette!(
            "{} first signal sequence was {}",
            O::KEY,
            first.signal_sequence
        ));
    }

    let second = reference
        .signal("continue", Some(json!({ "confirmed": true })))
        .await
        .into_diagnostic()?;
    if second.signal_sequence != 2 {
        return Err(miette!(
            "{} second signal sequence was {}",
            O::KEY,
            second.signal_sequence
        ));
    }

    let terminal = reference.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, &input)?;

    let terminal_signal = reference
        .signal("continue", Some(json!({ "confirmed": true })))
        .await;
    if terminal_signal.is_ok() {
        return Err(miette!("{} accepted terminal signal", O::KEY));
    }
    Ok(())
}

async fn assert_rust_client_invalid_signal<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("cancel".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    wait_until_running::<O>(&reference).await?;

    let invalid = reference
        .signal("selectWorkspace", Some(json!({ "workspaceId": 123 })))
        .await;
    if invalid.is_ok() {
        return Err(miette!("{} accepted invalid signal payload", O::KEY));
    }
    let cancelled = reference.cancel().await.into_diagnostic()?;
    if cancelled.state != OperationState::Cancelled {
        return Err(miette!(
            "{} cancel after invalid signal returned {:?}",
            O::KEY,
            cancelled.state
        ));
    }
    Ok(())
}

async fn assert_rust_client_invalid_control<O, S>(
    client: &TrellisClient,
    message: &str,
) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
    S: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: None,
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;

    let missing = client
        .operation::<O>()
        .control(format!("missing-{message}"))
        .into_diagnostic()?
        .get()
        .await;
    if missing.is_ok() {
        return Err(miette!("{} accepted missing id get", O::KEY));
    }

    let wrong_operation = client
        .operation::<S>()
        .control(reference.id().to_string())
        .into_diagnostic()?
        .get()
        .await;
    if wrong_operation.is_ok() {
        return Err(miette!("{} accepted wrong operation get", O::KEY));
    }

    let terminal = reference.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, &input)?;
    let terminal_cancel = reference.cancel().await;
    if terminal_cancel.is_ok() {
        return Err(miette!("{} accepted terminal cancel", O::KEY));
    }

    let status_input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("status".to_string()),
    };
    let status = client
        .operation::<S>()
        .start(&status_input)
        .await
        .into_diagnostic()?;
    wait_until_running::<S>(&status).await?;
    let status_cancel = status.cancel().await;
    if status_cancel.is_ok() {
        return Err(miette!("{} accepted non-cancelable cancel", S::KEY));
    }

    Ok(())
}

async fn wait_until_running<O>(
    reference: &trellis_rs::client::OperationRef<'_, TrellisClient, O>,
) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = reference
            .get()
            .await
            .map_err(|error| miette!("{} get while waiting for running failed: {error}", O::KEY))?;
        if snapshot.state == OperationState::Running {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!("{} did not reach running state", O::KEY));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

fn assert_completed_output<O>(
    terminal: OperationSnapshot<HarnessOperationPayload, HarnessOperationPayload>,
    input: &HarnessOperationPayload,
) -> Result<()>
where
    O: trellis_rs::client::OperationDescriptor,
{
    if terminal.state != OperationState::Completed {
        return Err(miette!("{} wait returned {:?}", O::KEY, terminal.state));
    }
    if terminal.output.as_ref() != Some(input) {
        return Err(miette!("{} output did not echo the request", O::KEY));
    }
    Ok(())
}

#[derive(Debug)]
struct TsServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsServiceProcess {
    fn start(trellis_url: &str, contract_digest: &str, service_seed: &str) -> Result<Self> {
        Self::start_with_env(trellis_url, contract_digest, service_seed, &[])
    }

    fn start_with_env(
        trellis_url: &str,
        contract_digest: &str,
        service_seed: &str,
        extra_env: &[(&str, &str)],
    ) -> Result<Self> {
        let repo = repo_root()?;
        let script_path = deno_fixture_path("operations/service.ts")?;
        let (stdout_log, stderr_log) = deno_fixture_log_paths("operations-service")?;
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS operations service stdout log: {error}")
            })?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS operations service stderr log: {error}")
            })?;
        let mut command = std::process::Command::new("deno");
        command
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
            .stderr(Stdio::from(stderr));
        for (key, value) in extra_env {
            command.env(key, value);
        }
        let child = command
            .spawn()
            .into_diagnostic()
            .map_err(|error| miette!("failed to start TS operations service fixture: {error}"))?;
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
                .contains("TS_OPERATIONS_SERVICE_READY")
            {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS operations service fixture readiness; stdout: {}; stderr: {}",
                    stdout,
                    stderr
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    async fn wait_durable_ref(&self) -> Result<String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
            if let Some(reference) = stdout
                .lines()
                .find_map(|line| line.strip_prefix("TS_OPERATIONS_DURABLE_REF:"))
            {
                return Ok(reference.to_string());
            }
            if tokio::time::Instant::now() >= deadline {
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS operations durable ref; stdout: {}; stderr: {}",
                    stdout,
                    stderr
                ));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

impl Drop for TsServiceProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect TS operations service child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS operations service child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS operations service child: {error}");
        }
    }
}

async fn run_ts_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    let stdout = run_ts_client_process(trellis_url, caller_session_seed, &[]).await?;
    if !stdout.contains("TS_OPERATIONS_CLIENT_OK") {
        return Err(miette!(
            "TS operations client fixture did not report success: {stdout}"
        ));
    }
    Ok(())
}

async fn run_ts_client_durable_start(
    trellis_url: &str,
    caller_session_seed: &str,
    method: &str,
    message: &str,
) -> Result<String> {
    let stdout = run_ts_client_process(
        trellis_url,
        caller_session_seed,
        &[
            ("HARNESS_OPERATIONS_DURABLE_ACTION", "start"),
            ("HARNESS_OPERATIONS_DURABLE_METHOD", method),
            ("HARNESS_OPERATIONS_DURABLE_MESSAGE", message),
        ],
    )
    .await?;
    parse_ts_durable_ref(&stdout)
}

async fn run_ts_client_durable_assert(
    trellis_url: &str,
    caller_session_seed: &str,
    method: &str,
    operation_id: &str,
    message: &str,
) -> Result<()> {
    let stdout = run_ts_client_process(
        trellis_url,
        caller_session_seed,
        &[
            ("HARNESS_OPERATIONS_DURABLE_ACTION", "assert"),
            ("HARNESS_OPERATIONS_DURABLE_METHOD", method),
            ("HARNESS_OPERATIONS_DURABLE_REF", operation_id),
            ("HARNESS_OPERATIONS_DURABLE_MESSAGE", message),
        ],
    )
    .await?;
    if !stdout.contains("TS_OPERATIONS_CLIENT_OK") {
        return Err(miette!(
            "TS operations durable assert fixture did not report success: {stdout}"
        ));
    }
    Ok(())
}

async fn run_ts_client_durable_assert_running(
    trellis_url: &str,
    caller_session_seed: &str,
    method: &str,
    operation_ref: &str,
    message: &str,
    signal_completion: bool,
) -> Result<()> {
    let signal_completion = if signal_completion { "1" } else { "0" };
    let stdout = run_ts_client_process(
        trellis_url,
        caller_session_seed,
        &[
            ("HARNESS_OPERATIONS_DURABLE_ACTION", "assert-running"),
            ("HARNESS_OPERATIONS_DURABLE_METHOD", method),
            ("HARNESS_OPERATIONS_DURABLE_REF", operation_ref),
            ("HARNESS_OPERATIONS_DURABLE_MESSAGE", message),
            (
                "HARNESS_OPERATIONS_DURABLE_SIGNAL_COMPLETE",
                signal_completion,
            ),
        ],
    )
    .await?;
    if !stdout.contains("TS_OPERATIONS_CLIENT_OK") {
        return Err(miette!(
            "TS operations durable running assert fixture did not report success: {stdout}"
        ));
    }
    Ok(())
}

fn parse_ts_durable_ref(stdout: &str) -> Result<String> {
    stdout
        .lines()
        .find_map(|line| line.strip_prefix("TS_OPERATIONS_DURABLE_REF:"))
        .map(ToString::to_string)
        .ok_or_else(|| miette!("TS operations durable start did not print operation ref: {stdout}"))
}

fn parse_ts_operation_ref_id(operation_ref: &str) -> Result<String> {
    let operation_ref: trellis_rs::client::OperationRefData =
        serde_json::from_str(operation_ref)
            .map_err(|error| miette!("failed to parse TS operation ref: {error}"))?;
    Ok(operation_ref.id)
}

async fn run_ts_client_process(
    trellis_url: &str,
    caller_session_seed: &str,
    extra_env: &[(&str, &str)],
) -> Result<String> {
    let repo = repo_root()?;
    let script_path = deno_fixture_path("operations/client.ts")?;
    let caller_contract_json = harness_caller_contract_json()?;
    let caller_digest = digest_contract_json(&caller_contract_json).into_diagnostic()?;
    let mut command = std::process::Command::new("deno");
    command
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
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed);
    for (key, value) in extra_env {
        command.env(key, value);
    }
    let output = command
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS operations client fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS operations client fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.to_string())
}

async fn connect_service_with_retry(
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<TrellisClient, trellis_rs::client::TrellisClientError> {
    let mut last_error = None;
    for _ in 0..10 {
        match TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url,
            contract_id: HARNESS_CONTRACT_ID,
            contract_digest,
            session_key_seed_base64url: service_seed,
            timeout_ms: 5_000,
        })
        .await
        {
            Ok(client) => return Ok(client),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }

    Err(last_error.expect("service connect retry should record at least one error"))
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}
