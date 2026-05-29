//! Trellis integration harness entrypoints and support code.

pub mod admin;
pub mod app;
pub mod app_identity_approval;
pub mod browser;
pub mod catalog_authority;
pub mod cli;
pub mod container;
mod deno_fixture;
mod deployment_authority;
pub mod device_activation;
pub mod events;
pub mod feeds;
pub mod fixture;
pub mod health;
pub mod jobs;
pub mod nats;
pub mod operations;
pub mod optional_uses;
pub mod portal;
pub mod process;
pub mod report;
pub mod resources;
pub mod rpc;
pub mod runtime;
pub mod service_approval;
pub mod state;
pub mod transfer;
pub mod workspace;

pub use app::run;
pub use cli::IntegrationArgs;

#[cfg(test)]
mod public_api_guard;
