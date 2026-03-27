//! Typed RPC descriptors for `trellis.jobs@v1`.

use serde::{Deserialize, Serialize};

use trellis_client::RpcDescriptor;
use trellis_server::RpcDescriptor as ServerRpcDescriptor;

/// Empty request or response payload used by zero-argument RPCs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Empty {}

/// Descriptor for `Jobs.Cancel`.
pub struct JobsCancelRpc;

impl RpcDescriptor for JobsCancelRpc {
    type Input = crate::types::JobsCancelRequest;
    type Output = crate::types::JobsCancelResponse;
    const KEY: &'static str = "Jobs.Cancel";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Cancel";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["jobs.admin"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for JobsCancelRpc {
    type Input = crate::types::JobsCancelRequest;
    type Output = crate::types::JobsCancelResponse;
    const KEY: &'static str = "Jobs.Cancel";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Cancel";
}

/// Descriptor for `Jobs.Get`.
pub struct JobsGetRpc;

impl RpcDescriptor for JobsGetRpc {
    type Input = crate::types::JobsGetRequest;
    type Output = crate::types::JobsGetResponse;
    const KEY: &'static str = "Jobs.Get";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["jobs.read"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for JobsGetRpc {
    type Input = crate::types::JobsGetRequest;
    type Output = crate::types::JobsGetResponse;
    const KEY: &'static str = "Jobs.Get";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Get";
}

/// Descriptor for `Jobs.Health`.
pub struct JobsHealthRpc;

impl RpcDescriptor for JobsHealthRpc {
    type Input = Empty;
    type Output = crate::types::JobsHealthResponse;
    const KEY: &'static str = "Jobs.Health";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Health";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

impl ServerRpcDescriptor for JobsHealthRpc {
    type Input = Empty;
    type Output = crate::types::JobsHealthResponse;
    const KEY: &'static str = "Jobs.Health";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Health";
}

/// Descriptor for `Jobs.List`.
pub struct JobsListRpc;

impl RpcDescriptor for JobsListRpc {
    type Input = crate::types::JobsListRequest;
    type Output = crate::types::JobsListResponse;
    const KEY: &'static str = "Jobs.List";
    const SUBJECT: &'static str = "rpc.v1.Jobs.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["jobs.read"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for JobsListRpc {
    type Input = crate::types::JobsListRequest;
    type Output = crate::types::JobsListResponse;
    const KEY: &'static str = "Jobs.List";
    const SUBJECT: &'static str = "rpc.v1.Jobs.List";
}

/// Descriptor for `Jobs.ListServices`.
pub struct JobsListServicesRpc;

impl RpcDescriptor for JobsListServicesRpc {
    type Input = Empty;
    type Output = crate::types::JobsListServicesResponse;
    const KEY: &'static str = "Jobs.ListServices";
    const SUBJECT: &'static str = "rpc.v1.Jobs.ListServices";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["jobs.read"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

impl ServerRpcDescriptor for JobsListServicesRpc {
    type Input = Empty;
    type Output = crate::types::JobsListServicesResponse;
    const KEY: &'static str = "Jobs.ListServices";
    const SUBJECT: &'static str = "rpc.v1.Jobs.ListServices";
}

/// Descriptor for `Jobs.Retry`.
pub struct JobsRetryRpc;

impl RpcDescriptor for JobsRetryRpc {
    type Input = crate::types::JobsRetryRequest;
    type Output = crate::types::JobsRetryResponse;
    const KEY: &'static str = "Jobs.Retry";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Retry";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["jobs.admin"];
    const ERRORS: &'static [&'static str] = &["ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for JobsRetryRpc {
    type Input = crate::types::JobsRetryRequest;
    type Output = crate::types::JobsRetryResponse;
    const KEY: &'static str = "Jobs.Retry";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Retry";
}

