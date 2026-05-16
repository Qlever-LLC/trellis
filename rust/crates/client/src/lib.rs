//! Low-level outbound Trellis runtime primitives for generated Rust code.
//!
//! This crate provides connection/auth helpers plus descriptor-driven request and
//! publish operations. It intentionally avoids contract-specific convenience
//! methods so first-party code can move toward generated SDKs and small local
//! wrappers.

mod auth;
mod client;
mod descriptor;
mod error;
mod operations;
mod proof;
mod state;
mod transfer;

pub use auth::SessionAuth;
pub use client::{
    DeviceConnectOptions, ServiceConnectOptions, ServiceConnectWithContractOptions, TrellisClient,
    UserConnectOptions,
};
pub use descriptor::{EventDescriptor, FeedDescriptor, RpcDescriptor};
pub use error::{RpcErrorPayload, TrellisClientError};
pub use operations::{
    control_subject, OperationDescriptor, OperationEvent, OperationInputBuilder, OperationInvoker,
    OperationRef, OperationRefData, OperationSignalAccepted, OperationSnapshot, OperationState,
    OperationTransferInputBuilder, OperationTransferProgress, OperationTransferStartError,
    OperationTransport, StartedOperationTransfer, TransferOperationDescriptor,
};
pub use proof::verify_proof;
pub use state::{
    DeleteStateOptions, ExpectedPutRevision, ListStateOptions, MapStateEntry, MapStateListResult,
    MapStateStore, PutStateOptions, StateDeleteResult, StateEntry, StateGetResult,
    StateMigrationRequired, StatePutResult, StateTransport, StateValue, ValueStateStore,
};
pub use transfer::{
    download_transfer_grant_from_value, DownloadTransferGrant, FileInfo, UploadTransferGrant,
};

#[cfg(test)]
mod tests;
