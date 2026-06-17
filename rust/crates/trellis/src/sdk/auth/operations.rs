//! Typed operation descriptors for `trellis.auth@v1`.
use crate::client::OperationDescriptor;
/// Descriptor for `Auth.DeviceUserAuthorities.Resolve`.
pub struct AuthDeviceUserAuthoritiesResolveOperation;
impl OperationDescriptor for AuthDeviceUserAuthoritiesResolveOperation {
    type Input = super::types::AuthDeviceUserAuthoritiesResolveInput;
    type Progress = super::types::AuthDeviceUserAuthoritiesResolveProgress;
    type Output = super::types::AuthDeviceUserAuthoritiesResolveOutput;
    type Error = trellis_rs::service::OperationFailure;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVE_INPUT_SCHEMA_JSON;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> =
        Some(super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVE_PROGRESS_SCHEMA_JSON);
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVE_OUTPUT_SCHEMA_JSON;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVE_SIGNAL_INPUT_SCHEMAS_JSON;
    const ERRORS: &'static [&'static str] = &[];
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Resolve";
    const SUBJECT: &'static str = "operations.v1.Auth.DeviceUserAuthorities.Resolve";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}
