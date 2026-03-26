//! Generated Rust SDK crate for one Trellis contract.

pub mod client;
pub mod contract;
pub mod events;
pub mod rpc;
pub mod server;
pub mod subjects;
pub mod types;

pub use client::CoreClient;
pub use contract::{contract_manifest, CONTRACT_DIGEST, CONTRACT_ID, CONTRACT_JSON, CONTRACT_NAME};
pub use rpc::*;
pub use types::*;
