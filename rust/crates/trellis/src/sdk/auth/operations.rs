//! Typed operation descriptors for `trellis.auth@v1`.
use crate::client::OperationDescriptor;
/// Descriptor for `Auth.DeviceUserAuthorities.Resolve`.
pub struct AuthDeviceUserAuthoritiesResolveOperation;
impl OperationDescriptor for AuthDeviceUserAuthoritiesResolveOperation {
    type Input = super::types::AuthDeviceUserAuthoritiesResolveInput;
    type Progress = super::types::AuthDeviceUserAuthoritiesResolveProgress;
    type Output = super::types::AuthDeviceUserAuthoritiesResolveOutput;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Resolve";
    const SUBJECT: &'static str = "operations.v1.Auth.DeviceUserAuthorities.Resolve";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CONTROL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
}
