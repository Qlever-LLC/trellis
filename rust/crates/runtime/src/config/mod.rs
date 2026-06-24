use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{RuntimeMode, SubsystemName};

/// TOML runtime configuration for `trellis-server`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeConfig {
    /// Human-readable Trellis instance name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_name: Option<String>,
    /// HTTP listener configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http: Option<HttpConfig>,
    /// NATS server and runtime identity configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nats: Option<NatsConfig>,
    /// Browser/client connection hints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client: Option<ClientConfig>,
    /// Runtime lease configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leases: Option<LeasesConfig>,
    /// Authentication configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,
    /// OAuth provider configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth: Option<OAuthConfig>,
    /// Platform subsystem configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<SubsystemConfig>,
    /// Jobs subsystem configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<SubsystemConfig>,
    /// Health subsystem configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<SubsystemConfig>,
    /// Event log subsystem configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eventlog: Option<SubsystemConfig>,
}

impl RuntimeConfig {
    /// Loads a runtime configuration from a TOML file on disk.
    ///
    /// This function intentionally accepts only `.toml` paths. JSONC and other
    /// legacy runtime config formats are not supported by the Rust runtime.
    pub fn load_from_path(path: impl AsRef<Path>) -> Result<Self, ConfigError> {
        let path = path.as_ref();
        if path.extension().and_then(|extension| extension.to_str()) != Some("toml") {
            return Err(ConfigError::UnsupportedFormat {
                path: path.to_path_buf(),
            });
        }

        let contents = fs::read_to_string(path).map_err(|source| ConfigError::Read {
            path: path.to_path_buf(),
            source,
        })?;

        let mut config = Self::from_toml_str(&contents)?;
        if let Some(base_dir) = path.parent() {
            config.resolve_relative_paths(base_dir);
        }
        Ok(config)
    }

    /// Parses a runtime configuration from TOML source text.
    pub fn from_toml_str(contents: &str) -> Result<Self, ConfigError> {
        toml::from_str(contents).map_err(ConfigError::Parse)
    }

    /// Validates that this configuration contains the sections needed by `mode`.
    ///
    pub fn validate_for_mode(&self, mode: RuntimeMode) -> Result<(), ConfigError> {
        self.validate_oauth_provider_secrets()?;
        self.resolve_nats_runtime()?;
        self.resolve_leases()?;
        if matches!(mode, RuntimeMode::All | RuntimeMode::Platform) {
            self.resolve_nats_auth_callout()?;
        }

        for subsystem in mode.subsystems() {
            match subsystem {
                SubsystemName::Platform => {
                    self.validate_subsystem(SubsystemName::Platform, self.platform.as_ref())?
                }
                SubsystemName::Jobs => {
                    self.validate_subsystem(SubsystemName::Jobs, self.jobs.as_ref())?
                }
                SubsystemName::Health => {
                    self.validate_subsystem(SubsystemName::Health, self.health.as_ref())?
                }
                SubsystemName::Eventlog => {
                    self.validate_subsystem(SubsystemName::Eventlog, self.eventlog.as_ref())?
                }
            }
        }

        Ok(())
    }

    /// Returns the configured HTTP port, or the documented local default.
    #[must_use]
    pub fn http_port(&self) -> u16 {
        self.http
            .as_ref()
            .and_then(|http| http.port)
            .unwrap_or(3000)
    }

    /// Resolves validated storage for the platform subsystem.
    pub fn platform_storage_backend(&self) -> Result<StorageBackend, ConfigError> {
        self.subsystem_storage_backend(SubsystemName::Platform, self.platform.as_ref())
    }

    /// Resolves validated storage for the jobs subsystem.
    pub fn jobs_storage_backend(&self) -> Result<StorageBackend, ConfigError> {
        self.subsystem_storage_backend(SubsystemName::Jobs, self.jobs.as_ref())
    }

    /// Resolves validated storage for the health subsystem.
    pub fn health_storage_backend(&self) -> Result<StorageBackend, ConfigError> {
        self.subsystem_storage_backend(SubsystemName::Health, self.health.as_ref())
    }

    /// Resolves validated storage for the eventlog subsystem.
    pub fn eventlog_storage_backend(&self) -> Result<StorageBackend, ConfigError> {
        self.subsystem_storage_backend(SubsystemName::Eventlog, self.eventlog.as_ref())
    }

    /// Resolves runtime NATS connection settings into required, non-optional values.
    pub fn resolve_nats_runtime(&self) -> Result<ResolvedRuntimeNatsConfig, ConfigError> {
        let nats = self
            .nats
            .as_ref()
            .ok_or(ConfigError::MissingSection { section: "nats" })?;
        nats.resolve_runtime()
    }

    /// Resolves NATS auth-callout seed paths into required, non-optional values.
    pub fn resolve_nats_auth_callout(&self) -> Result<ResolvedNatsAuthCalloutConfig, ConfigError> {
        let nats = self
            .nats
            .as_ref()
            .ok_or(ConfigError::MissingSection { section: "nats" })?;
        nats.resolve_auth_callout()
    }

    /// Resolves runtime lease settings with defaults applied.
    pub fn resolve_leases(&self) -> Result<ResolvedLeasesConfig, ConfigError> {
        let leases = self
            .leases
            .as_ref()
            .ok_or(ConfigError::MissingSection { section: "leases" })?;
        leases.resolve()
    }

    fn validate_subsystem(
        &self,
        name: SubsystemName,
        subsystem: Option<&SubsystemConfig>,
    ) -> Result<(), ConfigError> {
        let subsystem = subsystem.ok_or(ConfigError::MissingSection {
            section: name.as_str(),
        })?;
        let storage = subsystem
            .storage
            .as_ref()
            .ok_or(ConfigError::MissingSection {
                section: storage_section_name(name),
            })?;

        storage.resolve_backend(storage_section_name(name))?;

        Ok(())
    }

    fn validate_oauth_provider_secrets(&self) -> Result<(), ConfigError> {
        let Some(oauth) = &self.oauth else {
            return Ok(());
        };

        for (provider_id, provider) in &oauth.providers {
            if provider.client_secret.is_some() && provider.client_secret_file.is_some() {
                return Err(ConfigError::InvalidSecretConfig {
                    section: "oauth.providers",
                    field: "client_secret",
                    provider_id: provider_id.clone(),
                });
            }
        }

        Ok(())
    }

    fn subsystem_storage_backend(
        &self,
        name: SubsystemName,
        subsystem: Option<&SubsystemConfig>,
    ) -> Result<StorageBackend, ConfigError> {
        let subsystem = subsystem.ok_or(ConfigError::MissingSection {
            section: name.as_str(),
        })?;
        let storage = subsystem
            .storage
            .as_ref()
            .ok_or(ConfigError::MissingSection {
                section: storage_section_name(name),
            })?;
        storage.resolve_backend(storage_section_name(name))
    }

    fn resolve_relative_paths(&mut self, base_dir: &Path) {
        if let Some(nats) = &mut self.nats {
            if let Some(runtime) = &mut nats.runtime {
                resolve_path(base_dir, &mut runtime.auth_creds_path);
                resolve_path(base_dir, &mut runtime.trellis_creds_path);
                resolve_path(base_dir, &mut runtime.system_creds_path);
                resolve_path(base_dir, &mut runtime.sentinel_creds_path);
            }
            if let Some(auth_callout) = &mut nats.auth_callout {
                resolve_path(base_dir, &mut auth_callout.issuer_signing_seed_file);
                resolve_path(base_dir, &mut auth_callout.target_signing_seed_file);
                resolve_path(base_dir, &mut auth_callout.xkey_seed_file);
            }
        }

        for storage in [
            self.platform
                .as_mut()
                .and_then(|subsystem| subsystem.storage.as_mut()),
            self.jobs
                .as_mut()
                .and_then(|subsystem| subsystem.storage.as_mut()),
            self.health
                .as_mut()
                .and_then(|subsystem| subsystem.storage.as_mut()),
            self.eventlog
                .as_mut()
                .and_then(|subsystem| subsystem.storage.as_mut()),
        ]
        .into_iter()
        .flatten()
        {
            resolve_path(base_dir, &mut storage.path);
        }

        if let Some(oauth) = &mut self.oauth {
            for provider in oauth.providers.values_mut() {
                resolve_path(base_dir, &mut provider.client_secret_file);
            }
        }
    }
}

/// HTTP listener configuration for the runtime.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HttpConfig {
    /// TCP port for the HTTP server.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// Public browser origin for runtime URLs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_origin: Option<String>,
    /// Allowed browser origins.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origins: Option<Vec<String>>,
    /// Insecure origins allowed for local development.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_insecure_origins: Option<Vec<String>>,
    /// Maximum requests per rate-limit window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_max: Option<u32>,
    /// Rate-limit window in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_window_ms: Option<u64>,
}

/// NATS configuration for runtime connections and auth callout material.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NatsConfig {
    /// NATS server URL or comma-separated URLs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub servers: Option<String>,
    /// Generated runtime credential paths.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<NatsRuntimeConfig>,
    /// Auth-callout signing and xkey seed paths.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_callout: Option<NatsAuthCalloutConfig>,
}

/// Generated NATS credential paths used by the runtime.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NatsRuntimeConfig {
    /// Auth-account runtime user creds path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_creds_path: Option<PathBuf>,
    /// Trellis-account runtime user creds path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trellis_creds_path: Option<PathBuf>,
    /// System-account runtime user creds path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_creds_path: Option<PathBuf>,
    /// Sentinel user creds path returned during bootstrap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentinel_creds_path: Option<PathBuf>,
}

/// NATS auth-callout signing and encryption material paths.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NatsAuthCalloutConfig {
    /// Auth issuer signing seed file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuer_signing_seed_file: Option<PathBuf>,
    /// Trellis target signing seed file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_signing_seed_file: Option<PathBuf>,
    /// Auth-callout xkey seed file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xkey_seed_file: Option<PathBuf>,
}

impl NatsConfig {
    /// Resolves this raw NATS section into runtime connection settings.
    pub(crate) fn resolve_runtime(&self) -> Result<ResolvedRuntimeNatsConfig, ConfigError> {
        let runtime = self.runtime.as_ref().ok_or(ConfigError::MissingSection {
            section: "nats.runtime",
        })?;

        Ok(ResolvedRuntimeNatsConfig {
            servers: require_string("nats", "servers", self.servers.as_deref())?,
            auth_creds_path: require_path(
                "nats.runtime",
                "auth_creds_path",
                runtime.auth_creds_path.as_ref(),
            )?,
            trellis_creds_path: require_path(
                "nats.runtime",
                "trellis_creds_path",
                runtime.trellis_creds_path.as_ref(),
            )?,
            system_creds_path: require_path(
                "nats.runtime",
                "system_creds_path",
                runtime.system_creds_path.as_ref(),
            )?,
            sentinel_creds_path: require_path(
                "nats.runtime",
                "sentinel_creds_path",
                runtime.sentinel_creds_path.as_ref(),
            )?,
        })
    }

    /// Resolves this raw NATS section into auth-callout seed paths.
    pub(crate) fn resolve_auth_callout(
        &self,
    ) -> Result<ResolvedNatsAuthCalloutConfig, ConfigError> {
        let auth_callout = self
            .auth_callout
            .as_ref()
            .ok_or(ConfigError::MissingSection {
                section: "nats.auth_callout",
            })?;

        Ok(ResolvedNatsAuthCalloutConfig {
            issuer_signing_seed_file: require_path(
                "nats.auth_callout",
                "issuer_signing_seed_file",
                auth_callout.issuer_signing_seed_file.as_ref(),
            )?,
            target_signing_seed_file: require_path(
                "nats.auth_callout",
                "target_signing_seed_file",
                auth_callout.target_signing_seed_file.as_ref(),
            )?,
            xkey_seed_file: require_path(
                "nats.auth_callout",
                "xkey_seed_file",
                auth_callout.xkey_seed_file.as_ref(),
            )?,
        })
    }
}

/// Resolved runtime NATS credential configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedRuntimeNatsConfig {
    /// NATS server URL or comma-separated URLs.
    pub servers: String,
    /// Auth-account runtime user creds path.
    pub auth_creds_path: PathBuf,
    /// Trellis-account runtime user creds path.
    pub trellis_creds_path: PathBuf,
    /// System-account runtime user creds path.
    pub system_creds_path: PathBuf,
    /// Sentinel user creds path.
    pub sentinel_creds_path: PathBuf,
}

/// Resolved NATS auth-callout signing and encryption material paths.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedNatsAuthCalloutConfig {
    /// Auth issuer signing seed file.
    pub issuer_signing_seed_file: PathBuf,
    /// Trellis target signing seed file.
    pub target_signing_seed_file: PathBuf,
    /// Auth-callout xkey seed file.
    pub xkey_seed_file: PathBuf,
}

/// Browser/client connection hints emitted by the runtime.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientConfig {
    /// WebSocket NATS server URLs for browser clients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ws_nats_servers: Option<Vec<String>>,
    /// NATS server URLs for non-browser clients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nats_servers: Option<Vec<String>>,
}

/// Runtime lease configuration.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LeasesConfig {
    /// NATS KV bucket used for runtime leases.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bucket: Option<String>,
    /// NATS KV replica count for runtime lease durability.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replicas: Option<u16>,
    /// Lease time-to-live in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<u64>,
    /// Lease renewal interval in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renew_ms: Option<u64>,
}

impl LeasesConfig {
    /// Resolves this raw lease config with defaults applied.
    pub(crate) fn resolve(&self) -> Result<ResolvedLeasesConfig, ConfigError> {
        Ok(ResolvedLeasesConfig {
            bucket: self
                .bucket
                .as_deref()
                .unwrap_or("trellis_runtime_leases")
                .to_owned(),
            replicas: self.replicas.ok_or(ConfigError::InvalidLeasesConfig {
                section: "leases",
                field: "replicas",
                reason: "must be configured explicitly",
            })?,
            ttl_ms: self.ttl_ms.unwrap_or(15_000),
            renew_ms: self.renew_ms.unwrap_or(5_000),
        })
    }
}

/// Resolved runtime lease configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedLeasesConfig {
    /// NATS KV bucket used for runtime leases.
    pub bucket: String,
    /// NATS KV replica count for runtime lease durability.
    pub replicas: u16,
    /// Lease time-to-live in milliseconds.
    pub ttl_ms: u64,
    /// Lease renewal interval in milliseconds.
    pub renew_ms: u64,
}

/// Runtime authentication configuration.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AuthConfig {
    /// Local username/password identity configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_identity: Option<LocalIdentityConfig>,
}

/// Local identity provider configuration.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LocalIdentityConfig {
    /// Enables local identity authentication.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Minimum local password length.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_min_length: Option<u16>,
}

/// OAuth configuration.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct OAuthConfig {
    /// Base URL for OAuth redirect callbacks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redirect_base: Option<String>,
    /// Forces display of the provider chooser when true.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub always_show_provider_chooser: Option<bool>,
    /// OAuth providers keyed by provider identifier.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub providers: std::collections::BTreeMap<String, OAuthProviderConfig>,
}

/// OAuth provider configuration.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct OAuthProviderConfig {
    /// Provider type, currently expected to be `oidc`.
    #[serde(rename = "type")]
    pub provider_type: String,
    /// OIDC issuer URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    /// OAuth client id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    /// Inline OAuth client secret.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    /// File-backed OAuth client secret path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_secret_file: Option<PathBuf>,
    /// Display name for UI surfaces.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Requested OAuth scopes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
}

/// Configuration for a built-in runtime subsystem.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SubsystemConfig {
    /// Storage configuration for the subsystem.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage: Option<StorageConfig>,
    /// Health history retention in days.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_retention_days: Option<u32>,
    /// Eventlog retention in days.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_days: Option<u32>,
    /// Platform TTL settings in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<PlatformTtlConfig>,
}

/// Platform TTL settings in milliseconds.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PlatformTtlConfig {
    /// Session TTL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<u64>,
    /// OAuth flow TTL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth: Option<u64>,
    /// Device flow TTL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_flow: Option<u64>,
    /// Pending auth TTL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_auth: Option<u64>,
    /// Connection tracking TTL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connections: Option<u64>,
    /// NATS JWT TTL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nats_jwt: Option<u64>,
}

/// Storage configuration for a built-in runtime subsystem.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StorageConfig {
    /// Storage backend kind. Only `sqlite` is implemented today.
    pub kind: String,
    /// SQLite database path. Required when `kind` is `sqlite`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    /// Postgres connection URL. Reserved for the future Postgres backend.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// SQLite journal mode, commonly `wal`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journal_mode: Option<String>,
    /// SQLite busy timeout in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub busy_timeout_ms: Option<u64>,
    /// Whether the runtime should treat this SQLite store as single-writer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub single_writer: Option<bool>,
}

impl StorageConfig {
    /// Resolves this raw storage config into the currently implemented backend.
    pub fn resolve_backend(&self, section: &'static str) -> Result<StorageBackend, ConfigError> {
        match self.kind.trim() {
            "sqlite" => {
                let path = self
                    .path
                    .as_ref()
                    .filter(|path| !path.as_os_str().is_empty())
                    .ok_or(ConfigError::InvalidStorage {
                        section,
                        reason: "sqlite storage requires path",
                    })?;
                if self.url.is_some() {
                    return Err(ConfigError::InvalidStorage {
                        section,
                        reason: "sqlite storage must not set url",
                    });
                }
                Ok(StorageBackend::Sqlite(SqliteStorageConfig {
                    path: path.clone(),
                    journal_mode: self.journal_mode.clone(),
                    busy_timeout_ms: self.busy_timeout_ms,
                    single_writer: self.single_writer,
                }))
            }
            "postgres" => Err(ConfigError::UnsupportedStorageBackend {
                section,
                backend: "postgres",
            }),
            "" => Err(ConfigError::InvalidStorage {
                section,
                reason: "kind must not be empty",
            }),
            _ => Err(ConfigError::InvalidStorage {
                section,
                reason: "kind must be sqlite",
            }),
        }
    }
}

/// Resolved storage backend for a subsystem.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageBackend {
    /// SQLite storage backend.
    Sqlite(SqliteStorageConfig),
}

/// Resolved SQLite storage configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteStorageConfig {
    /// SQLite database path.
    pub path: PathBuf,
    /// SQLite journal mode, commonly `wal`.
    pub journal_mode: Option<String>,
    /// SQLite busy timeout in milliseconds.
    pub busy_timeout_ms: Option<u64>,
    /// Whether the runtime should treat this SQLite store as single-writer.
    pub single_writer: Option<bool>,
}

/// Error returned while loading or validating runtime configuration.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// The config path does not use the TOML extension.
    #[error("runtime config must be a TOML file: {path}")]
    UnsupportedFormat {
        /// Path that used an unsupported extension.
        path: std::path::PathBuf,
    },
    /// The config file could not be read.
    #[error("failed to read runtime config {path}: {source}")]
    Read {
        /// Path that could not be read.
        path: std::path::PathBuf,
        /// Underlying filesystem error.
        #[source]
        source: std::io::Error,
    },
    /// The config file was not valid TOML for the runtime config schema.
    #[error("failed to parse runtime config TOML: {0}")]
    Parse(#[source] toml::de::Error),
    /// A required config section is missing for the selected runtime mode.
    #[error("missing required runtime config section [{section}]")]
    MissingSection {
        /// Missing section name.
        section: &'static str,
    },
    /// A subsystem storage section is present but invalid.
    #[error("invalid runtime config section [{section}]: {reason}")]
    InvalidStorage {
        /// Invalid section name.
        section: &'static str,
        /// Validation failure reason.
        reason: &'static str,
    },
    /// A known storage backend is planned but not implemented yet.
    #[error("storage backend '{backend}' is not supported yet for [{section}]")]
    UnsupportedStorageBackend {
        /// Storage section containing the unsupported backend.
        section: &'static str,
        /// Unsupported backend name.
        backend: &'static str,
    },
    /// Inline and file-backed secret fields were both provided.
    #[error("invalid runtime config section [{section}.{provider_id}]: {field} and {field}_file are mutually exclusive")]
    InvalidSecretConfig {
        /// Section containing the invalid secret configuration.
        section: &'static str,
        /// Provider id containing the invalid secret configuration.
        provider_id: String,
        /// Inline secret field that conflicts with the file-backed form.
        field: &'static str,
    },
    /// A required NATS path field is missing or empty.
    #[error("invalid runtime config section [{section}]: {field} {reason}")]
    InvalidNatsConfig {
        /// Invalid section name.
        section: &'static str,
        /// Invalid field name.
        field: &'static str,
        /// Validation failure reason.
        reason: &'static str,
    },
    /// A required lease field is missing or empty.
    #[error("invalid runtime config section [{section}]: {field} {reason}")]
    InvalidLeasesConfig {
        /// Invalid section name.
        section: &'static str,
        /// Invalid field name.
        field: &'static str,
        /// Validation failure reason.
        reason: &'static str,
    },
}

fn resolve_path(base_dir: &Path, path: &mut Option<PathBuf>) {
    let Some(value) = path else {
        return;
    };
    if value.is_relative() {
        *value = base_dir.join(&value);
    }
}

fn storage_section_name(subsystem: SubsystemName) -> &'static str {
    match subsystem {
        SubsystemName::Platform => "platform.storage",
        SubsystemName::Jobs => "jobs.storage",
        SubsystemName::Health => "health.storage",
        SubsystemName::Eventlog => "eventlog.storage",
    }
}

fn require_path(
    section: &'static str,
    field: &'static str,
    path: Option<&PathBuf>,
) -> Result<PathBuf, ConfigError> {
    path.filter(|path| !path.as_os_str().is_empty())
        .cloned()
        .ok_or(ConfigError::InvalidNatsConfig {
            section,
            field,
            reason: "must not be missing or empty",
        })
}

fn require_string(
    section: &'static str,
    field: &'static str,
    value: Option<&str>,
) -> Result<String, ConfigError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or(ConfigError::InvalidNatsConfig {
            section,
            field,
            reason: "must not be missing or empty",
        })
}

#[cfg(test)]
mod tests;
