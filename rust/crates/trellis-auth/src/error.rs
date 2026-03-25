use std::io;

/// Errors returned by Trellis auth and admin-session helpers.
#[derive(Debug, thiserror::Error)]
pub enum TrellisAuthError {
    #[error("invalid contract json: {0}")]
    ContractJson(#[from] serde_json::Error),

    #[error("invalid url: {0}")]
    Url(#[from] url::ParseError),

    #[error("http client error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("io error: {0}")]
    Io(#[from] io::Error),

    #[error("trellis client error: {0}")]
    TrellisClient(#[from] trellis_client::TrellisClientError),

    #[error("timed out waiting for browser login")]
    LoginTimedOut,

    #[error("browser login was interrupted")]
    LoginInterrupted,

    #[error("invalid callback request")]
    InvalidCallbackRequest,

    #[error("missing auth token in callback")]
    MissingAuthToken,

    #[error("auth flow failed: {0}")]
    AuthFlowFailed(String),

    #[error("bind failed: {0} {1}")]
    BindHttpFailure(u16, String),

    #[error("unexpected bind status: {0}")]
    UnexpectedBindStatus(String),

    #[error("logged in user is not an admin")]
    NotAdmin,
}
