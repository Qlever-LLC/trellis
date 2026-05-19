//! Contract and catalog primitives for the Trellis canonical JSON artifacts.
//!
//! This crate owns manifest parsing, schema validation, canonicalization, and
//! catalog packing. It intentionally stays transport-agnostic so the runtime and
//! generators can share one contract source of truth.

mod builder;
mod canonical;
mod catalog;
mod error;
mod manifest;
mod model;
mod pagination;
mod schema;

pub use builder::{
    contract_capability_namespace, event, feed, global_capability_name, job_queue, kv, operation,
    rpc, schema_ref, state, store, use_contract, ContractManifestBuilder,
};
pub use canonical::{canonicalize_json, digest_json, sha256_base64url};
pub use catalog::{
    catalog_canonical_json, pack_loaded_manifests, pack_manifest_dir, pack_manifest_paths,
    write_catalog_pack,
};
pub use error::ContractsError;
pub use manifest::{
    digest_contract_json, digest_contract_value, load_json_value, load_manifest,
    manifest_paths_in_dir, normalize_manifest_value, parse_manifest,
    project_contract_digest_manifest,
};
pub use model::{
    Catalog, CatalogEntry, CatalogPack, ContractCapabilities, ContractCapabilityMetadata,
    ContractErrorDecl, ContractErrorRef, ContractEvent, ContractExports, ContractFeed,
    ContractJobQueueResource, ContractKind, ContractKvResource, ContractManifest,
    ContractOperation, ContractOperationSignal, ContractOperationTransfer,
    ContractOperationTransferDirection, ContractResources, ContractRpcMethod, ContractRpcTransfer,
    ContractRpcTransferDirection, ContractSchemaRef, ContractStateKind, ContractStateStore,
    ContractStoreResource, ContractUseFeed, ContractUseOperation, ContractUsePubSub,
    ContractUseRef, ContractUseRpc, ContractUses, FeedCapabilities, LoadedManifest,
    OperationCapabilities, PubSubCapabilities, RpcCapabilities, CATALOG_FORMAT_V1,
    CONTRACT_FORMAT_V1,
};
pub use pagination::{PageRequest, PageResponse};
pub use schema::{validate_catalog, validate_manifest};

#[cfg(test)]
mod tests;
