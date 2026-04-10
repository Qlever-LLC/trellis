use std::io;

/// Errors returned by Trellis auth and admin-session helpers.
#[derive(Debug, thiserror::Error)]
pub enum TrellisAuthError {
    /// The supplied contract JSON could not be parsed.
    #[error("invalid contract json: {0}")]
    ContractJson(#[from] serde_json::Error),

    /// A configured auth or callback URL was invalid.
    #[error("invalid url: {0}")]
    Url(#[from] url::ParseError),

    /// The HTTP transport used for browser login or bind requests failed.
    #[error("http client error: {0}")]
    Http(#[from] reqwest::Error),

    /// Local filesystem persistence or callback listener I/O failed.
    #[error("io error: {0}")]
    Io(#[from] io::Error),

    /// The underlying Trellis RPC client returned an error.
    #[error("trellis client error: {0}")]
    TrellisClient(#[from] trellis_client::TrellisClientError),

    /// The browser login callback never arrived before the timeout.
    #[error("timed out waiting for browser login")]
    LoginTimedOut,

    /// The local browser login callback listener shut down before completion.
    #[error("browser login was interrupted")]
    LoginInterrupted,

    /// The local callback request was missing the expected query or fragment shape.
    #[error("invalid callback request")]
    InvalidCallbackRequest,

    /// The callback completed without returning an auth token.
    #[error("missing auth token in callback")]
    MissingAuthToken,

    /// The auth service returned a terminal flow error.
    #[error("auth flow failed: {0}")]
    AuthFlowFailed(String),

    /// The low-level bind endpoint returned a non-success HTTP response.
    #[error("bind failed: {0} {1}")]
    BindHttpFailure(u16, String),

    /// The bind endpoint returned a response shape this crate does not understand.
    #[error("unexpected bind status: {0}")]
    UnexpectedBindStatus(String),

    /// The caller supplied arguments that violate the Trellis auth invariants.
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    /// A helper wrapped operation finished without a usable successful result.
    #[error("operation failed: {0}")]
    OperationFailed(String),

    /// A workload activation wait request returned a non-success HTTP response.
    #[error("workload activation wait failed: {0} {1}")]
    WorkloadActivationWaitFailure(u16, String),

    /// Workload activation was explicitly rejected.
    #[error("workload activation rejected{0}")]
    WorkloadActivationRejected(String),

    /// The authenticated user completed login successfully but lacks admin capability.
    #[error("logged in user is not an admin")]
    NotAdmin,
}
