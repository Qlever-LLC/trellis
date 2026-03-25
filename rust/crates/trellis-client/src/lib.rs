//! Low-level outbound Trellis runtime primitives for generated Rust code.
//!
//! This crate provides connection/auth helpers plus descriptor-driven request and
//! publish operations. It intentionally avoids contract-specific convenience
//! methods so first-party code can move toward generated SDKs and participant
//! facades.

mod auth;
mod client;
mod descriptor;
mod error;
mod proof;

pub use auth::SessionAuth;
pub use client::{ServiceConnectOptions, TrellisClient, UserConnectOptions};
pub use descriptor::{EventDescriptor, RpcDescriptor};
pub use error::TrellisClientError;
pub use proof::verify_proof;

#[cfg(test)]
mod tests;
