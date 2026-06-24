//! Rust runtime entrypoint support for Trellis.
//!
//! This crate currently provides only the first runtime slice: mode parsing and
//! TOML configuration loading/validation plus a minimal HTTP readiness server.

/// Runtime configuration loading, defaults, and validation.
pub mod config;
/// Runtime mode parsing and subsystem selection.
pub mod mode;
/// Minimal HTTP readiness and version server.
pub mod server;
/// Cooperative runtime shutdown primitives.
pub mod shutdown;

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
/// Event log subsystem scaffold.
pub mod eventlog;
#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
/// Health subsystem scaffold.
pub mod health;
#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
/// Jobs subsystem scaffold.
pub mod jobs;
#[cfg(feature = "nats-leases")]
/// NATS-backed lease primitives.
pub mod leases;
#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
/// Platform subsystem scaffold and bootstrap services.
pub mod platform;
#[cfg(feature = "sqlite-storage")]
/// SQLite storage for built-in runtime subsystems.
pub mod storage;
#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
/// Runtime supervisor startup and subsystem lifecycle orchestration.
pub mod supervisor;

pub use config::{
    AuthConfig, ClientConfig, ConfigError, HttpConfig, LeasesConfig, LocalIdentityConfig,
    NatsAuthCalloutConfig, NatsConfig, NatsRuntimeConfig, OAuthConfig, OAuthProviderConfig,
    PlatformTtlConfig, ResolvedLeasesConfig, ResolvedNatsAuthCalloutConfig,
    ResolvedRuntimeNatsConfig, RuntimeConfig, SqliteStorageConfig, StorageBackend, StorageConfig,
    SubsystemConfig,
};
pub use mode::{RuntimeMode, RuntimeModeParseError, SubsystemName};
pub use server::{build_version_info, run_http_server, ServerError, VersionInfo};

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
pub use supervisor::{run, RuntimeError, RuntimeOptions};
