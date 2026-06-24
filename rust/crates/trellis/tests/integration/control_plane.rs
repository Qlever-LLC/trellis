use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use bytes::Bytes;
use futures_util::{FutureExt, Stream, StreamExt};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::task::JoinHandle;
use trellis_rs::client::{
    EventDescriptor, OutboxDispatchResult, OutboxStore, RpcDescriptor, ServiceConnectOptions,
    ServiceConnectWithContractOptions, TrellisClient,
};
use trellis_rs::sdk::auth::types::{
    AuthSessionsListRequest, AuthUsersCreateRequest, AuthUsersListRequest,
    AuthUsersPasswordChangeRequest, AuthUsersPasswordResetCreateRequest,
};
use trellis_rs::service::{
    ConnectedServiceRuntime, GeneratedServiceContract, KvResourceClient, StoreResourceClient,
};

use crate::support::assertions::assert_service_case_registered;

const ADMIN_BOOTSTRAP_PROBE_CONTRACT_ID: &str =
    "trellis.integration.control-plane.admin-bootstrap-probe@v1";
const PASSWORD_RESET_CHANGE_CONTRACT_ID: &str =
    "trellis.integration.control-plane.password-reset-change-client@v1";
const HTTP_ROUTE_PROBE_CONTRACT_ID: &str =
    "trellis.integration.control-plane.http-route-security-probe@v1";
const SESSIONS_RESTART_CASE_ID: &str = "control-plane.sessions-survive-control-plane-restart";
const SESSIONS_RESTART_CLIENT_ID: &str =
    "trellis.integration.control-plane.sessions-survive-control-plane-restart.client@v1";
const STATE_RESTART_CASE_ID: &str = "control-plane.state-persists-across-control-plane-restart";
const STATE_RESTART_CLIENT_ID: &str =
    "trellis.integration.control-plane.state-persists-across-control-plane-restart.client@v1";
const STATE_RESTART_DRAFT_PREFIX: &str = "restart/state-persists-across-control-plane-restart";
const STATE_RESTART_DRAFT_KEY: &str = "state-draft";
const RESOURCES_RESTART_CASE_ID: &str = "control-plane.resources-survive-control-plane-restart";
const RESOURCES_RESTART_SERVICE_ID: &str =
    "trellis.integration.control-plane.resources-restart-service@v1";
const RESOURCES_RESTART_SERVICE_NAME: &str = "resources-restart-service";
const RESOURCES_RESTART_KV_KEY: &str = "restart.resources.kv";
const RESOURCES_RESTART_STORE_KEY: &str = "restart/resources/store";
const OUTBOX_RESTART_CASE_ID: &str = "control-plane.outbox-dispatches-after-control-plane-restart";
const OUTBOX_RESTART_SERVICE_ID: &str =
    "trellis.integration.control-plane.outbox-restart-service@v1";
const OUTBOX_RESTART_CLIENT_ID: &str = "trellis.integration.control-plane.outbox-restart-client@v1";
const OUTBOX_RESTART_SERVICE_NAME: &str = "outbox-restart-service";
const OUTBOX_RESTART_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.outbox-restart.Documents.Queue";
const OUTBOX_RESTART_EVENT_SUBJECT: &str =
    "events.v1.integration.control-plane.outbox-restart.Document.Queued";
const CATALOG_RESTART_CASE_ID: &str = "control-plane.catalog-active-contracts-survive-restart";
const CATALOG_RESTART_SERVICE_ID: &str =
    "trellis.integration.control-plane.catalog-active-contracts-survive-restart.service@v1";
const CATALOG_RESTART_CLIENT_ID: &str =
    "trellis.integration.control-plane.catalog-active-contracts-survive-restart.client@v1";
const CATALOG_RESTART_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.catalog-active-contracts-survive-restart.CatalogRestart.Ping";
const CATALOG_RESTART_CAPABILITY: &str =
    "trellis.integration.control-plane.catalog-active-contracts-survive-restart::ping";
const CATALOG_DEPENDENCY_CASE_ID: &str =
    "control-plane.catalog-dependency-issue-resolved-by-provider";
const CATALOG_DEPENDENCY_PROVIDER_ID: &str =
    "trellis.integration.control-plane.catalog-dependency-provider@v1";
const CATALOG_DEPENDENCY_CLIENT_ID: &str =
    "trellis.integration.control-plane.catalog-dependency-client@v1";
const CATALOG_DEPENDENCY_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.catalog-dependency-provider.CatalogDependency.Ping";
const CATALOG_DEPENDENCY_CAPABILITY: &str =
    "trellis.integration.control-plane.catalog-dependency-provider::ping";
const CATALOG_DEPENDENCY_PROVIDER_NAME: &str = "catalog-dependency-provider";
const CATALOG_DEPENDENCY_SHAPE_DEPLOYMENT: &str = "catalog-dependency-shape-only";
const CATALOG_FORCE_REPLACE_CASE_ID: &str =
    "control-plane.catalog-force-replace-resolves-catalog-issue";
const CATALOG_FORCE_REPLACE_SERVICE_ID: &str =
    "trellis.integration.control-plane.catalog-force-replace-service.control-plane-catalog-force-replace-resolves-catalog-issue@v1";
const CATALOG_FORCE_REPLACE_ADMIN_CLIENT_ID: &str =
    "trellis.integration.control-plane.catalog-force-replace-admin-client.control-plane-catalog-force-replace-resolves-catalog-issue@v1";
const CATALOG_FORCE_REPLACE_RPC_SUBJECT: &str =
    "rpc.v1.integration.control-plane.catalog-force-replace.control-plane-catalog-force-replace-resolves-catalog-issue.CatalogForce.Ping";
const CATALOG_FORCE_REPLACE_BASE_DEPLOYMENT: &str =
    "catalog-force-replace-base-deployment-control-plane-catalog-force-replace-resolves-catalog-issue";
const CATALOG_FORCE_REPLACE_REPLACEMENT_DEPLOYMENT: &str =
    "catalog-force-replace-replacement-deployment-control-plane-catalog-force-replace-resolves-catalog-issue";
const CATALOG_FORCE_REPLACE_BASE_SERVICE_NAME: &str =
    "catalog-force-replace-base-control-plane-catalog-force-replace-resolves-catalog-issue";
const CATALOG_FORCE_REPLACE_REPLACEMENT_SERVICE_NAME: &str =
    "catalog-force-replace-replacement-control-plane-catalog-force-replace-resolves-catalog-issue";
const PASSWORD_RESET_CHANGE_CASE_ID: &str =
    "control-plane.password-reset-change-invalidates-old-password";
const PASSWORD_RESET_CHANGE_USERNAME: &str = "password-reset-admin-rust";
const PASSWORD_RESET_CHANGE_OLD_PASSWORD: &str =
    "trellis-integration-control-plane-password-reset-rust-old-password-2026";
const PASSWORD_RESET_CHANGE_NEW_PASSWORD: &str =
    "trellis-integration-control-plane-password-reset-rust-new-password-2026";
const CATALOG_RESTART_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-active-contracts-survive-restart.service@v1",
  "displayName": "Trellis Control-Plane Catalog Restart Service",
  "description": "Verifies active service contract state remains usable after control-plane restart.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.control-plane.catalog-active-contracts-survive-restart::ping": {
      "displayName": "Call catalog restart ping",
      "description": "Call the restart persistence probe RPC."
    }
  },
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["message", "generation"],
      "properties": {
        "message": { "type": "string" },
        "generation": { "type": "number" }
      }
    }
  },
  "rpc": {
    "CatalogRestart.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-active-contracts-survive-restart.CatalogRestart.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "capabilities": {
        "call": ["trellis.integration.control-plane.catalog-active-contracts-survive-restart::ping"]
      },
      "errors": []
    }
  }
}"#;
const CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-dependency-provider@v1",
  "displayName": "Trellis Control-Plane Catalog Dependency Provider",
  "description": "Provides an RPC used to prove catalog dependency availability changes when a provider appears.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.control-plane.catalog-dependency-provider::ping": {
      "displayName": "Call catalog dependency ping",
      "description": "Call the dependency-resolution probe RPC."
    }
  },
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["message", "servedBy"],
      "properties": {
        "message": { "type": "string" },
        "servedBy": { "type": "string" }
      }
    }
  },
  "rpc": {
    "CatalogDependency.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-dependency-provider.CatalogDependency.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "capabilities": {
        "call": ["trellis.integration.control-plane.catalog-dependency-provider::ping"]
      },
      "errors": []
    }
  }
}"#;
const CATALOG_FORCE_REPLACE_BASE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-force-replace-service.control-plane-catalog-force-replace-resolves-catalog-issue@v1",
  "displayName": "Trellis Control-Plane Catalog Force Replace Service",
  "description": "Provides the base contract digest for catalog force-replace integration coverage.",
  "kind": "service",
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["message", "variant"],
      "properties": {
        "message": { "type": "string" },
        "variant": { "const": "base" }
      }
    }
  },
  "rpc": {
    "CatalogForce.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-force-replace.control-plane-catalog-force-replace-resolves-catalog-issue.CatalogForce.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "errors": []
    }
  }
}"#;
const CATALOG_FORCE_REPLACE_REPLACEMENT_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.catalog-force-replace-service.control-plane-catalog-force-replace-resolves-catalog-issue@v1",
  "displayName": "Trellis Control-Plane Catalog Force Replace Service",
  "description": "Provides an incompatible replacement digest for catalog force-replace integration coverage.",
  "kind": "service",
  "schemas": {
    "PingInput": {
      "type": "object",
      "required": ["count"],
      "properties": { "count": { "type": "number" } }
    },
    "PingOutput": {
      "type": "object",
      "required": ["count", "variant"],
      "properties": {
        "count": { "type": "number" },
        "variant": { "const": "replacement" }
      }
    }
  },
  "rpc": {
    "CatalogForce.Ping": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.catalog-force-replace.control-plane-catalog-force-replace-resolves-catalog-issue.CatalogForce.Ping",
      "input": { "schema": "PingInput" },
      "output": { "schema": "PingOutput" },
      "errors": []
    }
  }
}"#;
const RESOURCES_RESTART_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.resources-restart-service@v1",
  "displayName": "Trellis Control-Plane Resources Restart Service",
  "description": "Verifies service-owned resource bindings and backing data remain usable after control-plane restart.",
  "kind": "service",
  "schemas": {
    "ResourceRecord": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    }
  },
  "resources": {
    "kv": {
      "records": {
        "purpose": "Store restart-persistence KV records",
        "schema": { "schema": "ResourceRecord" },
        "required": true,
        "history": 1,
        "ttlMs": 0
      }
    },
    "store": {
      "blobs": {
        "purpose": "Store restart-persistence blobs",
        "required": true,
        "ttlMs": 0,
        "maxObjectBytes": 1048576,
        "maxTotalBytes": 4194304
      }
    }
  }
}"#;
const OUTBOX_RESTART_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.control-plane.outbox-restart-service@v1",
  "displayName": "Trellis Control-Plane Outbox Restart Service",
  "description": "Queues SQL outbox events and verifies dispatch after control-plane restart.",
  "kind": "service",
  "capabilities": {
    "readEvents": {
      "displayName": "Read outbox restart events",
      "description": "Subscribe to outbox restart fixture events."
    }
  },
  "schemas": {
    "QueueInput": {
      "type": "object",
      "required": ["documentId"],
      "properties": { "documentId": { "type": "string" } }
    },
    "QueueOutput": {
      "type": "object",
      "required": ["documentId"],
      "properties": { "documentId": { "type": "string" } }
    },
    "DocumentQueued": {
      "type": "object",
      "required": ["documentId"],
      "properties": { "documentId": { "type": "string" } }
    }
  },
  "rpc": {
    "Documents.Queue": {
      "version": "v1",
      "subject": "rpc.v1.integration.control-plane.outbox-restart.Documents.Queue",
      "input": { "schema": "QueueInput" },
      "output": { "schema": "QueueOutput" },
      "capabilities": { "call": [] },
      "errors": []
    }
  },
  "events": {
    "Document.Queued": {
      "version": "v1",
      "subject": "events.v1.integration.control-plane.outbox-restart.Document.Queued",
      "event": { "schema": "DocumentQueued" },
      "capabilities": { "publish": [], "subscribe": ["readEvents"] }
    }
  }
}"#;

struct CatalogRestartServiceContract;

impl GeneratedServiceContract for CatalogRestartServiceContract {
    const CONTRACT_ID: &'static str = CATALOG_RESTART_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_RESTART_SERVICE_CONTRACT_JSON;
}

type CatalogRestartServiceRuntime = ConnectedServiceRuntime<CatalogRestartServiceContract>;

struct CatalogDependencyProviderContract;

impl GeneratedServiceContract for CatalogDependencyProviderContract {
    const CONTRACT_ID: &'static str = CATALOG_DEPENDENCY_PROVIDER_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON;
}

type CatalogDependencyProviderRuntime = ConnectedServiceRuntime<CatalogDependencyProviderContract>;

struct CatalogForceReplaceBaseContract;

impl GeneratedServiceContract for CatalogForceReplaceBaseContract {
    const CONTRACT_ID: &'static str = CATALOG_FORCE_REPLACE_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_FORCE_REPLACE_BASE_CONTRACT_JSON;
}

type CatalogForceReplaceBaseRuntime = ConnectedServiceRuntime<CatalogForceReplaceBaseContract>;

struct CatalogForceReplaceReplacementContract;

impl GeneratedServiceContract for CatalogForceReplaceReplacementContract {
    const CONTRACT_ID: &'static str = CATALOG_FORCE_REPLACE_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = CATALOG_FORCE_REPLACE_REPLACEMENT_CONTRACT_JSON;
}

type CatalogForceReplaceReplacementRuntime =
    ConnectedServiceRuntime<CatalogForceReplaceReplacementContract>;

struct ResourcesRestartServiceContract;

impl GeneratedServiceContract for ResourcesRestartServiceContract {
    const CONTRACT_ID: &'static str = RESOURCES_RESTART_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = RESOURCES_RESTART_SERVICE_CONTRACT_JSON;
}

type ResourcesRestartServiceRuntime = ConnectedServiceRuntime<ResourcesRestartServiceContract>;

struct OutboxRestartServiceContract;

impl GeneratedServiceContract for OutboxRestartServiceContract {
    const CONTRACT_ID: &'static str = OUTBOX_RESTART_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "";
    const CONTRACT_JSON: &'static str = OUTBOX_RESTART_SERVICE_CONTRACT_JSON;
}

type OutboxRestartServiceRuntime = ConnectedServiceRuntime<OutboxRestartServiceContract>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogRestartPingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogRestartPingOutput {
    message: String,
    generation: u32,
}

struct CatalogRestartPingRpc;

impl RpcDescriptor for CatalogRestartPingRpc {
    type Input = CatalogRestartPingInput;
    type Output = CatalogRestartPingOutput;

    const KEY: &'static str = "CatalogRestart.Ping";
    const SUBJECT: &'static str = CATALOG_RESTART_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[CATALOG_RESTART_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","generation"],"properties":{"message":{"type":"string"},"generation":{"type":"number"}}}"#;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogDependencyPingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CatalogDependencyPingOutput {
    message: String,
    served_by: String,
}

struct CatalogDependencyPingRpc;

impl RpcDescriptor for CatalogDependencyPingRpc {
    type Input = CatalogDependencyPingInput;
    type Output = CatalogDependencyPingOutput;

    const KEY: &'static str = "CatalogDependency.Ping";
    const SUBJECT: &'static str = CATALOG_DEPENDENCY_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[CATALOG_DEPENDENCY_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","servedBy"],"properties":{"message":{"type":"string"},"servedBy":{"type":"string"}}}"#;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogForceReplaceBasePingInput {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct CatalogForceReplaceBasePingOutput {
    message: String,
    variant: String,
}

struct CatalogForceReplaceBasePingRpc;

impl RpcDescriptor for CatalogForceReplaceBasePingRpc {
    type Input = CatalogForceReplaceBasePingInput;
    type Output = CatalogForceReplaceBasePingOutput;

    const KEY: &'static str = "CatalogForce.Ping";
    const SUBJECT: &'static str = CATALOG_FORCE_REPLACE_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["message"],"properties":{"message":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["message","variant"],"properties":{"message":{"type":"string"},"variant":{"const":"base"}}}"#;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct CatalogForceReplaceReplacementPingInput {
    count: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct CatalogForceReplaceReplacementPingOutput {
    count: f64,
    variant: String,
}

struct CatalogForceReplaceReplacementPingRpc;

impl RpcDescriptor for CatalogForceReplaceReplacementPingRpc {
    type Input = CatalogForceReplaceReplacementPingInput;
    type Output = CatalogForceReplaceReplacementPingOutput;

    const KEY: &'static str = "CatalogForce.Ping";
    const SUBJECT: &'static str = CATALOG_FORCE_REPLACE_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["count"],"properties":{"count":{"type":"number"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["count","variant"],"properties":{"count":{"type":"number"},"variant":{"const":"replacement"}}}"#;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StateRestartPreferences {
    theme: String,
    density: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StateRestartDraft {
    title: String,
    body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourceRestartRecord {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OutboxRestartQueueInput {
    document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OutboxRestartQueueOutput {
    document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OutboxRestartDocumentQueued {
    document_id: String,
}

struct OutboxRestartQueueRpc;

impl RpcDescriptor for OutboxRestartQueueRpc {
    type Input = OutboxRestartQueueInput;
    type Output = OutboxRestartQueueOutput;

    const KEY: &'static str = "Documents.Queue";
    const SUBJECT: &'static str = OUTBOX_RESTART_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["documentId"],"properties":{"documentId":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = Self::INPUT_SCHEMA_JSON;
}

struct OutboxRestartQueuedEvent;

impl EventDescriptor for OutboxRestartQueuedEvent {
    type Event = OutboxRestartDocumentQueued;

    const KEY: &'static str = "Document.Queued";
    const SUBJECT: &'static str = OUTBOX_RESTART_EVENT_SUBJECT;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readEvents"];
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
async fn control_plane_admin_bootstrap_creates_first_local_admin() {
    assert_service_case_registered(
        "control-plane.admin-bootstrap-creates-first-local-admin",
        "control-plane",
        "control_plane",
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
    let contract = admin_bootstrap_probe_contract().expect("build admin bootstrap probe contract");

    let client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust admin bootstrap probe client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as bootstrap-created admin app");

    assert_admin_app_session(&me);
}

#[tokio::test]
async fn control_plane_password_reset_change_invalidates_old_password() {
    assert_service_case_registered(
        PASSWORD_RESET_CHANGE_CASE_ID,
        "control-plane",
        "control_plane",
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
    let contract =
        password_reset_change_contract().expect("build password reset change client contract");

    let initial_client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust password reset admin client");
    let initial_auth = trellis_rs::sdk::auth::AuthClient::new(&initial_client);
    let created = initial_auth
        .rpc()
        .auth()
        .users_create(&AuthUsersCreateRequest {
            active: Some(true),
            capabilities: None,
            capability_groups: Some(vec!["admin".to_string()]),
            email: Some(format!("{PASSWORD_RESET_CHANGE_USERNAME}@example.test")),
            name: Some("Password Reset Change Admin".to_string()),
            username: Some(PASSWORD_RESET_CHANGE_USERNAME.to_string()),
        })
        .await
        .expect("create local admin user through generated Auth.Users.Create");
    let reset = initial_auth
        .rpc()
        .auth()
        .users_password_reset_create(&AuthUsersPasswordResetCreateRequest {
            expires_in_seconds: None,
            user_id: created.user.user_id.clone(),
        })
        .await
        .expect("create password reset flow through generated Auth.Users.PasswordReset.Create");
    complete_local_password_account_flow(
        runtime.trellis_url(),
        &reset.flow_id,
        PASSWORD_RESET_CHANGE_USERNAME,
        PASSWORD_RESET_CHANGE_OLD_PASSWORD,
    )
    .await
    .expect("complete local-password account flow through public HTTP route");

    let old_password_seed = trellis_rs::auth::generate_session_keypair().0;
    let old_password_client = connect_with_local_password(
        runtime.trellis_url(),
        &contract,
        &old_password_seed,
        PASSWORD_RESET_CHANGE_USERNAME,
        PASSWORD_RESET_CHANGE_OLD_PASSWORD,
    )
    .await
    .expect("connect with reset old password through public local login flow");
    let old_password_auth = trellis_rs::sdk::auth::AuthClient::new(&old_password_client);
    let changed = old_password_auth
        .rpc()
        .auth()
        .users_password_change(&AuthUsersPasswordChangeRequest {
            current_password: PASSWORD_RESET_CHANGE_OLD_PASSWORD.to_string(),
            new_password: PASSWORD_RESET_CHANGE_NEW_PASSWORD.to_string(),
        })
        .await
        .expect("change password through generated Auth.Users.Password.Change");
    assert!(changed.success, "password change should succeed");

    let rejected_seed = trellis_rs::auth::generate_session_keypair().0;
    let rejected = local_password_login_failure(
        runtime.trellis_url(),
        &contract,
        &rejected_seed,
        PASSWORD_RESET_CHANGE_USERNAME,
        PASSWORD_RESET_CHANGE_OLD_PASSWORD,
    )
    .await
    .expect("attempt old-password local login through public HTTP route");
    assert_eq!(rejected.status, 403, "old password body: {}", rejected.body);
    assert!(
        rejected.body.contains("invalid_credentials"),
        "expected invalid_credentials response, got: {}",
        rejected.body
    );

    let new_password_seed = trellis_rs::auth::generate_session_keypair().0;
    let new_password_client = connect_with_local_password(
        runtime.trellis_url(),
        &contract,
        &new_password_seed,
        PASSWORD_RESET_CHANGE_USERNAME,
        PASSWORD_RESET_CHANGE_NEW_PASSWORD,
    )
    .await
    .expect("connect with changed new password through public local login flow");
    let new_password_auth = trellis_rs::sdk::auth::AuthClient::new(&new_password_client);
    let me = new_password_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me after new-password login");
    assert_eq!(
        me.user
            .as_object()
            .and_then(|user| user.get("userId"))
            .and_then(Value::as_str),
        Some(created.user.user_id.as_str())
    );
}

#[tokio::test]
async fn control_plane_http_route_security_requires_admin_session() {
    assert_service_case_registered(
        "control-plane.http-route-security-requires-admin-session",
        "control-plane",
        "control_plane",
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

    let unauthenticated_seed = trellis_rs::auth::generate_session_keypair().0;
    let unauthenticated = fetch_client_bootstrap(runtime.trellis_url(), &unauthenticated_seed)
        .await
        .expect("fetch unauthenticated client bootstrap");
    assert_eq!(unauthenticated.status, 200);
    assert_eq!(
        unauthenticated.body.get("status").and_then(Value::as_str),
        Some("auth_required")
    );

    let admin_session_seed = trellis_rs::auth::generate_session_keypair().0;
    let contract = http_route_probe_contract().expect("build HTTP route probe contract");
    let client = admin
        .connect_client_with_session_seed(&bootstrap_url, &contract, admin_session_seed.clone())
        .await
        .expect("connect live Rust HTTP route probe client");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as HTTP route probe admin app");
    assert_admin_app_session(&me);

    let users = auth
        .rpc()
        .auth()
        .users_list(&AuthUsersListRequest {
            limit: 20,
            offset: None,
        })
        .await
        .expect("call Auth.Users.List as HTTP route probe admin app");
    assert!(
        users.count >= 1,
        "expected at least one bootstrap admin user"
    );

    let authenticated = fetch_client_bootstrap(runtime.trellis_url(), &admin_session_seed)
        .await
        .expect("fetch authenticated client bootstrap");
    assert_eq!(authenticated.status, 200);
    assert_eq!(
        authenticated.body.get("status").and_then(Value::as_str),
        Some("ready")
    );
    assert_eq!(
        authenticated
            .body
            .get("connectInfo")
            .and_then(Value::as_object)
            .and_then(|connect_info| connect_info.get("sessionKey"))
            .and_then(Value::as_str),
        Some(authenticated.session_key.as_str())
    );
    let capabilities = authenticated
        .body
        .get("binding")
        .and_then(Value::as_object)
        .and_then(|binding| binding.get("capabilities"))
        .and_then(Value::as_array)
        .expect("authenticated bootstrap binding should include capabilities");
    assert!(
        capabilities.iter().any(|capability| capability == "admin"),
        "authenticated bootstrap binding should include admin capability"
    );
}

#[tokio::test]
async fn control_plane_catalog_active_contracts_survive_restart() {
    assert_service_case_registered(CATALOG_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_RESTART_SERVICE_CONTRACT_JSON,
    )
    .expect("build catalog restart service contract");
    let client_contract =
        catalog_restart_client_contract().expect("build catalog restart client contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live catalog restart service instance");
    let client_session_seed = trellis_rs::auth::generate_session_keypair().0;

    let service_task = start_catalog_restart_service(
        runtime.trellis_url(),
        &service_contract,
        &service_key,
        1,
        true,
    )
    .await;
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &client_contract,
            client_session_seed,
        )
        .await
        .expect("connect live Rust catalog restart client before restart");
    let before = call_catalog_restart_with_retry(&client, "before").await;
    assert_eq!(
        before,
        CatalogRestartPingOutput {
            message: "before".to_string(),
            generation: 1,
        }
    );
    drop(client);
    service_task.abort_and_wait().await;

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let service_task = start_catalog_restart_service(
        runtime.trellis_url(),
        &service_contract,
        &service_key,
        2,
        false,
    )
    .await;
    let client = client_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect bound catalog restart client after restart without fresh auth flow");
    let after = call_catalog_restart_with_retry(&client, "after").await;

    service_task.abort_and_wait().await;
    assert_eq!(
        after,
        CatalogRestartPingOutput {
            message: "after".to_string(),
            generation: 2,
        }
    );
}

#[tokio::test]
async fn control_plane_catalog_dependency_issue_resolved_by_provider() {
    assert_service_case_registered(CATALOG_DEPENDENCY_CASE_ID, "control-plane", "control_plane");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let provider_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON,
    )
    .expect("build catalog dependency provider contract");
    let client_contract =
        catalog_dependency_client_contract().expect("build catalog dependency client contract");
    admin
        .approve_contract(
            &bootstrap_url,
            &provider_contract,
            Some(CATALOG_DEPENDENCY_SHAPE_DEPLOYMENT),
            &[],
        )
        .await
        .expect("approve provider shape in separate deployment");

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust catalog dependency client before provider is active");
    assert_catalog_dependency_unavailable(&client).await;

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &provider_contract, None, None)
        .await
        .expect("provision live catalog dependency provider service instance");
    let service_task = start_catalog_dependency_provider_service(
        runtime.trellis_url(),
        &provider_contract,
        &service_key,
    )
    .await;
    let output = call_catalog_dependency_with_retry(&client, "after-provider").await;

    service_task.abort_and_wait().await;
    assert_eq!(
        output,
        CatalogDependencyPingOutput {
            message: "after-provider".to_string(),
            served_by: CATALOG_DEPENDENCY_PROVIDER_NAME.to_string(),
        }
    );
}

#[tokio::test]
async fn control_plane_catalog_force_replace_resolves_catalog_issue() {
    assert_service_case_registered(
        CATALOG_FORCE_REPLACE_CASE_ID,
        "control-plane",
        "control_plane",
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

    admin
        .create_deployment(
            &bootstrap_url,
            Some(CATALOG_FORCE_REPLACE_BASE_DEPLOYMENT),
            Some(false),
        )
        .await
        .expect("create strict base deployment");
    admin
        .create_deployment(
            &bootstrap_url,
            Some(CATALOG_FORCE_REPLACE_REPLACEMENT_DEPLOYMENT),
            Some(false),
        )
        .await
        .expect("create strict replacement deployment");

    let base_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_FORCE_REPLACE_BASE_CONTRACT_JSON,
    )
    .expect("build catalog force-replace base contract");
    let replacement_contract = trellis_test::TrellisTestContract::from_manifest_json(
        CATALOG_FORCE_REPLACE_REPLACEMENT_CONTRACT_JSON,
    )
    .expect("build catalog force-replace replacement contract");
    let admin_contract = catalog_force_replace_admin_contract()
        .expect("build catalog force-replace admin client contract");
    let base_key = admin
        .provision_service_instance(
            &bootstrap_url,
            &base_contract,
            Some(CATALOG_FORCE_REPLACE_BASE_DEPLOYMENT),
            None,
        )
        .await
        .expect("provision live catalog force-replace base service instance");
    let base_service_task = start_catalog_force_replace_base_service(
        runtime.trellis_url(),
        base_contract.digest(),
        &base_key,
    )
    .await;
    let admin_client = admin
        .connect_client(&bootstrap_url, &admin_contract)
        .await
        .expect("connect live Rust catalog force-replace admin client");

    let replacement_key = admin
        .provision_service_instance(
            &bootstrap_url,
            &replacement_contract,
            Some(CATALOG_FORCE_REPLACE_REPLACEMENT_DEPLOYMENT),
            None,
        )
        .await
        .expect("provision live catalog force-replace replacement service instance");
    let replacement_service_task = start_catalog_force_replace_replacement_service(
        runtime.trellis_url(),
        replacement_contract.digest(),
        &replacement_key,
    )
    .await;
    let core = trellis_rs::sdk::core::CoreClient::new(&admin_client);
    let issue = wait_for_catalog_force_replace_issue(
        &core,
        base_contract.digest(),
        replacement_contract.digest(),
    )
    .await;
    assert_eq!(issue.digest.as_deref(), Some(replacement_contract.digest()));
    assert_eq!(
        issue.effective_digests.as_deref(),
        Some(&[base_contract.digest().to_string()][..])
    );
    assert!(
        issue
            .actions
            .iter()
            .any(|action| action.action == "force-replace"),
        "expected catalog issue to expose the public force-replace action"
    );

    let auth = trellis_rs::sdk::auth::AuthClient::new(&admin_client);
    let resolved = auth
        .rpc()
        .auth()
        .catalog_issues_resolve(
            &trellis_rs::sdk::auth::types::AuthCatalogIssuesResolveRequest {
                issue_id: issue.issue_id.clone(),
                action: "force-replace".to_string(),
            },
        )
        .await
        .expect("resolve catalog force-replace issue through generated Auth RPC");
    assert!(resolved.success);
    assert_eq!(resolved.issue_id, issue.issue_id);
    assert_eq!(resolved.action, "force-replace");

    wait_for_catalog_force_replace_resolved(&core, replacement_contract.digest()).await;

    replacement_service_task.abort_and_wait().await;
    base_service_task.abort_and_wait().await;
}

#[tokio::test]
async fn control_plane_sessions_survive_control_plane_restart() {
    assert_service_case_registered(SESSIONS_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract =
        sessions_restart_client_contract().expect("build sessions restart client contract");
    let client_session_seed = trellis_rs::auth::generate_session_keypair().0;
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &contract,
            client_session_seed,
        )
        .await
        .expect("connect live Rust sessions restart client before restart");
    let session_key = client.auth().session_key.clone();
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let before_me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me before control-plane restart");
    assert_app_user_session(&before_me);
    let before_user_id = session_user_id(&before_me).expect("session user should have a userId");

    assert_session_listed(
        &auth
            .rpc()
            .auth()
            .sessions_list(&auth_sessions_list_request())
            .await
            .expect("list sessions before control-plane restart"),
        &session_key,
    );
    drop(client);

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let client = client_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect bound sessions restart client after restart without fresh auth flow");
    let auth = trellis_rs::sdk::auth::AuthClient::new(&client);
    let after_me = auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me after control-plane restart");

    assert_app_user_session(&after_me);
    assert_eq!(
        session_user_id(&after_me).as_deref(),
        Some(before_user_id.as_str())
    );
    assert_session_listed(
        &auth
            .rpc()
            .auth()
            .sessions_list(&auth_sessions_list_request())
            .await
            .expect("list sessions after control-plane restart"),
        &session_key,
    );
}

#[tokio::test]
async fn control_plane_state_persists_across_control_plane_restart() {
    assert_service_case_registered(STATE_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract = state_restart_client_contract().expect("build state restart client contract");
    let client_session_seed = trellis_rs::auth::generate_session_keypair().0;
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &contract,
            client_session_seed,
        )
        .await
        .expect("connect live Rust state restart client before restart");

    let preferences = trellis_rs::client::ValueStateStore::<_, StateRestartPreferences>::new(
        &client,
        "preferences",
    );
    let drafts = trellis_rs::client::MapStateStore::<_, StateRestartDraft>::new(&client, "drafts")
        .prefix(STATE_RESTART_DRAFT_PREFIX);

    let written_preferences = preferences
        .put_with_options(
            &StateRestartPreferences {
                theme: "dark".to_string(),
                density: "comfortable".to_string(),
            },
            &trellis_rs::client::PutStateOptions {
                expected_revision: trellis_rs::client::ExpectedPutRevision::CreateIfAbsent,
                ..Default::default()
            },
        )
        .await
        .expect("write preferences before control-plane restart");
    assert!(written_preferences.applied);
    let written_preferences_entry = current_state_entry(
        written_preferences.entry,
        "expected preferences write to return a current entry",
    );
    assert_eq!(written_preferences_entry.value.theme, "dark");
    assert!(!written_preferences_entry.updated_at.is_empty());

    let written_draft = drafts
        .put_with_options(
            STATE_RESTART_DRAFT_KEY,
            &StateRestartDraft {
                title: "Restart Draft".to_string(),
                body: "from before restart".to_string(),
            },
            &trellis_rs::client::PutStateOptions {
                expected_revision: trellis_rs::client::ExpectedPutRevision::CreateIfAbsent,
                ..Default::default()
            },
        )
        .await
        .expect("write draft before control-plane restart");
    assert!(written_draft.applied);
    let written_draft_entry = current_map_state_entry(
        written_draft.entry,
        "expected draft write to return a current entry",
    );
    assert_eq!(
        written_draft_entry.key,
        format!("{STATE_RESTART_DRAFT_PREFIX}/{STATE_RESTART_DRAFT_KEY}")
    );
    assert!(!written_draft_entry.updated_at.is_empty());
    drop(client);

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let client = client_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect bound state restart client after restart without fresh auth flow");
    let preferences = trellis_rs::client::ValueStateStore::<_, StateRestartPreferences>::new(
        &client,
        "preferences",
    );
    let drafts = trellis_rs::client::MapStateStore::<_, StateRestartDraft>::new(&client, "drafts")
        .prefix(STATE_RESTART_DRAFT_PREFIX);

    let found_preferences = match preferences
        .get()
        .await
        .expect("read preferences after control-plane restart")
    {
        trellis_rs::client::StateGetResult::Found { entry, .. } => entry,
        other => panic!("expected current preferences after restart, got {other:?}"),
    };
    assert_eq!(
        found_preferences.value,
        StateRestartPreferences {
            theme: "dark".to_string(),
            density: "comfortable".to_string(),
        }
    );
    assert_eq!(
        found_preferences.revision,
        written_preferences_entry.revision
    );
    assert_eq!(
        found_preferences.updated_at,
        written_preferences_entry.updated_at
    );

    let found_draft = match drafts
        .get(STATE_RESTART_DRAFT_KEY)
        .await
        .expect("read draft after control-plane restart")
    {
        trellis_rs::client::StateGetResult::Found { entry, .. } => entry,
        other => panic!("expected current draft after restart, got {other:?}"),
    };
    assert_eq!(
        found_draft.key,
        format!("{STATE_RESTART_DRAFT_PREFIX}/{STATE_RESTART_DRAFT_KEY}")
    );
    assert_eq!(
        found_draft.value,
        StateRestartDraft {
            title: "Restart Draft".to_string(),
            body: "from before restart".to_string(),
        }
    );
    assert_eq!(found_draft.revision, written_draft_entry.revision);
    assert_eq!(found_draft.updated_at, written_draft_entry.updated_at);
}

#[tokio::test]
async fn control_plane_resources_survive_control_plane_restart() {
    assert_service_case_registered(RESOURCES_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract = trellis_test::TrellisTestContract::from_manifest_json(
        RESOURCES_RESTART_SERVICE_CONTRACT_JSON,
    )
    .expect("build resources restart service contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live resources restart service instance");

    let service = connect_resources_restart_service(
        runtime.trellis_url(),
        service_contract.digest(),
        &service_key,
    )
    .await;
    assert_resources_restart_bindings(&service);

    let kv = service
        .kv_client("records")
        .await
        .expect("open fresh records KV client before restart");
    let store = service
        .store_client("blobs")
        .await
        .expect("open fresh blobs store client before restart");
    kv.put(
        RESOURCES_RESTART_KV_KEY,
        Bytes::from(
            serde_json::to_vec(&ResourceRestartRecord {
                message: "before restart".to_string(),
            })
            .expect("serialize resource restart KV record"),
        ),
    )
    .await
    .expect("write records KV value before control-plane restart");
    store
        .write(
            RESOURCES_RESTART_STORE_KEY,
            Bytes::from_static(b"blob before restart"),
        )
        .await
        .expect("write blobs store bytes before control-plane restart");
    drop(store);
    drop(kv);
    drop(service);

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let service = connect_resources_restart_service(
        runtime.trellis_url(),
        service_contract.digest(),
        &service_key,
    )
    .await;
    assert_resources_restart_bindings(&service);

    let kv = service
        .kv_client("records")
        .await
        .expect("open fresh records KV client after restart");
    let stored_record: ResourceRestartRecord = serde_json::from_slice(
        &kv.get(RESOURCES_RESTART_KV_KEY)
            .await
            .expect("read records KV value after control-plane restart")
            .expect("records KV value should survive control-plane restart"),
    )
    .expect("decode records KV value after control-plane restart");
    assert_eq!(
        stored_record,
        ResourceRestartRecord {
            message: "before restart".to_string(),
        }
    );

    let store = service
        .store_client("blobs")
        .await
        .expect("open fresh blobs store client after restart");
    let stored_bytes = store
        .read(RESOURCES_RESTART_STORE_KEY)
        .await
        .expect("read blobs store bytes after control-plane restart")
        .expect("blobs store bytes should survive control-plane restart");
    assert_eq!(stored_bytes.as_ref(), b"blob before restart");
}

#[tokio::test]
async fn control_plane_outbox_dispatches_after_control_plane_restart() {
    assert_service_case_registered(OUTBOX_RESTART_CASE_ID, "control-plane", "control_plane");

    let mut runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(OUTBOX_RESTART_SERVICE_CONTRACT_JSON)
            .expect("build outbox restart service contract");
    let client_contract =
        outbox_restart_client_contract().expect("build outbox restart client contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live outbox restart service instance");
    let db = Arc::new(std::sync::Mutex::new(create_outbox_restart_db()));

    let service_task = start_outbox_restart_service(
        runtime.trellis_url(),
        service_contract.digest(),
        &service_key,
        Arc::clone(&db),
    )
    .await;
    let client_session_seed = trellis_rs::auth::generate_session_keypair().0;
    let (client, client_reconnect) = admin
        .connect_client_with_session_seed_reconnectable(
            &bootstrap_url,
            &client_contract,
            client_session_seed,
        )
        .await
        .expect("connect live Rust outbox restart client before restart");
    let document_id = "rust-outbox-restart-document".to_string();
    let queued = call_outbox_restart_queue_with_retry(&client, &document_id).await;
    assert_eq!(queued.document_id, document_id);
    assert_eq!(
        outbox_restart_row_status(&db, &document_id).await,
        "pending"
    );
    drop(client);
    service_task.abort_and_wait().await;

    runtime
        .restart_control_plane()
        .await
        .expect("restart only the Trellis control-plane process");

    let capture_client = client_reconnect
        .connect_bound_only()
        .await
        .expect("reconnect bound outbox restart client after restart without fresh auth flow");
    let mut capture = capture_client
        .subscribe::<OutboxRestartQueuedEvent>()
        .await
        .expect("subscribe to Document.Queued after restart");
    let service_client = connect_outbox_restart_service_client(
        runtime.trellis_url(),
        service_contract.digest(),
        &service_key,
    )
    .await;
    let dispatch_result = dispatch_outbox_restart_once(&db, &service_client)
        .await
        .expect("dispatch queued outbox event after control-plane restart");
    assert_eq!(
        dispatch_result,
        OutboxDispatchResult::Published {
            id: document_id.clone()
        }
    );
    let captured = wait_for_outbox_restart_queued(&mut capture, &document_id).await;
    assert_eq!(captured.document_id, document_id);
    assert_eq!(
        outbox_restart_row_status(&db, &captured.document_id).await,
        "published"
    );
}

fn admin_bootstrap_probe_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        ADMIN_BOOTSTRAP_PROBE_CONTRACT_ID,
        "Trellis Control-Plane Admin Bootstrap Probe",
        "Verifies first-admin bootstrap yields an authenticated admin session.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.Me"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn password_reset_change_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        PASSWORD_RESET_CHANGE_CONTRACT_ID,
        "Trellis Control-Plane Password Reset Change Client",
        "Verifies live local password reset and authenticated password change behavior.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID).with_rpc_call([
            "Auth.Sessions.Me",
            "Auth.Users.Create",
            "Auth.Users.Password.Change",
            "Auth.Users.PasswordReset.Create",
        ]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn http_route_probe_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        HTTP_ROUTE_PROBE_CONTRACT_ID,
        "Trellis Control-Plane HTTP Route Security Probe",
        "Verifies control-plane HTTP bootstrap requires an authenticated admin session.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.Me", "Auth.Users.List"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn catalog_restart_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CATALOG_RESTART_CLIENT_ID,
        "Trellis Control-Plane Catalog Restart Client",
        "Verifies active app contract authority remains usable after restart.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "catalogRestartService",
        trellis_rs::contracts::use_contract(CATALOG_RESTART_SERVICE_ID)
            .with_rpc_call(["CatalogRestart.Ping"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn catalog_dependency_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CATALOG_DEPENDENCY_CLIENT_ID,
        "Trellis Control-Plane Catalog Dependency Client",
        "Requires the catalog dependency provider RPC for dependency-resolution coverage.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "dependencyProvider",
        trellis_rs::contracts::use_contract(CATALOG_DEPENDENCY_PROVIDER_ID)
            .with_rpc_call(["CatalogDependency.Ping"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn catalog_force_replace_admin_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CATALOG_FORCE_REPLACE_ADMIN_CLIENT_ID,
        "Trellis Control-Plane Catalog Force Replace Admin Client",
        "Observes the public catalog and resolves catalog issues through generated admin RPCs.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "core",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::core::CONTRACT_ID)
            .with_rpc_call(["Trellis.Catalog"]),
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.CatalogIssues.Resolve"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn sessions_restart_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        SESSIONS_RESTART_CLIENT_ID,
        "Trellis Control-Plane Sessions Restart Client",
        "Verifies approved app sessions remain authenticated after control-plane restart.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.Me", "Auth.Sessions.List"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn state_restart_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest =
        trellis_rs::contracts::ContractManifestBuilder::new(
            STATE_RESTART_CLIENT_ID,
            "Trellis Control-Plane State Restart Client",
            "Verifies contract-owned state remains readable after control-plane restart.",
            trellis_rs::contracts::ContractKind::App,
        )
        .schema(
            "Preferences",
            json!({
                "type": "object",
                "required": ["theme", "density"],
                "properties": {
                    "theme": { "type": "string" },
                    "density": { "type": "string" }
                }
            }),
        )
        .schema(
            "Draft",
            json!({
                "type": "object",
                "required": ["title", "body"],
                "properties": {
                    "title": { "type": "string" },
                    "body": { "type": "string" }
                }
            }),
        )
        .use_ref(
            "state",
            trellis_rs::contracts::use_contract(trellis_rs::sdk::state::CONTRACT_ID)
                .with_rpc_call(["State.Get", "State.Put", "State.List"]),
        )
        .state(
            "preferences",
            trellis_rs::contracts::state(
                trellis_rs::contracts::ContractStateKind::Value,
                "Preferences",
            )
            .state_version("preferences.v1"),
        )
        .state(
            "drafts",
            trellis_rs::contracts::state(trellis_rs::contracts::ContractStateKind::Map, "Draft")
                .state_version("drafts.v1"),
        )
        .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn outbox_restart_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        OUTBOX_RESTART_CLIENT_ID,
        "Trellis Control-Plane Outbox Restart Client",
        "Queues outbox restart fixture events through generated RPC.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "outboxRestartService",
        trellis_rs::contracts::use_contract(OUTBOX_RESTART_SERVICE_ID)
            .with_rpc_call(["Documents.Queue"])
            .with_event_subscribe(["Document.Queued"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn current_state_entry<TValue>(
    entry: Option<trellis_rs::client::StateValue<trellis_rs::client::StateEntry<TValue>>>,
    message: &str,
) -> trellis_rs::client::StateEntry<TValue> {
    match entry {
        Some(trellis_rs::client::StateValue::Current(entry)) => entry,
        _ => panic!("{message}"),
    }
}

fn current_map_state_entry<TValue>(
    entry: Option<
        trellis_rs::client::StateValue<
            trellis_rs::client::MapStateEntry<TValue>,
            trellis_rs::client::MapStateEntry<Value>,
        >,
    >,
    message: &str,
) -> trellis_rs::client::MapStateEntry<TValue> {
    match entry {
        Some(trellis_rs::client::StateValue::Current(entry)) => entry,
        _ => panic!("{message}"),
    }
}

async fn connect_resources_restart_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> ResourcesRestartServiceRuntime {
    ConnectedServiceRuntime::from_connected_client(
        RESOURCES_RESTART_SERVICE_NAME,
        Arc::new(
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url,
                contract_id: RESOURCES_RESTART_SERVICE_ID,
                contract_digest,
                contract_json: RESOURCES_RESTART_SERVICE_CONTRACT_JSON,
                session_key_seed_base64url: &service_key.seed,
                timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                authority_pending_timeout_ms:
                    trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
            })
            .await
            .expect("connect live Rust resources restart service"),
        ),
    )
    .expect("build resources restart service runtime")
}

async fn connect_outbox_restart_service_client(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> TrellisClient {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url,
        contract_id: OUTBOX_RESTART_SERVICE_ID,
        contract_digest,
        contract_json: OUTBOX_RESTART_SERVICE_CONTRACT_JSON,
        session_key_seed_base64url: &service_key.seed,
        timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
        retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
        authority_pending_timeout_ms: trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
    })
    .await
    .expect("connect live Rust outbox restart service")
}

fn assert_resources_restart_bindings(service: &ResourcesRestartServiceRuntime) {
    let resources = service.resources();
    let records = resources
        .kv
        .get("records")
        .expect("expected kv.records binding");
    assert_eq!(records.history, 1);
    assert_eq!(records.ttl_ms, 0);

    let blobs = resources
        .store
        .get("blobs")
        .expect("expected store.blobs binding");
    assert_eq!(blobs.max_total_bytes, Some(4_194_304));
    assert_eq!(blobs.max_object_bytes, Some(1_048_576));
}

async fn start_catalog_restart_service(
    trellis_url: &str,
    service_contract: &trellis_test::TrellisTestContract,
    service_key: &trellis_test::TrellisTestServiceKey,
    generation: u32,
    present_contract: bool,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = service_contract.digest().to_string();
    let seed = service_key.seed.clone();
    let client = if present_contract {
        TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
            trellis_url: &trellis_url,
            contract_id: CATALOG_RESTART_SERVICE_ID,
            contract_digest: &contract_digest,
            contract_json: CATALOG_RESTART_SERVICE_CONTRACT_JSON,
            session_key_seed_base64url: &seed,
            timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
            retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
            authority_pending_timeout_ms: trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
        })
        .await
    } else {
        TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url: &trellis_url,
            contract_id: CATALOG_RESTART_SERVICE_ID,
            contract_digest: &contract_digest,
            session_key_seed_base64url: &seed,
            timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
        })
        .await
    }
    .expect("connect live Rust catalog restart service");
    let mut service = CatalogRestartServiceRuntime::from_connected_client(
        "catalog-restart-service",
        Arc::new(client),
    )
    .expect("build catalog restart service runtime");

    service.register_rpc::<CatalogRestartPingRpc, _, _>(move |_context, input| async move {
        Ok(CatalogRestartPingOutput {
            message: input.message,
            generation,
        })
    });

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_catalog_dependency_provider_service(
    trellis_url: &str,
    provider_contract: &trellis_test::TrellisTestContract,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = provider_contract.digest().to_string();
    let seed = service_key.seed.clone();
    let mut service: CatalogDependencyProviderRuntime =
        ConnectedServiceRuntime::from_connected_client(
            CATALOG_DEPENDENCY_PROVIDER_NAME,
            Arc::new(
                TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                    trellis_url: &trellis_url,
                    contract_id: CATALOG_DEPENDENCY_PROVIDER_ID,
                    contract_digest: &contract_digest,
                    contract_json: CATALOG_DEPENDENCY_PROVIDER_CONTRACT_JSON,
                    session_key_seed_base64url: &seed,
                    timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                    retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                    authority_pending_timeout_ms:
                        trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
                })
                .await
                .expect("connect live Rust catalog dependency provider service"),
            ),
        )
        .expect("build catalog dependency provider service runtime");

    service.register_rpc::<CatalogDependencyPingRpc, _, _>(move |_context, input| async move {
        Ok(CatalogDependencyPingOutput {
            message: input.message,
            served_by: CATALOG_DEPENDENCY_PROVIDER_NAME.to_string(),
        })
    });

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_catalog_force_replace_base_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = contract_digest.to_string();
    let seed = service_key.seed.clone();
    let mut service: CatalogForceReplaceBaseRuntime =
        ConnectedServiceRuntime::from_connected_client(
            CATALOG_FORCE_REPLACE_BASE_SERVICE_NAME,
            Arc::new(
                TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                    trellis_url: &trellis_url,
                    contract_id: CATALOG_FORCE_REPLACE_SERVICE_ID,
                    contract_digest: &contract_digest,
                    contract_json: CATALOG_FORCE_REPLACE_BASE_CONTRACT_JSON,
                    session_key_seed_base64url: &seed,
                    timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                    retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                    authority_pending_timeout_ms:
                        trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
                })
                .await
                .expect("connect live Rust catalog force-replace base service"),
            ),
        )
        .expect("build catalog force-replace base service runtime");

    service.register_rpc::<CatalogForceReplaceBasePingRpc, _, _>(
        move |_context, input| async move {
            Ok(CatalogForceReplaceBasePingOutput {
                message: input.message,
                variant: "base".to_string(),
            })
        },
    );

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_catalog_force_replace_replacement_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let trellis_url = trellis_url.to_string();
    let contract_digest = contract_digest.to_string();
    let seed = service_key.seed.clone();
    let mut service: CatalogForceReplaceReplacementRuntime =
        ConnectedServiceRuntime::from_connected_client(
            CATALOG_FORCE_REPLACE_REPLACEMENT_SERVICE_NAME,
            Arc::new(
                TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                    trellis_url: &trellis_url,
                    contract_id: CATALOG_FORCE_REPLACE_SERVICE_ID,
                    contract_digest: &contract_digest,
                    contract_json: CATALOG_FORCE_REPLACE_REPLACEMENT_CONTRACT_JSON,
                    session_key_seed_base64url: &seed,
                    timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
                    retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
                    authority_pending_timeout_ms:
                        trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
                })
                .await
                .expect("connect live Rust catalog force-replace replacement service"),
            ),
        )
        .expect("build catalog force-replace replacement service runtime");

    service.register_rpc::<CatalogForceReplaceReplacementPingRpc, _, _>(
        move |_context, input| async move {
            Ok(CatalogForceReplaceReplacementPingOutput {
                count: input.count,
                variant: "replacement".to_string(),
            })
        },
    );

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

async fn start_outbox_restart_service(
    trellis_url: &str,
    contract_digest: &str,
    service_key: &trellis_test::TrellisTestServiceKey,
    db: Arc<std::sync::Mutex<Connection>>,
) -> AbortOnDrop<Result<(), trellis_rs::service::ServiceRuntimeError>> {
    let mut service = OutboxRestartServiceRuntime::from_connected_client(
        OUTBOX_RESTART_SERVICE_NAME,
        Arc::new(
            connect_outbox_restart_service_client(trellis_url, contract_digest, service_key).await,
        ),
    )
    .expect("build outbox restart service runtime");

    service.register_rpc::<OutboxRestartQueueRpc, _, _>(move |_context, input| {
        let db = Arc::clone(&db);
        async move {
            let queued = OutboxRestartDocumentQueued {
                document_id: input.document_id.clone(),
            };
            let prepared = trellis_rs::client::prepare_event::<OutboxRestartQueuedEvent>(&queued)
                .map_err(trellis_rs::service::ServerError::Json)?;
            {
                let conn = db.lock().expect("lock outbox restart SQLite database");
                let mut store = trellis_rs::client::SqliteOutboxStore::new(&conn);
                store
                    .enqueue(&input.document_id, &prepared)
                    .now_or_never()
                    .expect("SQLite outbox enqueue should complete synchronously")
            }
            .map_err(outbox_restart_server_error)?;
            Ok(OutboxRestartQueueOutput {
                document_id: input.document_id,
            })
        }
    });

    AbortOnDrop::new(tokio::spawn(async move { service.run().await }))
}

fn create_outbox_restart_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open outbox restart SQLite database");
    trellis_rs::client::SqliteOutboxStore::create_schema(&conn)
        .expect("create outbox restart SQLite schema");
    conn
}

async fn dispatch_outbox_restart_once(
    db: &Arc<std::sync::Mutex<Connection>>,
    service_client: &TrellisClient,
) -> Result<OutboxDispatchResult, trellis_rs::client::EventStoreError> {
    let conn = db.lock().expect("lock outbox restart SQLite database");
    let mut store = trellis_rs::client::SqliteOutboxStore::new(&conn);
    trellis_rs::client::dispatch_outbox_once(&mut store, |event| async move {
        service_client.publish_prepared(&event).await
    })
    .await
}

async fn outbox_restart_row_status(db: &Arc<std::sync::Mutex<Connection>>, id: &str) -> String {
    let conn = db.lock().expect("lock outbox restart SQLite database");
    conn.query_row(
        "SELECT status FROM trellis_outbox_events WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .expect("read outbox restart row status")
}

fn outbox_restart_server_error(
    error: trellis_rs::client::EventStoreError,
) -> trellis_rs::service::ServerError {
    trellis_rs::service::ServerError::Nats(format!("outbox restart error: {error}"))
}

async fn call_catalog_restart_with_retry(
    client: &trellis_rs::client::TrellisClient,
    message: &str,
) -> CatalogRestartPingOutput {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .call::<CatalogRestartPingRpc>(&CatalogRestartPingInput {
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
            Err(error) => panic!("call live CatalogRestart.Ping RPC: {error}"),
        }
    }
}

async fn assert_catalog_dependency_unavailable(client: &trellis_rs::client::TrellisClient) {
    let result = client
        .call::<CatalogDependencyPingRpc>(&CatalogDependencyPingInput {
            message: "before-provider".to_string(),
        })
        .await;
    assert!(
        result.is_err(),
        "expected CatalogDependency.Ping to fail before provider service start"
    );
}

async fn call_catalog_dependency_with_retry(
    client: &trellis_rs::client::TrellisClient,
    message: &str,
) -> CatalogDependencyPingOutput {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match client
            .call::<CatalogDependencyPingRpc>(&CatalogDependencyPingInput {
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
            Err(error) => panic!("call live CatalogDependency.Ping RPC: {error}"),
        }
    }
}

async fn call_outbox_restart_queue_with_retry(
    client: &trellis_rs::client::TrellisClient,
    document_id: &str,
) -> OutboxRestartQueueOutput {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match client
            .call::<OutboxRestartQueueRpc>(&OutboxRestartQueueInput {
                document_id: document_id.to_string(),
            })
            .await
        {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Documents.Queue RPC: {error}"),
        }
    }
}

async fn wait_for_outbox_restart_queued<S>(
    stream: &mut S,
    document_id: &str,
) -> OutboxRestartDocumentQueued
where
    S: Stream<Item = Result<OutboxRestartDocumentQueued, trellis_rs::client::TrellisClientError>>
        + Unpin,
{
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(remaining, stream.next()).await {
            Ok(Some(Ok(event))) if event.document_id == document_id => return event,
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(error))) => panic!("outbox restart event stream failed: {error}"),
            Ok(None) => panic!("outbox restart event stream ended"),
            Err(_) => panic!("timed out waiting for Document.Queued {document_id}"),
        }
    }
}

async fn wait_for_catalog_force_replace_issue(
    core: &trellis_rs::sdk::core::CoreClient<'_>,
    base_digest: &str,
    replacement_digest: &str,
) -> trellis_rs::sdk::core::types::TrellisCatalogResponseCatalogIssuesItem {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let catalog = core
            .rpc()
            .trellis()
            .catalog()
            .await
            .expect("load catalog while waiting for force-replace issue");
        if let Some(issue) =
            find_catalog_force_replace_issue(&catalog, base_digest, replacement_digest)
        {
            return issue.clone();
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for catalog force-replace issue"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_catalog_force_replace_resolved(
    core: &trellis_rs::sdk::core::CoreClient<'_>,
    replacement_digest: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let catalog = core
            .rpc()
            .trellis()
            .catalog()
            .await
            .expect("load catalog while waiting for force-replace resolution");
        let has_issue = catalog
            .catalog
            .issues
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .any(|issue| {
                issue.kind == "incompatible-active-contract"
                    && issue.contract_id.as_deref() == Some(CATALOG_FORCE_REPLACE_SERVICE_ID)
            });
        let replacement_active = catalog.catalog.contracts.iter().any(|contract| {
            contract.id == CATALOG_FORCE_REPLACE_SERVICE_ID && contract.digest == replacement_digest
        });
        if !has_issue && replacement_active {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for catalog force-replace resolution"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn find_catalog_force_replace_issue<'a>(
    catalog: &'a trellis_rs::sdk::core::types::TrellisCatalogResponse,
    base_digest: &str,
    replacement_digest: &str,
) -> Option<&'a trellis_rs::sdk::core::types::TrellisCatalogResponseCatalogIssuesItem> {
    catalog
        .catalog
        .issues
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .find(|issue| {
            issue.kind == "incompatible-active-contract"
                && issue.contract_id.as_deref() == Some(CATALOG_FORCE_REPLACE_SERVICE_ID)
                && issue.conflicting_digest.as_deref() == Some(replacement_digest)
                && issue
                    .effective_digests
                    .as_deref()
                    .unwrap_or(&[])
                    .iter()
                    .any(|digest| digest == base_digest)
        })
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

fn assert_admin_app_session(me: &trellis_rs::sdk::auth::types::AuthSessionsMeResponse) {
    assert_eq!(me.participant_kind.as_str(), Some("app"));
    let user = me
        .user
        .as_object()
        .expect("Auth.Sessions.Me should return an active user");
    assert_eq!(user.get("active").and_then(Value::as_bool), Some(true));
    let capabilities = user
        .get("capabilities")
        .and_then(Value::as_array)
        .expect("Auth.Sessions.Me user should include capabilities");
    assert!(
        capabilities.iter().any(|capability| capability == "admin"),
        "Auth.Sessions.Me user should include admin capability"
    );
}

fn assert_app_user_session(me: &trellis_rs::sdk::auth::types::AuthSessionsMeResponse) {
    assert_eq!(me.participant_kind.as_str(), Some("app"));
    let user = me
        .user
        .as_object()
        .expect("Auth.Sessions.Me should return an active user");
    assert_eq!(user.get("active").and_then(Value::as_bool), Some(true));
    assert!(
        user.get("capabilities")
            .and_then(Value::as_array)
            .is_some_and(|capabilities| !capabilities.is_empty()),
        "Auth.Sessions.Me user should include capabilities"
    );
}

fn session_user_id(me: &trellis_rs::sdk::auth::types::AuthSessionsMeResponse) -> Option<String> {
    me.user
        .as_object()
        .and_then(|user| user.get("userId"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn auth_sessions_list_request() -> AuthSessionsListRequest {
    AuthSessionsListRequest {
        limit: 100,
        offset: None,
        user: None,
    }
}

fn assert_session_listed(
    sessions: &trellis_rs::sdk::auth::types::AuthSessionsListResponse,
    session_key: &str,
) {
    let session = sessions
        .entries
        .iter()
        .filter_map(Value::as_object)
        .find(|entry| entry.get("sessionKey").and_then(Value::as_str) == Some(session_key))
        .unwrap_or_else(|| panic!("expected Auth.Sessions.List to include {session_key}"));

    assert_eq!(
        session.get("participantKind").and_then(Value::as_str),
        Some("app")
    );
}

#[derive(Debug)]
struct ClientBootstrapFetch {
    status: u16,
    session_key: String,
    body: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientBootstrapRequest<'a> {
    session_key: &'a str,
    iat: u64,
    sig: String,
}

#[derive(Debug)]
struct HttpTextResponse {
    status: u16,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum BindFlowResponse {
    Bound {
        sentinel: trellis_rs::auth::SentinelCredsRecord,
        transports: trellis_rs::auth::ClientTransportsRecord,
    },
    ApprovalRequired,
    ApprovalDenied,
    InsufficientCapabilities,
}

async fn complete_local_password_account_flow(
    trellis_url: &str,
    flow_id: &str,
    username: &str,
    password: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let response = post_json_success::<Value>(
        &format!(
            "{}/auth/account-flow/{}/local-password",
            trellis_url.trim_end_matches('/'),
            flow_id
        ),
        &json!({ "username": username, "password": password }),
    )
    .await?;
    assert_eq!(
        response.get("status").and_then(Value::as_str),
        Some("created")
    );
    Ok(())
}

async fn connect_with_local_password(
    trellis_url: &str,
    contract: &trellis_test::TrellisTestContract,
    session_seed: &str,
    username: &str,
    password: &str,
) -> Result<trellis_rs::client::TrellisClient, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let redirect_to = format!(
        "{}/_trellis/test/password-reset-change",
        trellis_url.trim_end_matches('/')
    );
    let flow_id = start_local_auth_flow(trellis_url, &redirect_to, &auth, contract).await?;
    let login = post_local_login(trellis_url, &flow_id, username, password).await?;
    if !(200..300).contains(&login.status) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("local login failed ({}): {}", login.status, login.body),
        )
        .into());
    }
    approve_flow_if_needed(trellis_url, &flow_id).await?;
    let bound = bind_flow(trellis_url, &auth, &flow_id).await?;
    let BindFlowResponse::Bound {
        sentinel,
        transports,
    } = bound
    else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "local login flow did not bind after approval",
        )
        .into());
    };
    let native = transports.native.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::Other,
            "bind response missing native transport",
        )
    })?;
    let servers = native.nats_servers.join(",");
    Ok(
        trellis_rs::client::TrellisClient::connect_user(trellis_rs::client::UserConnectOptions {
            servers: &servers,
            sentinel_jwt: &sentinel.jwt,
            sentinel_seed: &sentinel.seed,
            session_key_seed_base64url: session_seed,
            contract_digest: contract.digest(),
            timeout_ms: 5_000,
        })
        .await?,
    )
}

async fn local_password_login_failure(
    trellis_url: &str,
    contract: &trellis_test::TrellisTestContract,
    session_seed: &str,
    username: &str,
    password: &str,
) -> Result<HttpTextResponse, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let redirect_to = format!(
        "{}/_trellis/test/password-reset-change-rejected",
        trellis_url.trim_end_matches('/')
    );
    let flow_id = start_local_auth_flow(trellis_url, &redirect_to, &auth, contract).await?;
    post_local_login(trellis_url, &flow_id, username, password).await
}

async fn start_local_auth_flow(
    trellis_url: &str,
    redirect_to: &str,
    auth: &trellis_rs::client::SessionAuth,
    contract: &trellis_test::TrellisTestContract,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let sig = auth.sign_sha256_domain(
        "oauth-init",
        &auth_start_signature_payload(redirect_to, contract.manifest())?,
    );
    let started = post_json_success::<trellis_rs::auth::AuthStartResponse>(
        &format!("{}/auth/requests", trellis_url.trim_end_matches('/')),
        &trellis_rs::auth::AuthStartRequest {
            provider: None,
            redirect_to: redirect_to.to_string(),
            session_key: auth.session_key.clone(),
            sig,
            contract: contract_manifest_map(contract)?,
            context: None,
        },
    )
    .await?;
    match started {
        trellis_rs::auth::AuthStartResponse::FlowStarted { login_url, .. } => {
            flow_id_from_url(&login_url)
        }
        trellis_rs::auth::AuthStartResponse::Bound { .. } => Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "fresh local-password auth request unexpectedly returned bound",
        )
        .into()),
    }
}

fn auth_start_signature_payload(
    redirect_to: &str,
    contract: &Value,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    Ok(format!(
        "{}:{}:{}:{}",
        redirect_to,
        "",
        trellis_rs::contracts::canonicalize_json(contract)?,
        trellis_rs::contracts::canonicalize_json(&Value::Null)?,
    ))
}

fn contract_manifest_map(
    contract: &trellis_test::TrellisTestContract,
) -> Result<BTreeMap<String, Value>, Box<dyn std::error::Error + Send + Sync>> {
    let Value::Object(map) = contract.manifest() else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "contract manifest must be a JSON object",
        )
        .into());
    };
    Ok(map.clone().into_iter().collect())
}

async fn post_local_login(
    trellis_url: &str,
    flow_id: &str,
    username: &str,
    password: &str,
) -> Result<HttpTextResponse, Box<dyn std::error::Error + Send + Sync>> {
    post_json_text(
        &format!("{}/auth/login/local", trellis_url.trim_end_matches('/')),
        &json!({ "flowId": flow_id, "username": username, "password": password }),
    )
    .await
}

async fn approve_flow_if_needed(
    trellis_url: &str,
    flow_id: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = fetch_json(&format!(
        "{}/auth/flow/{}",
        trellis_url.trim_end_matches('/'),
        flow_id
    ))
    .await?;
    match state.get("status").and_then(Value::as_str) {
        Some("redirect") => Ok(()),
        Some("approval_required") => {
            let approved = post_json_success::<Value>(
                &format!(
                    "{}/auth/flow/{}/approval",
                    trellis_url.trim_end_matches('/'),
                    flow_id
                ),
                &json!({ "approved": true }),
            )
            .await?;
            assert_eq!(
                approved.get("status").and_then(Value::as_str),
                Some("redirect")
            );
            Ok(())
        }
        status => Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("unexpected local auth flow status: {status:?}"),
        )
        .into()),
    }
}

async fn bind_flow(
    trellis_url: &str,
    auth: &trellis_rs::client::SessionAuth,
    flow_id: &str,
) -> Result<BindFlowResponse, Box<dyn std::error::Error + Send + Sync>> {
    post_json_success(
        &format!(
            "{}/auth/flow/{}/bind",
            trellis_url.trim_end_matches('/'),
            flow_id
        ),
        &json!({
            "sessionKey": auth.session_key.clone(),
            "sig": auth.sign_sha256_domain("bind-flow", flow_id),
        }),
    )
    .await
}

async fn fetch_json(url: &str) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .get(url)
        .send()
        .await?;
    decode_json_response(url, response).await
}

async fn post_json_success<T>(
    url: &str,
    body: &impl Serialize,
) -> Result<T, Box<dyn std::error::Error + Send + Sync>>
where
    T: for<'de> Deserialize<'de>,
{
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .post(url)
        .json(body)
        .send()
        .await?;
    decode_json_response(url, response).await
}

async fn decode_json_response<T>(
    url: &str,
    response: reqwest::Response,
) -> Result<T, Box<dyn std::error::Error + Send + Sync>>
where
    T: for<'de> Deserialize<'de>,
{
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "HTTP request failed ({}) for {url}: {body}",
                status.as_u16()
            ),
        )
        .into());
    }
    Ok(serde_json::from_str(&body)?)
}

async fn post_json_text(
    url: &str,
    body: &impl Serialize,
) -> Result<HttpTextResponse, Box<dyn std::error::Error + Send + Sync>> {
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .post(url)
        .json(body)
        .send()
        .await?;
    let status = response.status().as_u16();
    let body = response.text().await?;
    Ok(HttpTextResponse { status, body })
}

fn flow_id_from_url(url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    reqwest::Url::parse(url)?
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Trellis auth URL is missing flowId: {url}"),
            )
            .into()
        })
}

async fn fetch_client_bootstrap(
    trellis_url: &str,
    session_seed: &str,
) -> Result<ClientBootstrapFetch, Box<dyn std::error::Error + Send + Sync>> {
    let auth = trellis_rs::client::SessionAuth::from_seed_base64url(session_seed)?;
    let iat = current_iat();
    let body = ClientBootstrapRequest {
        session_key: &auth.session_key,
        iat,
        sig: auth.sign_sha256_domain("bootstrap-client", &iat.to_string()),
    };
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()?
        .post(format!(
            "{}/bootstrap/client",
            trellis_url.trim_end_matches('/')
        ))
        .json(&body)
        .send()
        .await?;
    let status = response.status().as_u16();
    let body = response.json::<Value>().await?;

    Ok(ClientBootstrapFetch {
        status,
        session_key: auth.session_key,
        body,
    })
}

fn current_iat() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before UNIX epoch")
        .as_secs()
}
