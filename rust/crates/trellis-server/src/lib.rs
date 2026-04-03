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
mod router;
mod runtime;
mod service;
mod service_host;

pub use bindings::{validate_bootstrap_contract_state, BootstrapBinding, BootstrapContractRef};
pub use bootstrap_ports::{resolve_bootstrap_binding, BootstrapBindingInfo, CoreBootstrapPort};
pub use connected::{
    connect_service, AsyncConnector, ConnectServiceError, ConnectedService,
    ConnectedServiceHostWithValidator, ConnectedServiceParts, SingleSubjectServiceRunner,
};
pub use descriptor::{EventDescriptor, RpcDescriptor};
pub use error::{HandlerResult, ServerError};
pub use health::{HealthCheck, HealthReport};
pub use operations::{
    control_subject, AcceptedOperation, OperationControlRequest, OperationDescriptor,
    OperationRefData, OperationSnapshot, OperationSnapshotFrame, OperationState,
};
pub use publisher::EventPublisher;
pub use request_loop::{
    decode_nats_request, dispatch_one, encode_error_reply, encode_success_reply,
    run_nats_request_loop, InboundRequest, OutboundReply, RequestHandler,
};
pub use router::{RequestContext, Router};
pub use runtime::{
    bootstrap_and_run_single_subject_service, run_single_subject_service, subscribe_subject,
};
pub use service::{AuthenticatedRouter, RequestValidator};
pub use service_host::{bootstrap_service_host, ServiceHost};
