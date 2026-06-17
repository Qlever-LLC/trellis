//! Curated public Rust facade for Trellis clients, services, contracts, auth, and jobs.
//!
//! This crate is the normal Rust authoring entrypoint. It re-exports stable,
//! commonly used runtime types without exposing low-level service loops,
//! bootstrap hosts, or generated artifact internals.
//!
//! Generated SDK crates and participant facades include a package-local
//! `TRELLIS.md` for AI-agent use. Prefer descriptor and generated facade APIs:
//! `TrellisClient::call::<RpcDescriptor>(...)`,
//! `TrellisClient::publish::<EventDescriptor>(...)`,
//! `TrellisClient::subscribe::<EventDescriptor>()`,
//! `TrellisClient::feed::<FeedDescriptor>(input)`,
//! `TrellisClient::operation::<Operation>().start(...)`, generated wrappers
//! like `.rpc().group().method(...)`, and service registration through
//! `handle().rpc().group().method(handler)` where generated.
//!
//! Prepared event and outbox/inbox support lives under [`client`]:
//! `PreparedTrellisEvent`, `prepare_event::<Descriptor>(...)`,
//! `publish_prepared`, `dispatch_outbox_once`, `OutboxStore`, `InboxStore`,
//! `SqliteOutboxStore`, `SqliteInboxStore`, `PostgresOutboxStore`,
//! `PostgresInboxStore`, `NatsKvOutboxStore`, and `NatsKvInboxStore`.

/// Authenticated outbound client runtime types for generated SDKs and normal clients.
pub mod client;

/// High-level service runtime and service-authoring support types.
pub mod service;

/// Contract manifest, pagination, and schema helper types.
pub mod contracts {
    pub use trellis_contracts::{
        canonicalize_json, contract_capability_namespace, digest_contract_json,
        digest_contract_value, digest_json, event, feed, global_capability_name, job_queue, kv,
        load_json_value, load_manifest, manifest_paths_in_dir, normalize_manifest_value, operation,
        parse_manifest, project_contract_digest_manifest, rpc, schema_ref, sha256_base64url, state,
        store, use_contract, validate_catalog, validate_manifest, Catalog, CatalogEntry,
        CatalogPack, ContractCapabilities, ContractCapabilityMetadata, ContractErrorDecl,
        ContractErrorRef, ContractEvent, ContractExports, ContractFeed, ContractJobQueueResource,
        ContractKind, ContractKvResource, ContractManifest, ContractManifestBuilder,
        ContractOperation, ContractOperationSignal, ContractOperationTransfer,
        ContractOperationTransferDirection, ContractResources, ContractRpcMethod,
        ContractRpcTransfer, ContractRpcTransferDirection, ContractSchemaRef, ContractStateKind,
        ContractStateStore, ContractStoreResource, ContractUseFeed, ContractUseOperation,
        ContractUsePubSub, ContractUseRef, ContractUseRpc, ContractUses, ContractsError,
        FeedCapabilities, LoadedManifest, OperationCapabilities, PageRequest, PageResponse,
        PubSubCapabilities, RpcCapabilities, CATALOG_FORMAT_V1, CONTRACT_FORMAT_V1,
    };
}

/// Public authentication flows, session helpers, and auth protocol types.
pub mod auth;

/// Service-local jobs runtime types for service authors.
pub mod jobs;

/// Public facades for Trellis-owned generated contract SDKs.
pub mod sdk {
    /// Auth contract SDK surface.
    pub mod auth;

    /// Core contract SDK surface.
    pub mod core;

    /// Health contract SDK surface.
    pub mod health;

    /// Jobs contract SDK surface.
    pub mod jobs;

    /// State contract SDK surface.
    pub mod state;
}

#[cfg(test)]
mod tests {
    use std::fs;

    #[test]
    fn exposes_core_facade_modules() {
        let _request = crate::contracts::PageRequest {
            offset: None,
            limit: 25,
        };
        let _options =
            crate::service::ServiceConnectOptions::new("http://localhost:8080", "svc", "seed");
        let _state = crate::jobs::JobState::Pending;
    }

    #[test]
    fn low_level_workspace_crates_are_not_publishable_packages() {
        let crate_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let crates_dir = crate_dir
            .parent()
            .expect("trellis crate should live under rust/crates");
        for manifest in [
            "auth/Cargo.toml",
            "auth-adapters/Cargo.toml",
            "client/Cargo.toml",
            "cli/Cargo.toml",
            "codegen-rust/Cargo.toml",
            "codegen-ts/Cargo.toml",
            "bootstrap/Cargo.toml",
            "contracts/Cargo.toml",
            "core-bootstrap/Cargo.toml",
            "generate-runner/Cargo.toml",
            "integration-harness/Cargo.toml",
            "jobs/Cargo.toml",
            "local-bootstrap/Cargo.toml",
            "runtime/Cargo.toml",
            "service/Cargo.toml",
            "service-jobs/Cargo.toml",
            "service-runtime/Cargo.toml",
            "trellis/Cargo.toml",
            "trellis-test/Cargo.toml",
        ] {
            let contents = fs::read_to_string(crates_dir.join(manifest))
                .expect("internal crate manifest should be readable");
            assert!(
                contents.contains("publish = false"),
                "{manifest} must stay non-publishable"
            );
        }
    }

    #[test]
    fn trellis_does_not_depend_on_generated_trellis_owned_sdk_packages() {
        let manifest =
            fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
                .expect("trellis manifest should be readable");
        for package in [
            "trellis-sdk-auth",
            "trellis-sdk-core",
            "trellis-sdk-health",
            "trellis-sdk-jobs",
            "trellis-sdk-state",
        ] {
            assert!(
                !manifest.contains(package),
                "{package} must be embedded as trellis_rs::sdk, not a trellis dependency"
            );
        }
    }

    #[test]
    fn trellis_does_not_depend_on_old_internal_package_identities() {
        let manifest =
            fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
                .expect("trellis manifest should be readable");
        for package in [
            "trellis-auth",
            "trellis-auth-adapters",
            "trellis-client",
            "trellis-core-bootstrap",
            "trellis-jobs",
            "trellis-service",
            "trellis-service-runtime",
        ] {
            assert!(
                !manifest.contains(package),
                "{package} must be implemented as a trellis module, not a trellis dependency"
            );
        }
    }

    #[test]
    fn trellis_owned_generated_sdk_packages_are_not_publishable_packages() {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .expect("trellis crate should live under rust/crates/trellis");
        for manifest in [
            "generated/packages/cargo/auth/Cargo.toml",
            "generated/packages/cargo/trellis-core/Cargo.toml",
            "generated/packages/cargo/health/Cargo.toml",
            "generated/packages/cargo/jobs/Cargo.toml",
            "generated/packages/cargo/state/Cargo.toml",
        ] {
            let contents = fs::read_to_string(repo_root.join(manifest))
                .expect("generated Trellis-owned SDK manifest should be readable");
            assert!(
                contents.contains("publish = false"),
                "{manifest} must stay non-publishable"
            );
        }
    }
}
