#![cfg(all(feature = "sqlite-storage", feature = "nats-leases"))]

use std::path::PathBuf;

use thiserror::Error;
use tokio::task::JoinHandle;

use crate::shutdown::StopHandle;
use crate::storage::{RuntimeStores, StoreError};
use crate::{
    eventlog, health, jobs, platform, RuntimeConfig, RuntimeMode, ServerError, SubsystemName,
};

/// Runtime startup options for `trellis-server`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeOptions {
    /// Runtime mode selected by the command line.
    pub mode: RuntimeMode,
    /// Path to the TOML runtime config file.
    pub config_path: PathBuf,
}

/// Error returned while starting or running the Trellis runtime.
#[derive(Debug, Error)]
pub enum RuntimeError {
    /// Runtime configuration could not be loaded or validated.
    #[error(transparent)]
    Config(#[from] crate::ConfigError),
    /// Runtime HTTP server failed.
    #[error(transparent)]
    Server(#[from] ServerError),
    /// Runtime storage failed.
    #[error(transparent)]
    Store(#[from] StoreError),
    /// A subsystem scaffold failed to start.
    #[error("failed to start runtime subsystem {subsystem}: {reason}")]
    Subsystem {
        /// Subsystem that failed to start.
        subsystem: SubsystemName,
        /// Failure reason.
        reason: &'static str,
    },
    /// A subsystem task failed after startup.
    #[error("runtime subsystem {subsystem} task failed: {source}")]
    SubsystemTask {
        /// Subsystem whose task failed.
        subsystem: SubsystemName,
        /// Tokio task join failure.
        #[source]
        source: tokio::task::JoinError,
    },
}

/// Shared runtime context passed to subsystem startup scaffolds.
#[derive(Debug)]
pub(crate) struct RuntimeContext {
    /// Loaded and validated runtime configuration.
    pub(crate) config: RuntimeConfig,
    /// Runtime mode selected for this process.
    pub(crate) mode: RuntimeMode,
    /// SQLite stores opened for the selected subsystems.
    #[expect(
        dead_code,
        reason = "subsystem scaffolds will consume migrated stores in follow-up runtime slices"
    )]
    pub(crate) stores: RuntimeStores,
}

/// Handle for a started subsystem scaffold.
#[derive(Debug)]
pub(crate) struct SubsystemHandle {
    /// Started subsystem name.
    pub(crate) name: SubsystemName,
    /// Cooperative stop request handle for the subsystem task.
    pub(crate) stop: StopHandle,
    /// Join handle for the subsystem task.
    pub(crate) join: JoinHandle<Result<(), RuntimeError>>,
}

/// Loads configuration, validates selected subsystem storage, and runs the runtime.
pub async fn run(options: RuntimeOptions) -> Result<(), RuntimeError> {
    let config = RuntimeConfig::load_from_path(&options.config_path)?;
    config.validate_for_mode(options.mode)?;
    let stores = RuntimeStores::from_config(&config, options.mode)?;
    stores.migrate_all()?;

    let context = RuntimeContext {
        config,
        mode: options.mode,
        stores,
    };
    let handles = start_subsystems(&context)?;

    let server_result = crate::run_http_server(
        &context.config,
        context.mode,
        crate::shutdown::shutdown_signal(),
    )
    .await;

    stop_subsystems(handles).await?;
    server_result?;

    Ok(())
}

async fn stop_subsystems(handles: Vec<SubsystemHandle>) -> Result<(), RuntimeError> {
    for handle in &handles {
        handle.stop.stop();
    }

    for handle in handles {
        let subsystem = handle.name;
        handle
            .join
            .await
            .map_err(|source| RuntimeError::SubsystemTask { subsystem, source })??;
    }

    Ok(())
}

fn start_subsystems(context: &RuntimeContext) -> Result<Vec<SubsystemHandle>, RuntimeError> {
    let mut handles = Vec::new();
    for subsystem in context.mode.subsystems() {
        let handle = match subsystem {
            SubsystemName::Platform => platform::start(context)?,
            SubsystemName::Jobs => jobs::start(context)?,
            SubsystemName::Health => health::start(context)?,
            SubsystemName::Eventlog => eventlog::start(context)?,
        };
        handles.push(handle);
    }
    Ok(handles)
}
