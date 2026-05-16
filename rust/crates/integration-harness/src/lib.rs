//! Trellis integration harness entrypoints and support code.

pub mod admin;
pub mod app;
pub mod browser;
pub mod cli;
pub mod container;
pub mod events;
pub mod feeds;
pub mod health;
pub mod jobs;
pub mod nats;
pub mod operations;
pub mod portal;
pub mod process;
pub mod report;
pub mod rpc;
pub mod runtime;
pub mod service_approval;
pub mod state;
pub mod transfer;
pub mod workspace;

pub use app::run;
pub use cli::IntegrationArgs;
