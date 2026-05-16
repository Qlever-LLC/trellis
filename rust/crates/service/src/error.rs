use serde_json::{Map, Value};

/// Structured RPC error declared by a service contract.
#[derive(Debug, Clone, PartialEq)]
pub struct DeclaredRpcError {
    error_type: String,
    message: String,
    fields: Map<String, Value>,
}

impl DeclaredRpcError {
    /// Build a contract-declared RPC error payload.
    pub fn new<K>(
        error_type: impl Into<String>,
        message: impl Into<String>,
        fields: impl IntoIterator<Item = (K, Value)>,
    ) -> Self
    where
        K: Into<String>,
    {
        Self {
            error_type: error_type.into(),
            message: message.into(),
            fields: fields
                .into_iter()
                .map(|(key, value)| (key.into(), value))
                .collect(),
        }
    }

    /// Return the declared RPC error type discriminator.
    pub fn error_type(&self) -> &str {
        &self.error_type
    }

    /// Return the human-facing declared RPC error message.
    pub fn message(&self) -> &str {
        &self.message
    }

    pub(crate) fn to_payload(&self, id: String) -> Value {
        let mut payload = self.fields.clone();
        payload.insert("id".to_string(), Value::String(id));
        payload.insert("type".to_string(), Value::String(self.error_type.clone()));
        payload.insert("message".to_string(), Value::String(self.message.clone()));
        Value::Object(payload)
    }
}

/// Errors returned by the Trellis server runtime.
#[derive(thiserror::Error, Debug)]
pub enum ServerError {
    #[error("declared RPC error {0:?}")]
    DeclaredRpc(DeclaredRpcError),

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

    #[error(
        "reply inbox '{reply_to}' is not valid for session '{session_key}' on subject '{subject}'"
    )]
    ReplyInboxMismatch {
        subject: String,
        session_key: String,
        reply_to: String,
    },

    #[error(
        "transfer request for subject '{subject}' used a session that does not match the grant"
    )]
    TransferSessionMismatch {
        subject: String,
        actual_session_key: String,
    },

    #[error("invalid operation control action '{action}' for subject '{subject}'")]
    InvalidOperationControlAction { subject: String, action: String },

    #[error("operation '{operation_id}' was not found")]
    OperationNotFound { operation_id: String },

    #[error("operation '{operation_id}' already exists")]
    OperationAlreadyExists { operation_id: String },

    #[error("invalid operation id '{operation_id}'")]
    OperationInvalidId { operation_id: String },

    #[error(
        "operation '{operation_id}' belongs to service '{actual_service}' operation '{actual_operation}', expected service '{expected_service}' operation '{expected_operation}'"
    )]
    OperationMismatch {
        operation_id: String,
        expected_service: String,
        expected_operation: String,
        actual_service: String,
        actual_operation: String,
    },

    #[error("operation '{operation_id}' is already terminal in state '{state}'")]
    OperationTerminal { operation_id: String, state: String },

    #[error("operation '{operation}' does not support '{action}'")]
    OperationUnsupportedControl { operation: String, action: String },

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

    #[error(
        "service '{service_name}' is missing {resource_kind} resource binding '{resource_name}'"
    )]
    MissingResourceBinding {
        service_name: String,
        resource_kind: String,
        resource_name: String,
    },

    #[error(
        "service '{service_name}' has invalid {resource_kind} resource binding '{resource_name}': {reason}"
    )]
    InvalidResourceBinding {
        service_name: String,
        resource_kind: String,
        resource_name: String,
        reason: String,
    },

    #[error(
        "service '{service_name}' transfer object '{key}' in store '{store}' is {size} bytes, exceeding max object size {max_bytes}"
    )]
    TransferObjectTooLarge {
        service_name: String,
        store: String,
        key: String,
        size: u64,
        max_bytes: u64,
    },

    #[error("invalid transfer id '{value}': expected a single safe NATS subject token")]
    InvalidTransferId { value: String },

    #[error("transfer '{transfer_id}' expected chunk sequence {expected_seq}, got {actual_seq}")]
    TransferSequenceOutOfOrder {
        transfer_id: String,
        expected_seq: u64,
        actual_seq: u64,
    },

    #[error("transfer '{transfer_id}' has not received an EOF frame")]
    TransferMissingEof { transfer_id: String },

    #[error("transfer '{transfer_id}' is already complete")]
    TransferAlreadyComplete { transfer_id: String },

    #[error("transfer '{transfer_id}' expired at '{expires_at}'")]
    TransferExpired {
        transfer_id: String,
        expires_at: String,
    },

    #[error("invalid transfer expiration '{expires_at}': {details}")]
    InvalidTransferExpiry { expires_at: String, details: String },

    #[error("transfer object '{key}' is missing from store '{store}'")]
    TransferObjectMissing { store: String, key: String },

    #[error("transfer chunk size must be greater than zero, got {chunk_bytes}")]
    InvalidTransferChunkSize { chunk_bytes: u64 },

    #[error("transfer request is missing required header '{header}'")]
    MissingTransferHeader { header: &'static str },

    #[error("transfer request has invalid header '{header}': '{value}'")]
    InvalidTransferHeader { header: &'static str, value: String },

    #[error(
        "transfer object '{key}' in store '{store}' is {actual_size} bytes, but grant expected {expected_size} bytes"
    )]
    TransferObjectSizeMismatch {
        store: String,
        key: String,
        expected_size: u64,
        actual_size: u64,
    },
}

/// Result alias used by descriptor-backed RPC handlers.
pub type HandlerResult<T> = Result<T, ServerError>;
