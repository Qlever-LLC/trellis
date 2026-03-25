//! Typed RPC descriptors for `trellis.core@v1`.

use serde::{Deserialize, Serialize};

use trellis_client::RpcDescriptor;
use trellis_server::RpcDescriptor as ServerRpcDescriptor;

/// Empty request or response payload used by zero-argument RPCs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Empty {}

/// Descriptor for `Trellis.Bindings.Get`.
pub struct TrellisBindingsGetRpc;

impl RpcDescriptor for TrellisBindingsGetRpc {
    type Input = crate::types::TrellisBindingsGetRequest;
    type Output = crate::types::TrellisBindingsGetResponse;
    const KEY: &'static str = "Trellis.Bindings.Get";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Bindings.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["service"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for TrellisBindingsGetRpc {
    type Input = crate::types::TrellisBindingsGetRequest;
    type Output = crate::types::TrellisBindingsGetResponse;
    const KEY: &'static str = "Trellis.Bindings.Get";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Bindings.Get";
}

/// Descriptor for `Trellis.Catalog`.
pub struct TrellisCatalogRpc;

impl RpcDescriptor for TrellisCatalogRpc {
    type Input = Empty;
    type Output = crate::types::TrellisCatalogResponse;
    const KEY: &'static str = "Trellis.Catalog";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Catalog";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.catalog.read"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for TrellisCatalogRpc {
    type Input = Empty;
    type Output = crate::types::TrellisCatalogResponse;
    const KEY: &'static str = "Trellis.Catalog";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Catalog";
}

/// Descriptor for `Trellis.Contract.Get`.
pub struct TrellisContractGetRpc;

impl RpcDescriptor for TrellisContractGetRpc {
    type Input = crate::types::TrellisContractGetRequest;
    type Output = crate::types::TrellisContractGetResponse;
    const KEY: &'static str = "Trellis.Contract.Get";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Contract.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.contract.read"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for TrellisContractGetRpc {
    type Input = crate::types::TrellisContractGetRequest;
    type Output = crate::types::TrellisContractGetResponse;
    const KEY: &'static str = "Trellis.Contract.Get";
    const SUBJECT: &'static str = "rpc.v1.Trellis.Contract.Get";
}
