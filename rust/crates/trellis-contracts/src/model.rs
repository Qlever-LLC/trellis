use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The canonical format identifier for a Trellis contract manifest.
pub const CONTRACT_FORMAT_V1: &str = "trellis.contract.v1";

/// The canonical format identifier for a Trellis catalog.
pub const CATALOG_FORMAT_V1: &str = "trellis.catalog.v1";

/// A named serializable error definition declared by a contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractErrorDecl {
    #[serde(rename = "type")]
    pub error_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
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

/// One cross-contract dependency declared by a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractUseRef {
    pub contract: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc: Option<ContractUseRpc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<ContractUsePubSub>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<ContractUsePubSub>,
}

/// One owned RPC declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractRpcMethod {
    pub version: String,
    pub subject: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    #[serde(rename = "outputSchema")]
    pub output_schema: Value,
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
    #[serde(rename = "eventSchema")]
    pub event_schema: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<PubSubCapabilities>,
}

/// One owned raw subject declaration in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractSubject {
    pub subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<PubSubCapabilities>,
}

/// The canonical Trellis contract manifest model.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractManifest {
    pub format: String,
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub uses: BTreeMap<String, ContractUseRef>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub rpc: BTreeMap<String, ContractRpcMethod>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub events: BTreeMap<String, ContractEvent>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub subjects: BTreeMap<String, ContractSubject>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub errors: BTreeMap<String, ContractErrorDecl>,
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
    pub kind: String,
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
