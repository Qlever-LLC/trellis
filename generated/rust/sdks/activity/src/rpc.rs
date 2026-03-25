//! Typed RPC descriptors for `trellis.activity@v1`.

use serde::{Deserialize, Serialize};

use trellis_client::RpcDescriptor;
use trellis_server::RpcDescriptor as ServerRpcDescriptor;

/// Empty request or response payload used by zero-argument RPCs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Empty {}

/// Descriptor for `Activity.Get`.
pub struct ActivityGetRpc;

impl RpcDescriptor for ActivityGetRpc {
    type Input = crate::types::ActivityGetRequest;
    type Output = crate::types::ActivityGetResponse;
    const KEY: &'static str = "Activity.Get";
    const SUBJECT: &'static str = "rpc.v1.Activity.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for ActivityGetRpc {
    type Input = crate::types::ActivityGetRequest;
    type Output = crate::types::ActivityGetResponse;
    const KEY: &'static str = "Activity.Get";
    const SUBJECT: &'static str = "rpc.v1.Activity.Get";
}

/// Descriptor for `Activity.Health`.
pub struct ActivityHealthRpc;

impl RpcDescriptor for ActivityHealthRpc {
    type Input = Empty;
    type Output = crate::types::ActivityHealthResponse;
    const KEY: &'static str = "Activity.Health";
    const SUBJECT: &'static str = "rpc.v1.Activity.Health";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

impl ServerRpcDescriptor for ActivityHealthRpc {
    type Input = Empty;
    type Output = crate::types::ActivityHealthResponse;
    const KEY: &'static str = "Activity.Health";
    const SUBJECT: &'static str = "rpc.v1.Activity.Health";
}

/// Descriptor for `Activity.List`.
pub struct ActivityListRpc;

impl RpcDescriptor for ActivityListRpc {
    type Input = crate::types::ActivityListRequest;
    type Output = crate::types::ActivityListResponse;
    const KEY: &'static str = "Activity.List";
    const SUBJECT: &'static str = "rpc.v1.Activity.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for ActivityListRpc {
    type Input = crate::types::ActivityListRequest;
    type Output = crate::types::ActivityListResponse;
    const KEY: &'static str = "Activity.List";
    const SUBJECT: &'static str = "rpc.v1.Activity.List";
}

