//! Runtime SQLite storage for built-in subsystems.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::Connection;
use thiserror::Error;

use crate::{SqliteStorageConfig, SubsystemName};

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
use crate::{RuntimeConfig, RuntimeMode, StorageBackend};

/// Runtime storage error.
#[derive(Debug, Error)]
pub enum StoreError {
    /// SQLite parent directory creation failed.
    #[error("failed to create sqlite parent directory {path}: {source}")]
    CreateDirectory {
        /// Directory path that could not be created.
        path: PathBuf,
        /// Underlying filesystem error.
        #[source]
        source: std::io::Error,
    },
    /// SQLite connection opening failed.
    #[error("failed to open sqlite store {path}: {source}")]
    OpenSqlite {
        /// SQLite database path.
        path: PathBuf,
        /// Underlying SQLite error.
        #[source]
        source: rusqlite::Error,
    },
    /// SQLite PRAGMA application failed.
    #[error("failed to configure sqlite store {path}: {source}")]
    ConfigureSqlite {
        /// SQLite database path.
        path: PathBuf,
        /// Underlying SQLite error.
        #[source]
        source: rusqlite::Error,
    },
    /// SQLite migration failed.
    #[error("failed to migrate sqlite store {path} for {subsystem}: {source}")]
    MigrateSqlite {
        /// SQLite database path.
        path: PathBuf,
        /// Subsystem whose skeleton migration failed.
        subsystem: &'static str,
        /// Underlying refinery migration error.
        #[source]
        source: refinery::Error,
    },
}

mod sqlite_migrations {
    pub mod platform {
        use refinery::embed_migrations;
        embed_migrations!("src/storage/sqlite/platform");
    }
    pub mod jobs {
        use refinery::embed_migrations;
        embed_migrations!("src/storage/sqlite/jobs");
    }
    pub mod health {
        use refinery::embed_migrations;
        embed_migrations!("src/storage/sqlite/health");
    }
    pub mod eventlog {
        use refinery::embed_migrations;
        embed_migrations!("src/storage/sqlite/eventlog");
    }
}

/// SQLite-backed store for a built-in runtime subsystem.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteStore {
    subsystem: SubsystemName,
    config: SqliteStorageConfig,
}

impl SqliteStore {
    /// Creates a config-only SQLite store for the given subsystem.
    #[must_use]
    pub fn new(subsystem: SubsystemName, config: impl Into<SqliteStorageConfig>) -> Self {
        Self {
            subsystem,
            config: config.into(),
        }
    }

    /// Runs schema migrations for this subsystem.
    pub fn migrate(&self) -> Result<(), StoreError> {
        migrate_sqlite(self.subsystem, &self.config)
    }
}

/// Subsystem-scoped collection of open runtime stores.
#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
#[derive(Debug)]
pub(crate) struct RuntimeStores {
    platform: Option<SqliteStore>,
    jobs: Option<SqliteStore>,
    health: Option<SqliteStore>,
    eventlog: Option<SqliteStore>,
}

#[cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]
impl RuntimeStores {
    pub(crate) fn from_config(
        config: &RuntimeConfig,
        mode: RuntimeMode,
    ) -> Result<Self, crate::ConfigError> {
        let mut stores = Self {
            platform: None,
            jobs: None,
            health: None,
            eventlog: None,
        };

        for subsystem in mode.subsystems() {
            match subsystem {
                SubsystemName::Platform => {
                    let StorageBackend::Sqlite(config) = config.platform_storage_backend()?;
                    stores.platform = Some(SqliteStore::new(SubsystemName::Platform, config));
                }
                SubsystemName::Jobs => {
                    let StorageBackend::Sqlite(config) = config.jobs_storage_backend()?;
                    stores.jobs = Some(SqliteStore::new(SubsystemName::Jobs, config));
                }
                SubsystemName::Health => {
                    let StorageBackend::Sqlite(config) = config.health_storage_backend()?;
                    stores.health = Some(SqliteStore::new(SubsystemName::Health, config));
                }
                SubsystemName::Eventlog => {
                    let StorageBackend::Sqlite(config) = config.eventlog_storage_backend()?;
                    stores.eventlog = Some(SqliteStore::new(SubsystemName::Eventlog, config));
                }
            }
        }

        Ok(stores)
    }

    /// Migrates the selected subsystem stores.
    pub(crate) fn migrate_all(&self) -> Result<(), StoreError> {
        if let Some(store) = &self.platform {
            store.migrate()?;
        }
        if let Some(store) = &self.jobs {
            store.migrate()?;
        }
        if let Some(store) = &self.health {
            store.migrate()?;
        }
        if let Some(store) = &self.eventlog {
            store.migrate()?;
        }
        Ok(())
    }
}

fn migrate_sqlite(
    subsystem: SubsystemName,
    config: &SqliteStorageConfig,
) -> Result<(), StoreError> {
    let runner = match subsystem {
        SubsystemName::Platform => sqlite_migrations::platform::migrations::runner(),
        SubsystemName::Jobs => sqlite_migrations::jobs::migrations::runner(),
        SubsystemName::Health => sqlite_migrations::health::migrations::runner(),
        SubsystemName::Eventlog => sqlite_migrations::eventlog::migrations::runner(),
    };
    let mut connection = open_sqlite(config)?;
    // Subsystem runners intentionally see only their own migration directory.
    // Keep divergent-version checks, but do not treat other subsystem versions
    // in the shared refinery history table as missing local files.
    runner
        .set_abort_missing(false)
        .run(&mut connection)
        .map_err(|source| StoreError::MigrateSqlite {
            path: config.path.clone(),
            subsystem: subsystem.as_str(),
            source,
        })?;
    Ok(())
}

fn open_sqlite(config: &SqliteStorageConfig) -> Result<Connection, StoreError> {
    create_parent_dir(&config.path)?;
    let connection = Connection::open(&config.path).map_err(|source| StoreError::OpenSqlite {
        path: config.path.clone(),
        source,
    })?;
    apply_sqlite_pragmas(&connection, config)?;
    Ok(connection)
}

fn create_parent_dir(path: &Path) -> Result<(), StoreError> {
    let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    else {
        return Ok(());
    };
    fs::create_dir_all(parent).map_err(|source| StoreError::CreateDirectory {
        path: parent.to_path_buf(),
        source,
    })
}

fn apply_sqlite_pragmas(
    connection: &Connection,
    config: &SqliteStorageConfig,
) -> Result<(), StoreError> {
    if let Some(timeout_ms) = config.busy_timeout_ms {
        connection
            .busy_timeout(Duration::from_millis(timeout_ms))
            .map_err(|source| StoreError::ConfigureSqlite {
                path: config.path.clone(),
                source,
            })?;
    }
    if let Some(journal_mode) = &config.journal_mode {
        connection
            .pragma_update(None, "journal_mode", journal_mode)
            .map_err(|source| StoreError::ConfigureSqlite {
                path: config.path.clone(),
                source,
            })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
