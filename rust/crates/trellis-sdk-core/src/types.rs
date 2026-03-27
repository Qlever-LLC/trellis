//! Shared request and response types for `trellis.core@v1`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Generated schema type `TrellisBindingsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetRequest {
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

/// Generated schema type `TrellisBindingsGetResponse`.
/// Generated schema type `TrellisBindingsGetResponseBinding`.
/// Generated schema type `TrellisBindingsGetResponseBindingResources`.
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesJobs`.
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesJobsRegistry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesJobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesJobs {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<TrellisBindingsGetResponseBindingResourcesJobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResources {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<TrellisBindingsGetResponseBindingResourcesJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBinding {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub digest: String,
    pub resources: TrellisBindingsGetResponseBindingResources,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding: Option<TrellisBindingsGetResponseBinding>,
}

/// Generated schema type `TrellisCatalogResponse`.
/// Generated schema type `TrellisCatalogResponseCatalog`.
/// Generated schema type `TrellisCatalogResponseCatalogContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponseCatalogContractsItem {
    pub description: String,
    pub digest: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponseCatalog {
    pub contracts: Vec<TrellisCatalogResponseCatalogContractsItem>,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponse {
    pub catalog: TrellisCatalogResponseCatalog,
}

/// Generated schema type `TrellisContractGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetRequest {
    pub digest: String,
}

/// Generated schema type `TrellisContractGetResponse`.
/// Generated schema type `TrellisContractGetResponseContract`.
/// Generated schema type `TrellisContractGetResponseContractResources`.
/// Generated schema type `TrellisContractGetResponseContractResourcesJobs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractResourcesJobs {
    pub queues: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractResources {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<TrellisContractGetResponseContractResourcesJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContract {
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<BTreeMap<String, Value>>,
    pub format: String,
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<TrellisContractGetResponseContractResources>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schemas: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uses: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponse {
    pub contract: TrellisContractGetResponseContract,
}

