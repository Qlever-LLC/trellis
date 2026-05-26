use std::collections::BTreeMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::StreamExt;
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis::auth::{
    connect_admin_client_async, generate_session_keypair, AdminLoginOutcome, AdminSessionState,
};
use trellis::client::{
    ServiceConnectOptions, ServiceConnectWithContractOptions, TrellisClient, TrellisClientError,
};
use trellis::contracts::{
    digest_contract_json, kv, rpc, store, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis::sdk::auth::types::{
    AuthEnvelopeExpansionsApproveRequest, AuthEnvelopeExpansionsListRequest,
    AuthEnvelopesExpandRequest,
};
use trellis::sdk::core::types::TrellisBindingsGetResponseBinding;
use trellis::service::{
    ConnectedServiceRuntime, CoreBootstrapBinding, KvResourceEntry, KvResourceHandle,
    KvResourceOperation, NatsKvResourceClient, NatsStoreResourceClient, ServerError,
    StoreResourceHandle, StoreWaitOptions,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::deno_fixture::{deno_fixture_log_paths, deno_fixture_path};
use crate::nats::ensure_resource_conflict_streams;
use crate::workspace::repo_root;

const PASSING_CASES: usize = 7;
const HARNESS_DEPLOYMENT_ID: &str = "harness.resources";
const HARNESS_PENDING_DEPLOYMENT_ID: &str = "harness.resources.pending";
const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.resources@v1";
const HARNESS_RUST_SERVICE_NAME: &str = "harness-resources-rust";
const HARNESS_RUST_SUBJECT: &str = "rpc.v1.Harness.Rust.Resources";
const HARNESS_TS_SUBJECT: &str = "rpc.v1.Harness.Ts.Resources";

pub(crate) fn harness_service_contract_json() -> Result<String> {
    harness_service_contract_json_with_store_limits(0, 4_194_304)
}

fn harness_service_contract_json_with_store_limits(
    store_ttl_ms: i64,
    max_total_bytes: i64,
) -> Result<String> {
    let input_schema = json!({
        "type": "object",
        "properties": {
            "key": { "type": "string" },
            "message": { "type": "string" }
        },
        "required": ["key", "message"]
    });
    let output_schema = json!({
        "type": "object",
        "properties": {
            "provider": { "type": "string" },
            "storeText": { "type": "string" },
            "kvMessage": { "type": "string" }
        },
        "required": ["provider", "storeText", "kvMessage"]
    });
    let record_schema = json!({
        "type": "object",
        "properties": {
            "message": { "type": "string" }
        },
        "required": ["message"]
    });

    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration Harness Resources",
        "Harness-owned service contract for service-bound resource lifecycle verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("ResourceExerciseInput", input_schema)
    .schema("ResourceExerciseOutput", output_schema)
    .schema("ResourceRecord", record_schema)
    .kv_resource(
        "records",
        kv("Store harness resource lifecycle records", "ResourceRecord")
            .required(true)
            .history(1)
            .ttl_ms(0),
    )
    .kv_resource(
        "optionalRecords",
        kv(
            "Store optional harness resource lifecycle records",
            "ResourceRecord",
        )
        .required(false)
        .history(1)
        .ttl_ms(0),
    )
    .store_resource(
        "blobs",
        store("Store harness resource lifecycle blobs")
            .required(true)
            .ttl_ms(store_ttl_ms)
            .max_object_bytes(1_048_576)
            .max_total_bytes(max_total_bytes),
    )
    .store_resource(
        "optionalBlobs",
        store("Store optional harness resource lifecycle blobs")
            .required(false)
            .ttl_ms(store_ttl_ms)
            .max_object_bytes(1_048_576)
            .max_total_bytes(max_total_bytes),
    )
    .rpc(
        "Harness.Rust.Resources",
        rpc(
            "v1",
            HARNESS_RUST_SUBJECT,
            "ResourceExerciseInput",
            "ResourceExerciseOutput",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .rpc(
        "Harness.Ts.Resources",
        rpc(
            "v1",
            HARNESS_TS_SUBJECT,
            "ResourceExerciseInput",
            "ResourceExerciseOutput",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .build()
    .map_err(|error| miette!("failed to build resources harness service contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize resources harness service contract: {error}"))
}

fn harness_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-resources-agent@v1",
        "Trellis Integration Resources Agent",
        "Verify delegated Rust agent login and harness resource calls.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID)
            .with_rpc_call(["Harness.Rust.Resources", "Harness.Ts.Resources"]),
    )
    .build()
    .map_err(|error| miette!("failed to build resources harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize resources harness caller contract: {error}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourceExerciseInput {
    key: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ResourceExerciseOutput {
    provider: String,
    store_text: String,
    kv_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourceRecord {
    message: String,
}

struct HarnessRustResourcesRpc;

impl trellis::client::RpcDescriptor for HarnessRustResourcesRpc {
    type Input = ResourceExerciseInput;
    type Output = ResourceExerciseOutput;

    const KEY: &'static str = "Harness.Rust.Resources";
    const SUBJECT: &'static str = HARNESS_RUST_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

struct HarnessTsResourcesRpc;

impl trellis::client::RpcDescriptor for HarnessTsResourcesRpc {
    type Input = ResourceExerciseInput;
    type Output = ResourceExerciseOutput;

    const KEY: &'static str = "Harness.Ts.Resources";
    const SUBJECT: &'static str = HARNESS_TS_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

pub(crate) async fn run_resources_fixture(
    trellis_url: &str,
    nats_url: &str,
    trellis_creds: &Path,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let (contract_digest, rust_service_seed, ts_service_seed) = {
        let admin_client = connect_admin_client_async(&setup_login.state)
            .await
            .into_diagnostic()?;
        let auth_client = trellis::auth::AuthClient::new(&admin_client);
        auth_client
            .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
            .await
            .into_diagnostic()?;
        ensure_optional_resource_conflicts(nats_url, trellis_creds, HARNESS_DEPLOYMENT_ID).await?;

        let sdk_auth_client = SdkAuthClient::new(&admin_client);
        let service_contract_json = harness_service_contract_json()?;
        let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
        sdk_auth_client
            .rpc()
            .auth()
            .envelopes_expand(&AuthEnvelopesExpandRequest {
                contract: contract_json_object(&service_contract_json)?,
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                expected_digest: contract_digest.clone(),
            })
            .await
            .into_diagnostic()?;
        assert_pending_resource_service_approval(
            trellis_url,
            &auth_client,
            &sdk_auth_client,
            &service_contract_json,
            &contract_digest,
            nats_url,
            trellis_creds,
        )
        .await?;

        let (rust_service_seed, rust_service_key) = generate_session_keypair();
        auth_client
            .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                instance_key: rust_service_key,
            })
            .await
            .into_diagnostic()?;
        let (ts_service_seed, ts_service_key) = generate_session_keypair();
        auth_client
            .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                instance_key: ts_service_key,
            })
            .await
            .into_diagnostic()?;

        (contract_digest, rust_service_seed, ts_service_seed)
    };

    let service_client = Arc::new(
        connect_service_with_retry(trellis_url, &contract_digest, &rust_service_seed)
            .await
            .into_diagnostic()?,
    );
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        HARNESS_RUST_SERVICE_NAME,
        Arc::clone(&service_client),
    )
    .map_err(|error| miette!("failed to create resources service runtime: {error}"))?;
    if service.kv_binding("optionalRecords").is_ok() {
        return Err(miette!("optionalRecords KV binding should be absent"));
    }
    if service.store_binding("optionalBlobs").is_ok() {
        return Err(miette!("optionalBlobs store binding should be absent"));
    }
    let kv_binding = service
        .kv_binding("records")
        .map_err(|error| miette!("failed to read Rust KV resource binding: {error}"))?
        .clone();
    let kv_client = service
        .kv_client("records")
        .await
        .map_err(|error| miette!("failed to open Rust KV resource client: {error}"))?;
    let kv: KvResourceHandle<NatsKvResourceClient> =
        KvResourceHandle::new("records", kv_binding, kv_client);
    let store_binding = service
        .store_binding("blobs")
        .map_err(|error| miette!("failed to read Rust store resource binding: {error}"))?
        .clone();
    let store_client = service
        .store_client("blobs")
        .await
        .map_err(|error| miette!("failed to open Rust store resource client: {error}"))?;
    let store: StoreResourceHandle<NatsStoreResourceClient> = StoreResourceHandle::new(
        HARNESS_RUST_SERVICE_NAME,
        "blobs",
        store_binding,
        store_client,
    );
    service.register_rpc::<HarnessRustResourcesRpc, _, _>(move |_ctx, input| {
        let kv = kv.clone();
        let store = store.clone();
        async move { exercise_rust_resources(&kv, &store, input).await }
    });
    let service_task = tokio::spawn(async move { service.run().await });

    let call_result = async {
        let mut ts_service =
            TsServiceProcess::start(trellis_url, &contract_digest, &ts_service_seed)?;
        ts_service.wait_ready().await?;

        let caller_contract_json = harness_caller_contract_json()?;
        let caller_login = reauth_contract(
            &setup_login.state,
            &caller_contract_json,
            trellis_url,
            browser,
        )
        .await?;
        let caller_client = connect_admin_client_async(&caller_login.state)
            .await
            .into_diagnostic()?;
        assert_rust_resource_rpc::<HarnessRustResourcesRpc>(
            &caller_client,
            "rust-client.rust-provider",
            "rust to rust resources",
            "rust",
        )
        .await?;
        assert_rust_resource_rpc::<HarnessTsResourcesRpc>(
            &caller_client,
            "rust-client.ts-provider",
            "rust to ts resources",
            "ts",
        )
        .await?;
        run_ts_client(trellis_url, &caller_login.state.session_seed).await?;
        drop(ts_service);
        Ok(PASSING_CASES)
    }
    .await;
    service_task.abort();
    call_result
}

async fn assert_pending_resource_service_approval(
    trellis_url: &str,
    auth_client: &trellis::auth::AuthClient<'_>,
    sdk_auth_client: &SdkAuthClient<'_>,
    contract_json: &str,
    contract_digest: &str,
    nats_url: &str,
    trellis_creds: &Path,
) -> Result<()> {
    auth_client
        .create_service_deployment(HARNESS_PENDING_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;
    ensure_optional_resource_conflicts(nats_url, trellis_creds, HARNESS_PENDING_DEPLOYMENT_ID)
        .await?;
    let (service_seed, service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: HARNESS_PENDING_DEPLOYMENT_ID.to_string(),
            instance_key: service_key,
        })
        .await
        .into_diagnostic()?;

    let connect_task = tokio::spawn(connect_pending_resource_service(
        trellis_url.to_string(),
        contract_digest.to_string(),
        contract_json.to_string(),
        service_seed,
    ));
    let pending_request_ids =
        wait_for_pending_resource_expansion_requests(sdk_auth_client, contract_digest).await?;
    for request_id in pending_request_ids {
        sdk_auth_client
            .rpc()
            .auth()
            .envelope_expansions_approve(&AuthEnvelopeExpansionsApproveRequest {
                request_id,
                reason: Some("integration harness resource service startup approval".to_string()),
            })
            .await
            .into_diagnostic()?;
    }

    let client = connect_task.await.into_diagnostic()??;
    assert_resource_bootstrap_binding(&client, contract_digest)
}

async fn connect_pending_resource_service(
    trellis_url: String,
    contract_digest: String,
    contract_json: String,
    service_seed: String,
) -> Result<TrellisClient> {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url: &trellis_url,
        contract_id: HARNESS_CONTRACT_ID,
        contract_digest: &contract_digest,
        contract_json: &contract_json,
        session_key_seed_base64url: &service_seed,
        timeout_ms: 5_000,
        retry_delay_ms: 250,
        approval_timeout_ms: 30_000,
    })
    .await
    .into_diagnostic()
}

async fn wait_for_pending_resource_expansion_requests(
    auth_client: &SdkAuthClient<'_>,
    contract_digest: &str,
) -> Result<Vec<String>> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        let response = auth_client
            .rpc()
            .auth()
            .envelope_expansions_list(&AuthEnvelopeExpansionsListRequest {
                deployment_id: Some(HARNESS_PENDING_DEPLOYMENT_ID.to_string()),
                limit: 20,
                offset: None,
                state: Some("pending".to_string()),
            })
            .await
            .into_diagnostic()?;
        let request_ids: Vec<_> = response
            .entries
            .into_iter()
            .filter(|request| {
                request.contract_id == HARNESS_CONTRACT_ID
                    && request.contract_digest == contract_digest
            })
            .map(|request| request.request_id)
            .collect();
        if !request_ids.is_empty() {
            return Ok(request_ids);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "timed out waiting for pending resource envelope expansion request"
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn assert_resource_bootstrap_binding(client: &TrellisClient, contract_digest: &str) -> Result<()> {
    let binding_value = client
        .service_bootstrap_binding()
        .cloned()
        .ok_or_else(|| miette!("pending resource service did not receive bootstrap binding"))?;
    let binding = serde_json::from_value::<TrellisBindingsGetResponseBinding>(binding_value)
        .map(CoreBootstrapBinding::new)
        .map_err(|error| miette!("invalid pending resource service bootstrap binding: {error}"))?;
    if binding.contract_id != HARNESS_CONTRACT_ID || binding.digest != contract_digest {
        return Err(miette!(
            "pending resource service bootstrap returned unexpected contract {} digest {}",
            binding.contract_id,
            binding.digest
        ));
    }

    let kv = binding
        .resources
        .kv
        .as_ref()
        .and_then(|resources| resources.get("records"))
        .ok_or_else(|| miette!("pending resource binding did not include records KV"))?;
    if kv.bucket.is_empty() || kv.history != 1 || kv.ttl_ms != 0 {
        return Err(miette!(
            "pending resource records KV binding had unexpected limits: bucket={}, history={}, ttl_ms={}",
            kv.bucket,
            kv.history,
            kv.ttl_ms
        ));
    }
    if binding
        .resources
        .kv
        .as_ref()
        .is_some_and(|resources| resources.contains_key("optionalRecords"))
    {
        return Err(miette!(
            "pending resource binding unexpectedly included optionalRecords KV"
        ));
    }

    let store = binding
        .resources
        .store
        .as_ref()
        .and_then(|resources| resources.get("blobs"))
        .ok_or_else(|| miette!("pending resource binding did not include blobs store"))?;
    if store.name.is_empty() || store.ttl_ms != 0 || store.max_total_bytes != Some(4_194_304) {
        return Err(miette!(
            "pending resource blobs store binding had unexpected limits: name={}, ttl_ms={}, max_total_bytes={:?}",
            store.name,
            store.ttl_ms,
            store.max_total_bytes
        ));
    }
    if binding
        .resources
        .store
        .as_ref()
        .is_some_and(|resources| resources.contains_key("optionalBlobs"))
    {
        return Err(miette!(
            "pending resource binding unexpectedly included optionalBlobs store"
        ));
    }
    Ok(())
}

async fn ensure_optional_resource_conflicts(
    nats_url: &str,
    trellis_creds: &Path,
    deployment_id: &str,
) -> Result<()> {
    ensure_resource_conflict_streams(
        nats_url,
        trellis_creds,
        deployment_id,
        HARNESS_CONTRACT_ID,
        &[("kv", "optionalRecords"), ("store", "optionalBlobs")],
    )
    .await
}

async fn exercise_rust_resources(
    kv: &KvResourceHandle<NatsKvResourceClient>,
    store: &StoreResourceHandle<NatsStoreResourceClient>,
    input: ResourceExerciseInput,
) -> Result<ResourceExerciseOutput, ServerError> {
    let store_key = format!("{}.rust.store", input.key);
    let store_text = format!("rust-store:{}", input.message);
    store
        .write(&store_key, Bytes::from(store_text.clone()))
        .await?;
    let waited_text = store
        .wait_for(
            &store_key,
            StoreWaitOptions {
                timeout: Some(Duration::from_secs(5)),
                poll_interval: Duration::from_millis(25),
            },
        )
        .await?;
    let read_text = store
        .read(&store_key)
        .await?
        .ok_or_else(|| ServerError::Nats(format!("missing store object {store_key}")))?;
    if waited_text != read_text {
        return Err(ServerError::Nats(format!(
            "store wait returned different bytes for {store_key}"
        )));
    }
    let missing_key = format!("{}.rust.wait-missing", input.key);
    let timeout = store
        .wait_for(
            &missing_key,
            StoreWaitOptions {
                timeout: Some(Duration::from_millis(50)),
                poll_interval: Duration::from_millis(10),
            },
        )
        .await
        .expect_err("missing object wait should time out");
    if !matches!(timeout, ServerError::StoreWaitTimeout { ref key, .. } if key == &missing_key) {
        return Err(ServerError::Nats(format!(
            "store wait returned unexpected timeout error for {missing_key}: {timeout}"
        )));
    }
    let canceled_key = format!("{}.rust.wait-canceled", input.key);
    let canceled = store
        .wait_for_with_cancel(
            &canceled_key,
            StoreWaitOptions {
                timeout: Some(Duration::from_secs(5)),
                poll_interval: Duration::from_millis(25),
            },
            async {
                tokio::time::sleep(Duration::from_millis(25)).await;
            },
        )
        .await
        .expect_err("missing object wait should be canceled");
    if !matches!(canceled, ServerError::StoreWaitCanceled { ref key, .. } if key == &canceled_key) {
        return Err(ServerError::Nats(format!(
            "store wait returned unexpected cancellation error for {canceled_key}: {canceled}"
        )));
    }
    if !store.list().await?.iter().any(|key| key == &store_key) {
        return Err(ServerError::Nats(format!(
            "store list did not include {store_key}"
        )));
    }
    store.delete(&store_key).await?;
    if store.read(&store_key).await?.is_some() {
        return Err(ServerError::Nats(format!(
            "store object {store_key} remained after delete"
        )));
    }

    let kv_key = format!("{}.rust.kv", input.key);
    let record = ResourceRecord {
        message: format!("rust-kv:{}", input.message),
    };
    let record_bytes = serde_json::to_vec(&record).map_err(ServerError::Json)?;
    let mut kv_watch = kv.watch(&kv_key).await?;
    kv.put(&kv_key, Bytes::from(record_bytes)).await?;
    let update_event = next_kv_event(&mut kv_watch, &kv_key, "initial put").await?;
    if update_event.operation != KvResourceOperation::Update {
        return Err(ServerError::Nats(format!(
            "kv watch returned unexpected operation for {kv_key}: {:?}",
            update_event.operation
        )));
    }
    let entry = kv
        .get_entry(&kv_key)
        .await?
        .ok_or_else(|| ServerError::Nats(format!("missing kv entry metadata {kv_key}")))?;
    if entry.revision != update_event.revision || entry.operation != KvResourceOperation::Update {
        return Err(ServerError::Nats(format!(
            "kv entry metadata did not match update event for {kv_key}"
        )));
    }
    let read_record = kv
        .get(&kv_key)
        .await?
        .ok_or_else(|| ServerError::Nats(format!("missing kv record {kv_key}")))?;
    if !kv.list().await?.iter().any(|key| key == &kv_key) {
        return Err(ServerError::Nats(format!(
            "kv list did not include {kv_key}"
        )));
    }
    let updated_record = ResourceRecord {
        message: format!("rust-kv-updated:{}", input.message),
    };
    let updated_revision = kv
        .update_revision(
            &kv_key,
            Bytes::from(serde_json::to_vec(&updated_record).map_err(ServerError::Json)?),
            entry.revision,
        )
        .await?;
    let revision_event = next_kv_event(&mut kv_watch, &kv_key, "revision update").await?;
    if revision_event.revision != updated_revision
        || revision_event.operation != KvResourceOperation::Update
    {
        return Err(ServerError::Nats(format!(
            "kv watch did not observe revision update for {kv_key}"
        )));
    }
    let stale_delete = kv.delete_revision(&kv_key, entry.revision).await;
    if stale_delete.is_ok() {
        return Err(ServerError::Nats(format!(
            "kv stale revision delete unexpectedly succeeded for {kv_key}"
        )));
    }
    kv.delete_revision(&kv_key, updated_revision).await?;
    let delete_event = next_kv_event(&mut kv_watch, &kv_key, "revision delete").await?;
    if delete_event.operation != KvResourceOperation::Delete {
        return Err(ServerError::Nats(format!(
            "kv watch returned unexpected delete operation for {kv_key}: {:?}",
            delete_event.operation
        )));
    }
    if kv.get(&kv_key).await?.is_some() {
        return Err(ServerError::Nats(format!(
            "kv record {kv_key} remained after delete"
        )));
    }
    let delete_entry = kv
        .get_entry(&kv_key)
        .await?
        .ok_or_else(|| ServerError::Nats(format!("missing kv delete entry metadata {kv_key}")))?;
    if delete_entry.operation != KvResourceOperation::Delete {
        return Err(ServerError::Nats(format!(
            "kv delete entry metadata had unexpected operation for {kv_key}: {:?}",
            delete_entry.operation
        )));
    }
    let read_record: ResourceRecord =
        serde_json::from_slice(&read_record).map_err(ServerError::Json)?;

    Ok(ResourceExerciseOutput {
        provider: "rust".to_string(),
        store_text: String::from_utf8(read_text.to_vec())
            .map_err(|error| ServerError::Nats(format!("store object was not UTF-8: {error}")))?,
        kv_message: read_record.message,
    })
}

async fn next_kv_event<W>(
    watch: &mut W,
    expected_key: &str,
    label: &str,
) -> Result<KvResourceEntry, ServerError>
where
    W: futures_util::Stream<Item = std::result::Result<KvResourceEntry, ServerError>> + Unpin,
{
    let event = tokio::time::timeout(Duration::from_secs(5), watch.next())
        .await
        .map_err(|_| ServerError::Nats(format!("timed out waiting for kv {label} event")))?
        .ok_or_else(|| ServerError::Nats(format!("kv watch ended before {label} event")))??;
    if event.key != expected_key {
        return Err(ServerError::Nats(format!(
            "kv watch returned key '{}' while waiting for {label} event for {expected_key}",
            event.key
        )));
    }
    Ok(event)
}

async fn assert_rust_resource_rpc<R>(
    client: &TrellisClient,
    key: &str,
    message: &str,
    provider: &str,
) -> Result<()>
where
    R: trellis::client::RpcDescriptor<
        Input = ResourceExerciseInput,
        Output = ResourceExerciseOutput,
    >,
{
    let output = client
        .call::<R>(&ResourceExerciseInput {
            key: key.to_string(),
            message: message.to_string(),
        })
        .await
        .into_diagnostic()?;
    if output.provider != provider {
        return Err(miette!("{} provider mismatch: {output:?}", R::KEY));
    }
    let expected_store = format!("{provider}-store:{message}");
    let expected_kv = format!("{provider}-kv:{message}");
    if output.store_text != expected_store || output.kv_message != expected_kv {
        return Err(miette!("{} output mismatch: {output:?}", R::KEY));
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
        let repo = repo_root()?;
        let script_path = deno_fixture_path("resources/service.ts")?;
        let (stdout_log, stderr_log) = deno_fixture_log_paths("resources-service")?;
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS resources service stdout log: {error}")
            })?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS resources service stderr log: {error}")
            })?;
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
            .map_err(|error| miette!("failed to start TS resources service fixture: {error}"))?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    async fn wait_ready(&mut self) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if std::fs::read_to_string(&self.stdout_log)
                .unwrap_or_default()
                .contains("TS_RESOURCES_SERVICE_READY")
            {
                return Ok(());
            }
            if let Some(status) =
                self.child.try_wait().into_diagnostic().map_err(|error| {
                    miette!("failed to inspect TS resources service child: {error}")
                })?
            {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "TS resources service fixture exited before readiness with status {status}; stdout: {}; stderr: {}",
                    stdout,
                    stderr
                ));
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS resources service fixture readiness; stdout: {}; stderr: {}",
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
                eprintln!("warning: failed to inspect TS resources service child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS resources service child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS resources service child: {error}");
        }
    }
}

async fn run_ts_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    let repo = repo_root()?;
    let script_path = deno_fixture_path("resources/client.ts")?;
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
        .map_err(|error| miette!("failed to run TS resources client fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS resources client fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_RESOURCES_CLIENT_OK") {
        return Err(miette!(
            "TS resources client fixture did not report success: {stdout}"
        ));
    }
    Ok(())
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    match trellis::auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis::auth::AdminReauthOutcome::Flow(challenge) => {
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
    state: &AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis::auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis::auth::AdminReauthOutcome::Flow(challenge) => {
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

fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse contract JSON object: {error}"))
}

async fn connect_service_with_retry(
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<TrellisClient, TrellisClientError> {
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
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
    }
    Err(last_error.expect("service connect retry should record at least one error"))
}
