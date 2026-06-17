//! Typed RPC descriptors for `trellis.jobs@v1`.
use crate::client::RpcDescriptor;
use serde::{Deserialize, Serialize};
/// Empty request or response payload used by zero-argument RPCs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Empty {}
/// Descriptor for `Jobs.Cancel`.
pub struct JobsCancelRpc;
impl RpcDescriptor for JobsCancelRpc {
    type Input = super::types::JobsCancelRequest;
    type Output = super::types::JobsCancelResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_CANCEL_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_CANCEL_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.Cancel";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Cancel";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.mutate"];
    const ERRORS: &'static [&'static str] =
        &["UnexpectedError", "ValidationError", "NotFoundError"];
}
/// Descriptor for `Jobs.DismissDLQ`.
pub struct JobsDismissDLQRpc;
impl RpcDescriptor for JobsDismissDLQRpc {
    type Input = super::types::JobsDismissDLQRequest;
    type Output = super::types::JobsDismissDLQResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_DISMISS_DLQ_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_DISMISS_DLQ_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.DismissDLQ";
    const SUBJECT: &'static str = "rpc.v1.Jobs.DismissDLQ";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.mutate"];
    const ERRORS: &'static [&'static str] =
        &["UnexpectedError", "ValidationError", "NotFoundError"];
}
/// Descriptor for `Jobs.Get`.
pub struct JobsGetRpc;
impl RpcDescriptor for JobsGetRpc {
    type Input = super::types::JobsGetRequest;
    type Output = super::types::JobsGetResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_GET_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_GET_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.Get";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.read"];
    const ERRORS: &'static [&'static str] =
        &["UnexpectedError", "ValidationError", "NotFoundError"];
}
/// Descriptor for `Jobs.GetKey`.
pub struct JobsGetKeyRpc;
impl RpcDescriptor for JobsGetKeyRpc {
    type Input = super::types::JobsGetKeyRequest;
    type Output = super::types::JobsGetKeyResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_GET_KEY_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_GET_KEY_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.GetKey";
    const SUBJECT: &'static str = "rpc.v1.Jobs.GetKey";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.read"];
    const ERRORS: &'static [&'static str] =
        &["UnexpectedError", "ValidationError", "NotFoundError"];
}
/// Descriptor for `Jobs.Health`.
pub struct JobsHealthRpc;
impl RpcDescriptor for JobsHealthRpc {
    type Input = Empty;
    type Output = super::types::JobsHealthResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_HEALTH_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_HEALTH_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.Health";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Health";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.read"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}
/// Descriptor for `Jobs.List`.
pub struct JobsListRpc;
impl RpcDescriptor for JobsListRpc {
    type Input = super::types::JobsListRequest;
    type Output = super::types::JobsListResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.List";
    const SUBJECT: &'static str = "rpc.v1.Jobs.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.read"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError", "ValidationError"];
}
/// Descriptor for `Jobs.ListDLQ`.
pub struct JobsListDLQRpc;
impl RpcDescriptor for JobsListDLQRpc {
    type Input = super::types::JobsListDLQRequest;
    type Output = super::types::JobsListDLQResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_LIST_DLQ_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_LIST_DLQ_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.ListDLQ";
    const SUBJECT: &'static str = "rpc.v1.Jobs.ListDLQ";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.read"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError", "ValidationError"];
}
/// Descriptor for `Jobs.ListServices`.
pub struct JobsListServicesRpc;
impl RpcDescriptor for JobsListServicesRpc {
    type Input = super::types::JobsListServicesRequest;
    type Output = super::types::JobsListServicesResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_LIST_SERVICES_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_LIST_SERVICES_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.ListServices";
    const SUBJECT: &'static str = "rpc.v1.Jobs.ListServices";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.read"];
    const ERRORS: &'static [&'static str] = &["UnexpectedError", "ValidationError"];
}
/// Descriptor for `Jobs.ReplayDLQ`.
pub struct JobsReplayDLQRpc;
impl RpcDescriptor for JobsReplayDLQRpc {
    type Input = super::types::JobsReplayDLQRequest;
    type Output = super::types::JobsReplayDLQResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_REPLAY_DLQ_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_REPLAY_DLQ_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.ReplayDLQ";
    const SUBJECT: &'static str = "rpc.v1.Jobs.ReplayDLQ";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.mutate"];
    const ERRORS: &'static [&'static str] =
        &["UnexpectedError", "ValidationError", "NotFoundError"];
}
/// Descriptor for `Jobs.Retry`.
pub struct JobsRetryRpc;
impl RpcDescriptor for JobsRetryRpc {
    type Input = super::types::JobsRetryRequest;
    type Output = super::types::JobsRetryResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_RETRY_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::JOBS_RETRY_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Jobs.Retry";
    const SUBJECT: &'static str = "rpc.v1.Jobs.Retry";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.jobs::admin.mutate"];
    const ERRORS: &'static [&'static str] =
        &["UnexpectedError", "ValidationError", "NotFoundError"];
}
