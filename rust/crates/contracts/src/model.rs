use std::collections::BTreeMap;
use std::ops::Index;
use std::path::PathBuf;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
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

/// Programmer-facing Markdown documentation attached to a contract surface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractDocs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub markdown: String,
}

/// Capability requirements for invoking an RPC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RpcCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<Vec<String>>,
}

/// Human-facing metadata for one contract-declared capability.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractCapabilityMetadata {
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consequence: Option<String>,
}

/// Contract-declared capability metadata, keyed by capability name.
pub type ContractCapabilities = BTreeMap<String, ContractCapabilityMetadata>;

/// Capability requirements for publishing or subscribing to a surface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PubSubCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribe: Option<Vec<String>>,
}

/// Capability requirements for subscribing to a feed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct FeedCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribe: Option<Vec<String>>,
}

/// RPC selections from a `uses` dependency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractUseRpc {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<Vec<String>>,
}

/// Event selections from a `uses` dependency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractUsePubSub {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribe: Option<Vec<String>>,
}

/// Feed selections from a `uses` dependency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractUseFeed {
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
    pub feeds: Option<ContractUseFeed>,
}

/// Contract dependency declarations split by whether they are required at runtime.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ContractUses {
    required: BTreeMap<String, ContractUseRef>,
    optional: BTreeMap<String, ContractUseRef>,
}

#[derive(Debug, Deserialize)]
struct ContractUsesGroupedWire {
    #[serde(default)]
    required: BTreeMap<String, ContractUseRef>,
    #[serde(default)]
    optional: BTreeMap<String, ContractUseRef>,
}

impl<'de> Deserialize<'de> for ContractUses {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let grouped = ContractUsesGroupedWire::deserialize(deserializer)?;
        Ok(Self {
            required: grouped.required,
            optional: grouped.optional,
        })
    }
}

impl Serialize for ContractUses {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct GroupedUses<'a> {
            #[serde(skip_serializing_if = "BTreeMap::is_empty")]
            required: &'a BTreeMap<String, ContractUseRef>,
            #[serde(skip_serializing_if = "BTreeMap::is_empty")]
            optional: &'a BTreeMap<String, ContractUseRef>,
        }

        GroupedUses {
            required: &self.required,
            optional: &self.optional,
        }
        .serialize(serializer)
    }
}

/// Supported Trellis-managed state store shapes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContractStateKind {
    Value,
    Map,
}

/// One Trellis-managed state store declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractStateStore {
    pub kind: ContractStateKind,
    pub schema: ContractSchemaRef,
    #[serde(rename = "stateVersion", skip_serializing_if = "Option::is_none")]
    pub state_version: Option<String>,
    #[serde(
        rename = "acceptedVersions",
        skip_serializing_if = "BTreeMap::is_empty",
        default
    )]
    pub accepted_versions: BTreeMap<String, ContractSchemaRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
}

/// Capability requirements for invoking and observing an operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct OperationCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observe: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control: Option<Vec<String>>,
}

/// Transfer direction for operation-backed file uploads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContractOperationTransferDirection {
    Send,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractOperationTransfer {
    pub direction: ContractOperationTransferDirection,
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub signals: BTreeMap<String, ContractOperationSignal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
}

/// One named signal declaration for a running operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractOperationSignal {
    pub input: ContractSchemaRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
}

/// Transfer direction for RPC-backed receive grants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContractRpcTransferDirection {
    Receive,
}

/// One RPC transfer grant declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractRpcTransfer {
    pub direction: ContractRpcTransferDirection,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer: Option<ContractRpcTransfer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
}

/// One owned feed declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractFeed {
    pub version: String,
    pub subject: String,
    pub input: ContractSchemaRef,
    pub event: ContractSchemaRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<FeedCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
}

/// Resource declarations in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractResources {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub kv: BTreeMap<String, ContractKvResource>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub store: BTreeMap<String, ContractStoreResource>,
}

/// Explicit public schema exports for generated SDK consumers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ContractExports {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub schemas: Vec<String>,
}

/// The canonical Trellis contract manifest model.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractManifest {
    pub format: String,
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<ContractDocs>,
    pub kind: ContractKind,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub capabilities: ContractCapabilities,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub schemas: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "ContractExports::is_empty")]
    pub exports: ContractExports,
    #[serde(default, skip_serializing_if = "ContractUses::is_empty")]
    pub uses: ContractUses,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub state: BTreeMap<String, ContractStateStore>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub rpc: BTreeMap<String, ContractRpcMethod>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub operations: BTreeMap<String, ContractOperation>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub events: BTreeMap<String, ContractEvent>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub feeds: BTreeMap<String, ContractFeed>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub errors: BTreeMap<String, ContractErrorDecl>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub jobs: BTreeMap<String, ContractJobQueueResource>,
    #[serde(default, skip_serializing_if = "ContractResources::is_empty")]
    pub resources: ContractResources,
}

impl ContractResources {
    fn is_empty(&self) -> bool {
        self.kv.is_empty() && self.store.is_empty()
    }
}

impl ContractExports {
    fn is_empty(&self) -> bool {
        self.schemas.is_empty()
    }
}

impl ContractUses {
    /// Return whether no required or optional dependency aliases are declared.
    pub fn is_empty(&self) -> bool {
        self.required.is_empty() && self.optional.is_empty()
    }

    /// Return required dependency aliases.
    pub fn required(&self) -> &BTreeMap<String, ContractUseRef> {
        &self.required
    }

    /// Return mutable required dependency aliases.
    pub fn required_mut(&mut self) -> &mut BTreeMap<String, ContractUseRef> {
        &mut self.required
    }

    /// Return optional dependency aliases.
    pub fn optional(&self) -> &BTreeMap<String, ContractUseRef> {
        &self.optional
    }

    /// Return mutable optional dependency aliases.
    pub fn optional_mut(&mut self) -> &mut BTreeMap<String, ContractUseRef> {
        &mut self.optional
    }

    /// Return a dependency alias, searching required aliases before optional aliases.
    pub fn get(&self, alias: &str) -> Option<&ContractUseRef> {
        self.required
            .get(alias)
            .or_else(|| self.optional.get(alias))
    }

    /// Return whether a dependency alias is declared in either group.
    pub fn contains_key(&self, alias: &str) -> bool {
        self.get(alias).is_some()
    }

    /// Iterate over required aliases first, followed by optional aliases.
    pub fn iter(&self) -> impl Iterator<Item = (&String, &ContractUseRef)> {
        self.required.iter().chain(
            self.optional
                .iter()
                .filter(|(alias, _)| !self.required.contains_key(*alias)),
        )
    }
}

impl Index<&str> for ContractUses {
    type Output = ContractUseRef;

    fn index(&self, index: &str) -> &Self::Output {
        self.get(index)
            .unwrap_or_else(|| panic!("no contract use alias '{index}'"))
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
