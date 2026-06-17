//! Generated Rust SDK crate for one Trellis contract.
pub mod client;
pub mod contract;
pub mod events;
pub mod operations;
pub mod rpc;
pub mod schemas;
pub mod types;
pub use client::HealthClient;
pub use contract::{contract_manifest, CONTRACT_DIGEST, CONTRACT_ID, CONTRACT_JSON, CONTRACT_NAME};
pub use events::*;
pub use rpc::*;
pub use types::*;
