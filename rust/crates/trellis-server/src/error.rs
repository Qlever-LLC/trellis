/// Errors returned by the Trellis server runtime.
#[derive(thiserror::Error, Debug)]
pub enum ServerError {
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("nats error: {0}")]
    Nats(String),

    #[error("missing handler for subject '{0}'")]
    MissingHandler(String),
}

/// Result alias used by descriptor-backed RPC handlers.
pub type HandlerResult<T> = Result<T, ServerError>;
