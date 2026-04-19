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
mod transfer;

pub use auth::SessionAuth;
pub use client::{ServiceConnectOptions, TrellisClient, UserConnectOptions};
pub use descriptor::{EventDescriptor, RpcDescriptor};
pub use error::TrellisClientError;
pub use operations::{
    control_subject, OperationDescriptor, OperationEvent, OperationInvoker, OperationRef,
    OperationRefData, OperationSnapshot, OperationState, OperationTransferProgress,
    OperationTransport,
};
pub use proof::verify_proof;
pub use transfer::{DownloadTransferGrant, FileInfo, UploadTransferGrant};

#[cfg(test)]
mod tests;
