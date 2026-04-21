use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The canonical format identifier for a Trellis contract manifest.
pub const CONTRACT_FORMAT_V1: &str = "trellis.contract.v1";

/// The canonical format identifier for a Trellis catalog.
pub const CATALOG_FORMAT_V1: &str = "trellis.catalog.v1";

/// The supported kinds of Trellis contracts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContractKind {
    Service,
    App,
    Device,
    Agent,
}

/// A named serializable error definition declared by a contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractErrorDecl {
    #[serde(rename = "type")]
    pub error_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<ContractSchemaRef>,
}

/// A reference to one named top-level contract schema.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractSchemaRef {
    pub schema: String,
}

/// A reference to a named contract error declaration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractErrorRef {
    #[serde(rename = "type")]
    pub error_type: String,
}

/// Capability requirements for invoking an RPC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RpcCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<Vec<String>>,
}

/// Capability requirements for publishing or subscribing to a surface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PubSubCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribe: Option<Vec<String>>,
}

/// RPC selections from a `uses` dependency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractUseRpc {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<Vec<String>>,
}

/// Event or subject selections from a `uses` dependency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractUsePubSub {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribe: Option<Vec<String>>,
}

/// Operation selections from a `uses` dependency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractUseOperation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<Vec<String>>,
}

/// One cross-contract dependency declared by a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractUseRef {
    pub contract: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc: Option<ContractUseRpc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operations: Option<ContractUseOperation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<ContractUsePubSub>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<ContractUsePubSub>,
}

/// Capability requirements for invoking and observing an operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct OperationCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractOperationTransfer {
    pub store: String,
    pub key: String,
    #[serde(rename = "contentType", skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
    #[serde(rename = "expiresInMs", skip_serializing_if = "Option::is_none")]
    pub expires_in_ms: Option<i64>,
    #[serde(rename = "maxBytes", skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<i64>,
}

/// One owned operation declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractOperation {
    pub version: String,
    pub subject: String,
    pub input: ContractSchemaRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<ContractSchemaRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<ContractSchemaRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer: Option<ContractOperationTransfer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<OperationCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel: Option<bool>,
}

/// One owned RPC declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractRpcMethod {
    pub version: String,
    pub subject: String,
    pub input: ContractSchemaRef,
    pub output: ContractSchemaRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<RpcCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<ContractErrorRef>>,
}

/// One owned event declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractEvent {
    pub version: String,
    pub subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<String>>,
    pub event: ContractSchemaRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<PubSubCapabilities>,
}

/// One owned raw subject declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractSubject {
    pub subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<ContractSchemaRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<PubSubCapabilities>,
}

/// One logical KV resource declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractKvResource {
    pub purpose: String,
    pub schema: ContractSchemaRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<i64>,
    #[serde(rename = "ttlMs", skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<i64>,
    #[serde(rename = "maxValueBytes", skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
}

/// One logical store resource declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractStoreResource {
    pub purpose: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(rename = "ttlMs", skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<i64>,
    #[serde(rename = "maxObjectBytes", skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    #[serde(rename = "maxTotalBytes", skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
}

/// One logical jobs queue declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractJobQueueResource {
    pub payload: ContractSchemaRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ContractSchemaRef>,
    #[serde(rename = "maxDeliver", skip_serializing_if = "Option::is_none")]
    pub max_deliver: Option<i64>,
    #[serde(rename = "backoffMs", skip_serializing_if = "Option::is_none")]
    pub backoff_ms: Option<Vec<i64>>,
    #[serde(rename = "ackWaitMs", skip_serializing_if = "Option::is_none")]
    pub ack_wait_ms: Option<i64>,
    #[serde(rename = "defaultDeadlineMs", skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dlq: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<i64>,
}

/// One logical stream resource declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractStreamSource {
    #[serde(rename = "fromAlias")]
    pub from_alias: String,
    #[serde(rename = "filterSubject", skip_serializing_if = "Option::is_none")]
    pub filter_subject: Option<String>,
    #[serde(
        rename = "subjectTransformDest",
        skip_serializing_if = "Option::is_none"
    )]
    pub subject_transform_dest: Option<String>,
}

/// One logical stream resource declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractStreamResource {
    pub purpose: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    pub subjects: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage: Option<String>,
    #[serde(rename = "numReplicas", skip_serializing_if = "Option::is_none")]
    pub num_replicas: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discard: Option<String>,
    #[serde(rename = "maxMsgs", skip_serializing_if = "Option::is_none")]
    pub max_msgs: Option<i64>,
    #[serde(rename = "maxBytes", skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<i64>,
    #[serde(rename = "maxAgeMs", skip_serializing_if = "Option::is_none")]
    pub max_age_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<ContractStreamSource>>,
}

/// Resource declarations in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractResources {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub kv: BTreeMap<String, ContractKvResource>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub store: BTreeMap<String, ContractStoreResource>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub streams: BTreeMap<String, ContractStreamResource>,
}

/// The canonical Trellis contract manifest model.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractManifest {
    pub format: String,
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    pub kind: ContractKind,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub schemas: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub uses: BTreeMap<String, ContractUseRef>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub rpc: BTreeMap<String, ContractRpcMethod>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub operations: BTreeMap<String, ContractOperation>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub events: BTreeMap<String, ContractEvent>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub subjects: BTreeMap<String, ContractSubject>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub errors: BTreeMap<String, ContractErrorDecl>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub jobs: BTreeMap<String, ContractJobQueueResource>,
    #[serde(default, skip_serializing_if = "ContractResources::is_empty")]
    pub resources: ContractResources,
}

impl ContractResources {
    fn is_empty(&self) -> bool {
        self.kv.is_empty() && self.store.is_empty() && self.streams.is_empty()
    }
}

/// The deployment-wide active contract catalog.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Catalog {
    pub format: String,
    pub contracts: Vec<CatalogEntry>,
}

/// One active contract entry in a catalog.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogEntry {
    pub id: String,
    pub digest: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
}

/// A manifest together with its parsed, canonicalized, and digested forms.
#[derive(Debug, Clone)]
pub struct LoadedManifest {
    pub path: PathBuf,
    pub value: Value,
    pub manifest: ContractManifest,
    pub canonical: String,
    pub digest: String,
}

/// The result of packing multiple manifests into one catalog.
#[derive(Debug, Clone)]
pub struct CatalogPack {
    pub catalog: Catalog,
    pub contracts: Vec<LoadedManifest>,
}
