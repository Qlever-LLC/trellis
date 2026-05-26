//! Low-level inbound Trellis runtime primitives for generated Rust code.

mod bindings;
mod bootstrap_ports;
mod connected;
mod core_bootstrap;
mod descriptor;
mod error;
mod health;
mod operations;
mod publisher;
mod request_loop;
mod request_validator_adapter;
mod resources;
mod router;
mod runtime;
mod runtime_facade;
mod service;
mod service_host;
mod transfer;

pub use bindings::{
    validate_bootstrap_contract_state, BootstrapBinding, BootstrapContractRef,
    EventConsumerOrdering, EventConsumerReplay, EventConsumerResourceBinding,
    JobsQueueResourceBinding, JobsResourceBinding, JobsSchemaRef, KvResourceBinding,
    ServiceResourceBindings, StoreResourceBinding,
};
pub use bootstrap_ports::{resolve_bootstrap_binding, BootstrapBindingInfo, CoreBootstrapPort};
pub use connected::{
    connect_service, connect_service_with_options, AsyncConnector,
    AuthenticatedServiceConnectOptions, ConnectServiceError, ConnectedService,
    ConnectedServiceHostWithValidator, ConnectedServiceParts, SingleSubjectServiceRunner,
};
pub use core_bootstrap::{CoreBootstrapAdapter, CoreBootstrapClientPort};
pub use descriptor::{EventDescriptor, FeedDescriptor, RpcDescriptor};
pub use error::{DeclaredRpcError, HandlerResult, ServerError};
pub use health::{HealthCheck, HealthReport};
pub use operations::{
    control_subject, AcceptedOperation, InMemoryOperationRuntime, OperationControl,
    OperationControlRequest, OperationDescriptor, OperationError, OperationFailure,
    OperationProvider, OperationRefData, OperationSignal, OperationSignalAccepted,
    OperationSnapshot, OperationSnapshotFrame, OperationState, OperationTransferProgress,
    ServiceOperation,
};
pub use publisher::EventPublisher;
pub use request_loop::{
    decode_nats_request, dispatch_one, encode_error_reply, encode_success_reply,
    run_nats_request_loop, HandlerResponse, InboundRequest, OutboundReply, RequestHandler,
    ResponseStream,
};
pub use request_validator_adapter::{
    payload_hash_base64url, AuthRequestValidatorAdapter as DefaultRequestValidator,
    AuthRequestValidatorClientPort as DefaultRequestValidatorClientPort,
};
pub use resources::{
    KvResourceClient, KvResourceEntry, KvResourceHandle, KvResourceOperation, NatsKvResourceClient,
    NatsKvWatch, NatsStoreResourceClient, ResourceRuntimeClient, StoreResourceClient,
    StoreResourceHandle, StoreWaitOptions,
};
pub use router::{RequestContext, Router};
pub use runtime::{
    bootstrap_and_run_single_subject_service, run_multi_subject_service,
    run_single_subject_service, subscribe_subject,
};
pub use runtime_facade::{
    ConnectedServiceRuntime, CoreBootstrapBinding, DefaultServiceRunner, GeneratedServiceContract,
    ServiceConnectOptions, ServiceHandle, ServiceHandlerContext, ServiceOperationProvider,
    ServiceOperationWatch, ServiceRuntimeError, ServiceRuntimeRunner, DEFAULT_APPROVAL_TIMEOUT_MS,
    DEFAULT_RETRY_DELAY_MS, DEFAULT_TIMEOUT_MS,
};
pub use service::{AuthenticatedRouter, RequestValidation, RequestValidator};
pub use service_host::{bootstrap_service_host, ServiceHost};
pub use transfer::{
    decode_upload_transfer_chunk, plan_download_transfer_chunks, plan_download_transfer_chunks_at,
    plan_download_transfer_grant, plan_upload_transfer_grant, run_download_transfer_endpoint,
    run_upload_transfer_endpoint, run_upload_transfer_endpoint_with_progress,
    spawn_download_transfer_endpoint, spawn_upload_transfer_endpoint,
    spawn_upload_transfer_endpoint_with_completion, spawn_upload_transfer_endpoint_with_progress,
    spawn_upload_transfer_endpoint_with_progress_and_completion, DownloadTransferChunk,
    DownloadTransferGrant, DownloadTransferGrantPlan, FileTransferInfo, TransferDownloadGrantArgs,
    TransferUploadGrantArgs, UploadTransferAck, UploadTransferChunk, UploadTransferCompletion,
    UploadTransferGrant, UploadTransferGrantPlan, UploadTransferSession, TRANSFER_EOF_HEADER,
    TRANSFER_SEQUENCE_HEADER,
};
