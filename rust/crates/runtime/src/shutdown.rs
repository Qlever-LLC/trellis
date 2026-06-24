use std::future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Cooperative stop handle shared with runtime subsystem tasks.
#[derive(Clone, Debug, Default)]
pub struct StopHandle {
    /// Shared stopped flag.
    stopped: Arc<AtomicBool>,
}

impl StopHandle {
    /// Creates a new unset stop handle.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Requests cooperative shutdown.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
    }

    /// Returns whether cooperative shutdown has been requested.
    #[must_use]
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }
}

/// Waits for the host process shutdown signal.
pub async fn shutdown_signal() {
    #[cfg(unix)]
    {
        /// Waits for SIGTERM on Unix hosts.
        async fn terminate_signal() {
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(mut signal) => {
                    signal.recv().await;
                }
                Err(_) => future::pending::<()>().await,
            }
        }

        tokio::select! {
            result = tokio::signal::ctrl_c() => {
                let _ = result;
            }
            () = terminate_signal() => {}
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
