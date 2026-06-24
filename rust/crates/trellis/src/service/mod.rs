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
mod schema_validation;
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
pub use core_bootstrap::{CoreBootstrapAdapter, CoreBootstrapClientPort};
pub use descriptor::{EventDescriptor, FeedDescriptor, RpcDescriptor};
pub use error::{
    DeclaredRpcError, HandlerResult, SchemaValidationIssue, ServerError, ValidationIssue,
};
pub use health::{HealthCheck, HealthReport};
pub use operations::{
    control_subject, AcceptedOperation, InMemoryOperationRuntime, OperationControl,
    OperationControlRequest, OperationDescriptor, OperationError, OperationFailure,
    OperationFailureLike, OperationProvider, OperationRefData, OperationSignal,
    OperationSignalAccepted, OperationSnapshot, OperationSnapshotFrame, OperationState,
    OperationTransferProgress, ServiceOperation,
};
pub use publisher::EventPublisher;
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
pub use runtime_facade::{
    ConnectedServiceRuntime, CoreBootstrapBinding, DefaultServiceRunner, GeneratedServiceContract,
    ServiceConnectOptions, ServiceEventListenOptions, ServiceEventListenerContext,
    ServiceEventListenerMode, ServiceHandle, ServiceHandlerContext, ServiceOperationProvider,
    ServiceOperationWatch, ServiceRuntimeError, ServiceRuntimeRunner,
    DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS, DEFAULT_RETRY_DELAY_MS, DEFAULT_TIMEOUT_MS,
};
pub use schema_validation::validate_input_schema;
pub use service::{AuthenticatedRouter, RequestValidation, RequestValidator};
pub use service_host::{bootstrap_service_host, ServiceHost};
pub use transfer::{
    decode_upload_transfer_chunk, plan_download_transfer_chunks, plan_download_transfer_chunks_at,
    plan_download_transfer_grant, plan_upload_transfer_grant, DownloadTransferChunk,
    DownloadTransferGrant, DownloadTransferGrantPlan, FileTransferInfo, TransferDownloadGrantArgs,
    TransferUploadGrantArgs, UploadTransferAck, UploadTransferChunk, UploadTransferCompletion,
    UploadTransferGrant, UploadTransferGrantPlan, UploadTransferSession, TRANSFER_EOF_HEADER,
    TRANSFER_SEQUENCE_HEADER,
};

#[doc(hidden)]
pub mod internal {
    pub use super::connected::{
        connect_service, connect_service_with_options, AsyncConnector,
        AuthenticatedServiceConnectOptions, ConnectServiceError, ConnectedService,
        ConnectedServiceHostWithValidator, ConnectedServiceParts, SingleSubjectServiceRunner,
    };
    pub use super::request_loop::{
        dispatch_one, encode_error_reply, encode_success_reply, HandlerResponse, InboundRequest,
        OutboundReply, RequestHandler, ResponseStream,
    };
    pub use super::runtime::{
        bootstrap_and_run_single_subject_service, run_multi_subject_service,
        run_single_subject_service, subscribe_subject,
    };
}
