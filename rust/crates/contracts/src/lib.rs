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
mod schema;

pub use builder::{
    job_queue, kv, operation, rpc, schema_ref, store, stream, stream_source, subject, use_contract,
    ContractManifestBuilder,
};
pub use canonical::{canonicalize_json, digest_json, sha256_base64url};
pub use catalog::{
    catalog_canonical_json, pack_loaded_manifests, pack_manifest_dir, pack_manifest_paths,
    write_catalog_pack,
};
pub use error::ContractsError;
pub use manifest::{load_json_value, load_manifest, manifest_paths_in_dir, parse_manifest};
pub use model::{
    Catalog, CatalogEntry, CatalogPack, ContractErrorDecl, ContractErrorRef, ContractEvent,
    ContractExports, ContractJobQueueResource, ContractKind, ContractKvResource, ContractManifest,
    ContractOperation, ContractOperationTransfer, ContractResources, ContractRpcMethod,
    ContractSchemaRef, ContractStoreResource, ContractStreamResource, ContractStreamSource,
    ContractSubject, ContractUseOperation, ContractUsePubSub, ContractUseRef, ContractUseRpc,
    LoadedManifest, OperationCapabilities, PubSubCapabilities, RpcCapabilities, CATALOG_FORMAT_V1,
    CONTRACT_FORMAT_V1,
};
pub use schema::{validate_catalog, validate_manifest};

#[cfg(test)]
mod tests;
