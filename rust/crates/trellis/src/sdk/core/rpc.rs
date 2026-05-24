//! Typed RPC descriptors for `trellis.core@v1`.
use crate::client::RpcDescriptor;
use serde::{Deserialize, Serialize};
/// Empty request or response payload used by zero-argument RPCs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Empty {}
/// Descriptor for `Trellis.Bindings.Get`.
pub struct TrellisBindingsGetRpc;
impl RpcDescriptor for TrellisBindingsGetRpc {
    type Input = super::types::TrellisBindingsGetRequest;
    type Output = super::types::TrellisBindingsGetResponse;
    const KEY: &'static str = "Trellis.Bindings.Get";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Bindings.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["service"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError", "ValidationError"];
}
/// Descriptor for `Trellis.Catalog`.
pub struct TrellisCatalogRpc;
impl RpcDescriptor for TrellisCatalogRpc {
    type Input = Empty;
    type Output = super::types::TrellisCatalogResponse;
    const KEY: &'static str = "Trellis.Catalog";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Catalog";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.core::catalog.read"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError", "ValidationError"];
}
/// Descriptor for `Trellis.Contract.Get`.
pub struct TrellisContractGetRpc;
impl RpcDescriptor for TrellisContractGetRpc {
    type Input = super::types::TrellisContractGetRequest;
    type Output = super::types::TrellisContractGetResponse;
    const KEY: &'static str = "Trellis.Contract.Get";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Contract.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.core::contract.read"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError", "ValidationError"];
}
/// Descriptor for `Trellis.Surface.Status`.
pub struct TrellisSurfaceStatusRpc;
impl RpcDescriptor for TrellisSurfaceStatusRpc {
    type Input = super::types::TrellisSurfaceStatusRequest;
    type Output = super::types::TrellisSurfaceStatusResponse;
    const KEY: &'static str = "Trellis.Surface.Status";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Surface.Status";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.core::catalog.read"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError", "ValidationError"];
}
