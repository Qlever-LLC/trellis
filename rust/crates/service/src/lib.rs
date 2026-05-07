//! Low-level inbound Trellis runtime primitives for generated Rust code.

mod bindings;
mod bootstrap_ports;
mod connected;
mod descriptor;
mod error;
mod health;
mod operations;
mod publisher;
mod request_loop;
mod resources;
mod router;
mod runtime;
mod service;
mod service_host;
mod transfer;

pub use bindings::{
    validate_bootstrap_contract_state, BootstrapBinding, BootstrapContractRef,
    JobsQueueResourceBinding, JobsResourceBinding, JobsSchemaRef, KvResourceBinding,
    ServiceResourceBindings, StoreResourceBinding,
};
pub use bootstrap_ports::{resolve_bootstrap_binding, BootstrapBindingInfo, CoreBootstrapPort};
pub use connected::{
    connect_service, connect_service_with_options, AsyncConnector,
    AuthenticatedServiceConnectOptions, ConnectServiceError, ConnectedService,
    ConnectedServiceHostWithValidator, ConnectedServiceParts, SingleSubjectServiceRunner,
};
pub use descriptor::{EventDescriptor, FeedDescriptor, RpcDescriptor};
pub use error::{HandlerResult, ServerError};
pub use health::{HealthCheck, HealthReport};
pub use operations::{
    control_subject, AcceptedOperation, InMemoryOperationRuntime, OperationControl,
    OperationControlRequest, OperationDescriptor, OperationError, OperationFailure,
    OperationProvider, OperationRefData, OperationSnapshot, OperationSnapshotFrame, OperationState,
    OperationTransferProgress, ServiceOperation,
};
pub use publisher::EventPublisher;
pub use request_loop::{
    decode_nats_request, dispatch_one, encode_error_reply, encode_success_reply,
    run_nats_request_loop, HandlerResponse, InboundRequest, OutboundReply, RequestHandler,
    ResponseStream,
};
pub use resources::{
    KvResourceClient, KvResourceHandle, NatsKvResourceClient, NatsStoreResourceClient,
    ResourceRuntimeClient, StoreResourceClient, StoreResourceHandle,
};
pub use router::{RequestContext, Router};
pub use runtime::{
    bootstrap_and_run_single_subject_service, run_multi_subject_service,
    run_single_subject_service, subscribe_subject,
};
pub use service::{AuthenticatedRouter, RequestValidator};
pub use service_host::{bootstrap_service_host, ServiceHost};
pub use transfer::{
    decode_upload_transfer_chunk, plan_download_transfer_chunks, plan_download_transfer_chunks_at,
    plan_download_transfer_grant, plan_upload_transfer_grant, run_download_transfer_endpoint,
    run_upload_transfer_endpoint, run_upload_transfer_endpoint_with_progress,
    spawn_download_transfer_endpoint, spawn_upload_transfer_endpoint,
    spawn_upload_transfer_endpoint_with_progress, DownloadTransferChunk, DownloadTransferGrant,
    DownloadTransferGrantPlan, FileTransferInfo, TransferDownloadGrantArgs,
    TransferUploadGrantArgs, UploadTransferAck, UploadTransferChunk, UploadTransferGrant,
    UploadTransferGrantPlan, UploadTransferSession, TRANSFER_EOF_HEADER, TRANSFER_SEQUENCE_HEADER,
};
