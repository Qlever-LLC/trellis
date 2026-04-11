/// Errors returned by the Trellis server runtime.
#[derive(thiserror::Error, Debug)]
pub enum ServerError {
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("nats error: {0}")]
    Nats(String),

    #[error("missing handler for subject '{0}'")]
    MissingHandler(String),

    #[error("missing session key for authenticated subject '{subject}'")]
    MissingSessionKey { subject: String },

    #[error("missing proof for authenticated subject '{subject}'")]
    MissingProof { subject: String },

    #[error("request denied for subject '{subject}' and session '{session_key}'")]
    RequestDenied {
        subject: String,
        session_key: String,
    },

    #[error("invalid operation control action '{action}' for subject '{subject}'")]
    InvalidOperationControlAction { subject: String, action: String },

    #[error(
        "service '{service_name}' expected active contract '{contract_id}' ({contract_digest})"
    )]
    BootstrapInactiveContract {
        service_name: String,
        contract_id: String,
        contract_digest: String,
    },

    #[error(
        "service '{service_name}' has no binding for contract '{contract_id}' ({contract_digest})"
    )]
    BootstrapMissingBinding {
        service_name: String,
        contract_id: String,
        contract_digest: String,
    },

    #[error(
        "service '{service_name}' binding mismatch: expected '{expected_contract_id}' ({expected_contract_digest}), got '{actual_contract_id}' ({actual_contract_digest})"
    )]
    BootstrapBindingMismatch {
        service_name: String,
        expected_contract_id: String,
        expected_contract_digest: String,
        actual_contract_id: String,
        actual_contract_digest: String,
    },

    #[error(
        "service '{service_name}' has no auth-installed contract '{contract_id}' ({contract_digest})"
    )]
    BootstrapAuthContractMissing {
        service_name: String,
        contract_id: String,
        contract_digest: String,
    },

    #[error(
        "service '{service_name}' auth contract mismatch: expected '{expected_contract_id}' ({expected_contract_digest}), got '{actual_contract_id}' ({actual_contract_digest})"
    )]
    BootstrapAuthContractMismatch {
        service_name: String,
        expected_contract_id: String,
        expected_contract_digest: String,
        actual_contract_id: String,
        actual_contract_digest: String,
    },
}

/// Result alias used by descriptor-backed RPC handlers.
pub type HandlerResult<T> = Result<T, ServerError>;
