use std::time::{Duration, Instant};

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use trellis_rs::service::{
    GeneratedServiceContract, KvResourceClient, ServerError, StoreResourceClient,
};

use crate::support::assertions::assert_case_registered;

const RESOURCES_SERVICE_ID: &str = "trellis.integration.resources-service@v1";
const RESOURCES_CLIENT_ID: &str = "trellis.integration.resources-client@v1";

const RESOURCES_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.resources-service@v1",
  "displayName": "Trellis Integration Resources Service",
  "description": "Exercises service-bound KV and store resource handles.",
  "kind": "service",
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
  "uses": {
    "required": {
      "health": {
        "contract": "trellis.health@v1",
        "events": { "publish": ["Health.Heartbeat"] }
      }
    }
  },
  "resources": {
    "kv": {
      "records": {
        "purpose": "Store integration resource records",
        "schema": { "schema": "ResourceRecord" },
        "required": true,
        "history": 1,
        "ttlMs": 0
      },
      "optionalRecords": {
        "purpose": "Store optional integration resource records",
        "schema": { "schema": "ResourceRecord" },
        "required": false,
        "history": 1,
        "ttlMs": 0
      }
    },
    "store": {
      "blobs": {
        "purpose": "Store integration resource blobs",
        "required": true,
        "ttlMs": 0,
        "maxObjectBytes": 1048576,
        "maxTotalBytes": 4194304
      },
      "optionalBlobs": {
        "purpose": "Store optional integration resource blobs",
        "required": false,
        "ttlMs": 0,
        "maxObjectBytes": 1048576,
        "maxTotalBytes": 4194304
      }
    }
  },
  "rpc": {
    "Resources.Exercise": {
      "version": "v1",
      "subject": "rpc.v1.Resources.Exercise",
      "input": { "schema": "ResourceExerciseInput" },
      "output": { "schema": "ResourceExerciseOutput" },
      "capabilities": { "call": [] },
      "errors": []
    }
  }
}"#;

struct ResourcesServiceContract;

impl GeneratedServiceContract for ResourcesServiceContract {
    const CONTRACT_ID: &'static str = RESOURCES_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "PHtCj_5TUZkzgCVWwjKW3CP4WX44xiczn3KwUK4bqZs";
    const CONTRACT_JSON: &'static str = RESOURCES_SERVICE_CONTRACT_JSON;
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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RESOURCES_SERVICE_CONTRACT_JSON)
            .expect("build resources service test contract");
    assert_eq!(
        service_contract.digest(),
        ResourcesServiceContract::CONTRACT_DIGEST
    );

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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RESOURCES_SERVICE_CONTRACT_JSON)
            .expect("build resources service test contract");
    assert_eq!(
        service_contract.digest(),
        ResourcesServiceContract::CONTRACT_DIGEST
    );

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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RESOURCES_SERVICE_CONTRACT_JSON)
            .expect("build resources service test contract");
    assert_eq!(
        service_contract.digest(),
        ResourcesServiceContract::CONTRACT_DIGEST
    );

    let client_contract =
        resources_client_contract().expect("build resources client test contract");

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
        store
            .write(&store_key, Bytes::from(store_text.clone()))
            .await?;
        let read_bytes = store
            .read(&store_key)
            .await?
            .ok_or_else(|| ServerError::Nats(format!("store missing {store_key}")))?;
        let read_text = String::from_utf8(read_bytes.to_vec())
            .map_err(|_| ServerError::Nats("store text not utf-8".to_string()))?;

        let listed = store.list().await?;
        if !listed.contains(&store_key) {
            return Err(ServerError::Nats(format!(
                "store list did not include {store_key}"
            )));
        }

        store.delete(&store_key).await?;

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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RESOURCES_SERVICE_CONTRACT_JSON)
            .expect("build resources service test contract");
    assert_eq!(
        service_contract.digest(),
        ResourcesServiceContract::CONTRACT_DIGEST
    );

    let client_contract =
        resources_client_contract().expect("build resources client test contract");

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

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(RESOURCES_SERVICE_CONTRACT_JSON)
            .expect("build resources service test contract");
    assert_eq!(
        service_contract.digest(),
        ResourcesServiceContract::CONTRACT_DIGEST
    );

    let client_contract =
        resources_client_contract().expect("build resources client test contract");

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
    client: &trellis_rs::client::TrellisClient,
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

fn is_retryable_service_startup_error(error: &trellis_rs::client::TrellisClientError) -> bool {
    match error {
        trellis_rs::client::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::client::TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn resources_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        RESOURCES_CLIENT_ID,
        "Trellis Integration Resources Client",
        "App/client participant for the resources integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "resourcesService",
        trellis_rs::contracts::use_contract(RESOURCES_SERVICE_ID)
            .with_rpc_call(["Resources.Exercise"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
