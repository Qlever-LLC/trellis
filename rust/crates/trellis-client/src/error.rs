/// Errors returned by the Trellis client runtime.
#[derive(thiserror::Error, Debug)]
pub enum TrellisClientError {
    #[error("invalid base64url: {0}")]
    Base64(#[from] base64::DecodeError),

    #[error("invalid ed25519 seed length: {0} (expected 32)")]
    InvalidSeedLen(usize),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("nats error: {0}")]
    Nats(#[from] async_nats::Error),

    #[error("nats connect error: {0}")]
    NatsConnect(String),

    #[error("nats request error: {0}")]
    NatsRequest(String),

    #[error("request timeout")]
    Timeout,

    #[error("invalid json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("rpc returned error: {0}")]
    RpcError(String),
}
