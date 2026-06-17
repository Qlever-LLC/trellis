//! Typed operation descriptors for `trellis.auth@v1`.
use crate::client::OperationDescriptor;
use trellis_rs::service::OperationFailureLike;
/// Descriptor for `Auth.DeviceUserAuthorities.Resolve`.
pub struct AuthDeviceUserAuthoritiesResolveOperation;
impl OperationDescriptor for AuthDeviceUserAuthoritiesResolveOperation {
    type Input = super::types::AuthDeviceUserAuthoritiesResolveInput;
    type Progress = super::types::AuthDeviceUserAuthoritiesResolveProgress;
    type Output = super::types::AuthDeviceUserAuthoritiesResolveOutput;
    type Error = AuthDeviceUserAuthoritiesResolveOperationError;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVE_INPUT_SCHEMA_JSON;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> =
        Some(super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVE_PROGRESS_SCHEMA_JSON);
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVE_OUTPUT_SCHEMA_JSON;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVE_SIGNAL_INPUT_SCHEMAS_JSON;
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Resolve";
    const SUBJECT: &'static str = "operations.v1.Auth.DeviceUserAuthorities.Resolve";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}
/// Errors declared by `Auth.DeviceUserAuthorities.Resolve`.
#[derive(Debug, Clone)]
pub enum AuthDeviceUserAuthoritiesResolveOperationError {
    /// `AuthError` failure.
    AuthError {
        /// Human-facing error message.
        pub message: String,
    },
    /// `UnexpectedError` failure.
    UnexpectedError {
        /// Human-facing error message.
        pub message: String,
    },
    /// `ValidationError` failure.
    ValidationError {
        /// Human-facing error message.
        pub message: String,
    },
    /// Catch-all for unexpected operation failures.
    Other { message: String },
}
impl trellis_rs::service::OperationFailureLike for AuthDeviceUserAuthoritiesResolveOperationError {
    fn error_type(&self) -> &str {
        match self {
            Self::AuthError { .. } => "AuthError",
            Self::UnexpectedError { .. } => "UnexpectedError",
            Self::ValidationError { .. } => "ValidationError",
            Self::Other { .. } => "UnexpectedError",
        }
    }
    fn message(&self) -> String {
        match self {
            _ => String::new(),
        }
    }
    fn fields(&self) -> serde_json::Map<String, serde_json::Value> {
        serde_json::Map::new()
    }
}
