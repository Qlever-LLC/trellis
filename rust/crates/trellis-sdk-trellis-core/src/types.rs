//! Shared request and response types for `trellis.core@v1`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Request payload for `Trellis.Bindings.Get`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetRequest {
    #[serde(rename = "contractId", skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

/// Response payload for `Trellis.Bindings.Get`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding: Option<TrellisBindingsGetBinding>,
}

/// One resolved service contract binding.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetBinding {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub digest: String,
    pub resources: TrellisBindingResources,
}

/// Logical resource bindings resolved for an installed contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingResources {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, TrellisKvBinding>>,
}

/// One KV binding resolved for a logical resource alias.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisKvBinding {
    pub bucket: String,
    pub history: i64,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
    #[serde(rename = "maxValueBytes", skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
}

/// Response payload for `Trellis.Catalog`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponse {
    pub catalog: TrellisCatalog,
}

/// Deployment contract catalog.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalog {
    pub format: String,
    pub contracts: Vec<TrellisCatalogEntry>,
}

/// One catalog entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogEntry {
    pub id: String,
    pub digest: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    pub kind: String,
}

/// Request payload for `Trellis.Contract.Get`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetRequest {
    pub digest: String,
}

/// Response payload for `Trellis.Contract.Get`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponse {
    pub contract: TrellisContract,
}

/// Canonical contract manifest returned by `Trellis.Contract.Get`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContract {
    pub format: String,
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uses: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<TrellisContractResources>,
}

/// Resource block embedded in a contract manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractResources {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}
