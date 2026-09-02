use std::time::{Duration, Instant};

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::task::JoinHandle;
use trellis_rs::service::ServerError;

use crate::support::assertions::{assert_case_registered, assert_generated_service_contract};

const RESOURCES_SERVICE_ID: &str = "integration.resources-service@v1";
const RESOURCES_CLIENT_ID: &str = "integration.resources-client@v1";

const RESOURCES_SERVICE_API_SOURCE_JSON: &str = r#"{
  "format": "trellis.api.v1",
  "id": "integration.resources-service@v1",
  "version": "1.0.0",
  "displayName": "Trellis Integration Resources Service",
  "description": "Exercises service-bound KV and store resource handles.",
  "schemas": {
    "ResourceExerciseInput": {
      "type": "object",
      "required": ["key", "message"],
      "properties": {
        "key": { "type": "string" },
        "message": { "type": "string" }
      }
    },
    "ResourceExerciseOutput": {
      "type": "object",
      "required": ["provider", "storeText", "kvMessage"],
      "properties": {
        "provider": { "type": "string" },
        "storeText": { "type": "string" },
        "kvMessage": { "type": "string" }
      }
    },
    "ResourceRecord": {
      "type": "object",
      "required": ["message"],
      "properties": {
        "message": { "type": "string" }
      }
    }
  },
  "rpc": {
    "Resources.Exercise": {
      "version": "v1",
      "input": { "schema": "ResourceExerciseInput" },
      "output": { "schema": "ResourceExerciseOutput" },
      "errors": []
    }
  }
}"#;

const RESOURCES_SERVICE_PARTICIPANT_JSON: &str = r#"{
  "format": "trellis.participant.v1",
  "id": "integration.resources-service@v1",
  "displayName": "Trellis Integration Resources Service",
  "description": "Exercises service-bound KV and store resource handles.",
  "kind": "service",
  "implements": {},
  "schemas": {
    "ResourceRecord": {
      "type": "object",
      "required": ["message"],
      "properties": {"message": {"type": "string"}}
    }
  },
  "resources": {
    "kv": {
      "records": {"purpose": "Store integration resource records", "schema": {"schema": "ResourceRecord"}, "required": true, "history": 1, "ttlMs": 0},
      "optionalRecords": {"purpose": "Store optional integration resource records", "schema": {"schema": "ResourceRecord"}, "required": false, "history": 1, "ttlMs": 0}
    },
    "store": {
      "blobs": {"purpose": "Store integration resource blobs", "required": true, "ttlMs": 0, "maxObjectBytes": 1048576, "maxTotalBytes": 4194304},
      "optionalBlobs": {"purpose": "Store optional integration resource blobs", "required": false, "ttlMs": 0, "maxObjectBytes": 1048576, "maxTotalBytes": 4194304}
    }
  }
}"#;

pub(super) struct ResourcesServiceContract;

impl trellis_rs::service::GeneratedServiceContract for ResourcesServiceContract {
    const PARTICIPANT_ID: &'static str = RESOURCES_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "06LEDdG3AgrpkmHsBItJT6XghOFVFlyMx7DSOEkn3To";
    const PARTICIPANT_NEEDS_DIGEST: &'static str = "StMb2Ya091kvHLbIPBkoKGdIBQAr7sRZi-Lnsi-p9zs";
    const PARTICIPANT_JSON: &'static str = r#"{"description":"Exercises service-bound KV and store resource handles.","displayName":"Trellis Integration Resources Service","format":"trellis.participant.v1","id":"integration.resources-service@v1","implements":{"self":{"api":"integration.resources-service@v1","apiDigest":"x7DqkpJxRpFmBXkBICSOukfRvOmNESahpzzbEv6Le28"}},"kind":"service","resources":{"kv":{"optionalRecords":{"purpose":"Store optional integration resource records","required":false,"schema":{"schema":"ResourceRecord"}},"records":{"purpose":"Store integration resource records","schema":{"schema":"ResourceRecord"}}},"store":{"blobs":{"maxObjectBytes":1048576,"maxTotalBytes":4194304,"purpose":"Store integration resource blobs"},"optionalBlobs":{"maxObjectBytes":1048576,"maxTotalBytes":4194304,"purpose":"Store optional integration resource blobs","required":false}}},"schemas":{"ResourceRecord":{"properties":{"message":{"type":"string"}},"required":["message"],"type":"object"}}}"#;
    const API_JSON: &'static str = r#"{"description":"Exercises service-bound KV and store resource handles.","displayName":"Trellis Integration Resources Service","format":"trellis.api.v1","id":"integration.resources-service@v1","version":"1.0.0","rpc":{"Resources.Exercise":{"input":{"schema":"ResourceExerciseInput"},"output":{"schema":"ResourceExerciseOutput"},"version":"v1"}},"schemas":{"ResourceExerciseInput":{"properties":{"key":{"type":"string"},"message":{"type":"string"}},"required":["key","message"],"type":"object"},"ResourceExerciseOutput":{"properties":{"kvMessage":{"type":"string"},"provider":{"type":"string"},"storeText":{"type":"string"}},"required":["provider","storeText","kvMessage"],"type":"object"},"ResourceRecord":{"properties":{"message":{"type":"string"}},"required":["message"],"type":"object"}}}"#;
    const API_DIGEST: &'static str = "x7DqkpJxRpFmBXkBICSOukfRvOmNESahpzzbEv6Le28";
    const REFERENCED_API_ARTIFACTS: &'static [(&'static str, &'static str)] = &[];
}

#[test]
fn resources_service_contract_evidence_is_exact() {
    assert_generated_service_contract::<ResourcesServiceContract>(&resources_service_contract());
}

pub(super) fn resources_service_contract() -> trellis_test::TrellisTestContract {
    let api: Value = serde_json::from_str(RESOURCES_SERVICE_API_SOURCE_JSON)
        .expect("parse resources service API");
    let api_digest = trellis_rs::contracts::ApiBuilder::new(api)
        .build()
        .expect("validate resources service API")
        .digest()
        .expect("digest resources service API");
    let mut participant: Value = serde_json::from_str(RESOURCES_SERVICE_PARTICIPANT_JSON)
        .expect("parse resources service participant");
    participant["implements"] = serde_json::json!({
        "self": {"api": RESOURCES_SERVICE_ID, "apiDigest": api_digest}
    });
    trellis_test::TrellisTestContract::from_native_json(
        RESOURCES_SERVICE_API_SOURCE_JSON,
        &participant.to_string(),
    )
    .expect("build resources service test contract")
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

struct ResourcesExerciseRpc;

impl trellis_rs::client::RpcDescriptor for ResourcesExerciseRpc {
    type Input = ResourceExerciseInput;
    type Output = ResourceExerciseOutput;

    const KEY: &'static str = "Resources.Exercise";
    const SUBJECT: &'static str = "rpc.v1.Resources.Exercise";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["key","message"],"properties":{"key":{"type":"string"},"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["provider","storeText","kvMessage"],"properties":{"provider":{"type":"string"},"storeText":{"type":"string"},"kvMessage":{"type":"string"}}}"#;
}

struct AbortOnDrop<T> {
    handle: Option<JoinHandle<T>>,
}

impl<T> AbortOnDrop<T> {
    fn new(handle: JoinHandle<T>) -> Self {
        Self {
            handle: Some(handle),
        }
    }

    async fn abort_and_wait(mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            let _ = handle.await;
        }
    }
}

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.abort();
        }
    }
}

#[tokio::test]
async fn resources_service_receives_required_bindings() {
    assert_case_registered(
        "resources.service-receives-required-bindings",
        "resources",
        "resources",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = resources_service_contract();

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live resources service instance");

    let service =
        trellis_rs::service::ConnectedServiceRuntime::<ResourcesServiceContract>::connect(
            runtime.service_connect_options("resources-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust resources service");

    let resources = service.resources().clone();
    assert!(
        resources.kv.contains_key("records"),
        "expected kv.records binding"
    );
    assert_eq!(resources.kv["records"].history, 1);
    assert_eq!(resources.kv["records"].ttl_ms, 0);

    assert!(
        resources.store.contains_key("blobs"),
        "expected store.blobs binding"
    );
    assert_eq!(resources.store["blobs"].max_total_bytes, Some(4_194_304));
    assert_eq!(resources.store["blobs"].max_object_bytes, Some(1_048_576));

    let _ = service;
}

#[tokio::test]
async fn resources_service_receives_optional_bindings() {
    assert_case_registered(
        "resources.service-receives-optional-bindings",
        "resources",
        "resources",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = resources_service_contract();

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live resources service instance");

    let service =
        trellis_rs::service::ConnectedServiceRuntime::<ResourcesServiceContract>::connect(
            runtime.service_connect_options("resources-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust resources service");

    let resources = service.resources().clone();
    assert!(
        resources.kv.contains_key("optionalRecords"),
        "expected kv.optionalRecords binding"
    );
    assert_eq!(resources.kv["optionalRecords"].history, 1);

    assert!(
        resources.store.contains_key("optionalBlobs"),
        "expected store.optionalBlobs binding"
    );
    assert_eq!(
        resources.store["optionalBlobs"].max_object_bytes,
        Some(1_048_576)
    );

    let _ = service;
}

#[tokio::test]
async fn resources_service_store_create_read_list_delete() {
    assert_case_registered(
        "resources.service-store-create-read-list-delete",
        "resources",
        "resources",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = resources_service_contract();

    let client_contract =
        resources_client_contract(&service_contract).expect("build resources client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live resources service instance");

    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<ResourcesServiceContract>::connect(
            runtime.service_connect_options("resources-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust resources service");

    service.register_rpc::<ResourcesExerciseRpc, _, _>(|context, input| async move {
        let handle = context.handle().clone();
        let store = handle.store_client("blobs").await?;

        let store_key = format!("{}.store", input.key);
        let store_text = format!("store:{}", input.message);
        let mut source = std::io::Cursor::new(store_text.as_bytes());
        store
            .write_from(&store_key, &mut source, Some(store_text.len() as u64))
            .await?;
        let mut read_bytes = Vec::new();
        let info = store
            .read_into(&store_key, &mut read_bytes)
            .await?
            .ok_or_else(|| ServerError::Nats(format!("store missing {store_key}")))?;
        if info.size != read_bytes.len() as u64 {
            return Err(ServerError::Nats("store size mismatch".to_string()));
        }
        let read_text = String::from_utf8(read_bytes)
            .map_err(|_| ServerError::Nats("store text not utf-8".to_string()))?;

        let interrupted_key = format!("{}.interrupted", input.key);
        let (mut partial_writer, partial_reader) = tokio::io::duplex(64 * 1024);
        let partial_task = tokio::spawn(async move {
            partial_writer.write_all(&vec![7_u8; 64 * 1024]).await?;
            std::future::pending::<()>().await;
            Ok::<(), std::io::Error>(())
        });
        let interrupted = store
            .write_from_with_cancel(
                &interrupted_key,
                partial_reader,
                None,
                tokio::time::sleep(Duration::from_millis(100)),
            )
            .await;
        partial_task.abort();
        if !matches!(interrupted, Err(ServerError::StoreWriteCancelled)) {
            return Err(ServerError::Nats(format!(
                "interrupted new object returned {interrupted:?}"
            )));
        }
        if store.read(&interrupted_key).await?.is_some() {
            return Err(ServerError::Nats(
                "interrupted new object became visible".to_string(),
            ));
        }

        let previous = Bytes::from_static(b"previous complete value");
        store.write(&interrupted_key, previous.clone()).await?;
        let (mut replacement_writer, replacement_reader) = tokio::io::duplex(64 * 1024);
        let replacement_task = tokio::spawn(async move {
            replacement_writer.write_all(&vec![9_u8; 64 * 1024]).await?;
            std::future::pending::<()>().await;
            Ok::<(), std::io::Error>(())
        });
        let replacement = store
            .write_from_with_cancel(
                &interrupted_key,
                replacement_reader,
                None,
                tokio::time::sleep(Duration::from_millis(100)),
            )
            .await;
        replacement_task.abort();
        if !matches!(replacement, Err(ServerError::StoreWriteCancelled)) {
            return Err(ServerError::Nats(format!(
                "interrupted replacement returned {replacement:?}"
            )));
        }
        if store.read(&interrupted_key).await? != Some(previous) {
            return Err(ServerError::Nats(
                "interrupted replacement did not retain previous value".to_string(),
            ));
        }

        let listed = store.list().await?;
        if !listed.contains(&store_key) {
            return Err(ServerError::Nats(format!(
                "store list did not include {store_key}"
            )));
        }

        store.delete(&store_key).await?;
        store.delete(&interrupted_key).await?;

        Ok(ResourceExerciseOutput {
            provider: "rust".to_string(),
            store_text: read_text,
            kv_message: String::new(),
        })
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust resources client");

    let output =
        call_resources_exercise_with_retry(&client, "client.resource", "client to resources").await;

    assert_eq!(
        output,
        ResourceExerciseOutput {
            provider: "rust".to_string(),
            store_text: "store:client to resources".to_string(),
            kv_message: String::new(),
        }
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn resources_service_kv_create_put_get_delete() {
    assert_case_registered(
        "resources.service-kv-create-put-get-delete",
        "resources",
        "resources",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = resources_service_contract();

    let client_contract =
        resources_client_contract(&service_contract).expect("build resources client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live resources service instance");

    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<ResourcesServiceContract>::connect(
            runtime.service_connect_options("resources-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust resources service");

    service.register_rpc::<ResourcesExerciseRpc, _, _>(|context, input| async move {
        let handle = context.handle().clone();
        let kv = handle.kv_client("records").await?;

        let key = format!("{}.kv", input.key);
        let record = ResourceRecord {
            message: format!("kv:{}", input.message),
        };
        kv.put(
            &key,
            Bytes::from(serde_json::to_vec(&record).map_err(ServerError::Json)?),
        )
        .await?;
        let read_bytes = kv
            .get(&key)
            .await?
            .ok_or_else(|| ServerError::Nats(format!("kv missing {key}")))?;
        let read_record: ResourceRecord =
            serde_json::from_slice(&read_bytes).map_err(ServerError::Json)?;

        kv.delete(&key).await?;

        Ok(ResourceExerciseOutput {
            provider: "rust".to_string(),
            store_text: String::new(),
            kv_message: read_record.message,
        })
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust resources client");

    let output =
        call_resources_exercise_with_retry(&client, "client.resource", "client to resources").await;

    assert_eq!(
        output,
        ResourceExerciseOutput {
            provider: "rust".to_string(),
            store_text: String::new(),
            kv_message: "kv:client to resources".to_string(),
        }
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn resources_service_kv_stale_revision_rejected() {
    assert_case_registered(
        "resources.service-kv-stale-revision-rejected",
        "resources",
        "resources",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = resources_service_contract();

    let client_contract =
        resources_client_contract(&service_contract).expect("build resources client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live resources service instance");

    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<ResourcesServiceContract>::connect(
            runtime.service_connect_options("resources-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust resources service");

    service.register_rpc::<ResourcesExerciseRpc, _, _>(|context, input| async move {
        let handle = context.handle().clone();
        let kv = handle.kv_client("records").await?;

        let key = format!("{}.kv", input.key);

        let record = ResourceRecord {
            message: "initial".to_string(),
        };
        kv.put(
            &key,
            Bytes::from(serde_json::to_vec(&record).map_err(ServerError::Json)?),
        )
        .await?;

        let entry = kv
            .get_entry(&key)
            .await?
            .ok_or_else(|| ServerError::Nats(format!("kv missing {key}")))?;
        let original_revision = entry.revision;

        let updated = ResourceRecord {
            message: "updated".to_string(),
        };
        kv.put(
            &key,
            Bytes::from(serde_json::to_vec(&updated).map_err(ServerError::Json)?),
        )
        .await?;

        let stale_record = ResourceRecord {
            message: "stale".to_string(),
        };
        let stale_bytes =
            Bytes::from(serde_json::to_vec(&stale_record).map_err(ServerError::Json)?);
        match kv
            .update_revision(&key, stale_bytes, original_revision)
            .await
        {
            Err(ServerError::KvRevisionMismatch { .. }) => {}
            result => {
                return Err(ServerError::Nats(format!(
                    "expected KvRevisionMismatch on stale update, got {result:?}"
                )));
            }
        }

        match kv.delete_revision(&key, original_revision).await {
            Err(ServerError::KvRevisionMismatch { .. }) => {}
            result => {
                return Err(ServerError::Nats(format!(
                    "expected KvRevisionMismatch on stale delete, got {result:?}"
                )));
            }
        }

        kv.delete(&key).await?;

        Ok(ResourceExerciseOutput {
            provider: "rust".to_string(),
            store_text: String::new(),
            kv_message: "stale-test-passed".to_string(),
        })
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust resources client");

    let output =
        call_resources_exercise_with_retry(&client, "client.resource", "client to resources").await;

    assert_eq!(
        output,
        ResourceExerciseOutput {
            provider: "rust".to_string(),
            store_text: String::new(),
            kv_message: "stale-test-passed".to_string(),
        }
    );

    service_task.abort_and_wait().await;
}

async fn call_resources_exercise_with_retry(
    client: &trellis_rs::generated::Caller,
    key: &str,
    message: &str,
) -> ResourceExerciseOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<ResourcesExerciseRpc>(&ResourceExerciseInput {
                key: key.to_string(),
                message: message.to_string(),
            })
            .await
        {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Resources.Exercise RPC: {error}"),
        }
    }
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

fn resources_client_contract(
    service_contract: &trellis_test::TrellisTestContract,
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractBuilder::authoring(
        RESOURCES_CLIENT_ID,
        RESOURCES_CLIENT_ID,
        "1.0.0",
        "Trellis Integration Resources Client",
        "App/client participant for the resources integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "resourcesService",
        trellis_rs::contracts::use_contract(RESOURCES_SERVICE_ID)
            .with_rpc_call(["Resources.Exercise"]),
    );

    trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
        manifest,
        &[service_contract],
    )
}
