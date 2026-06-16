#[path = "integration/support/mod.rs"]
mod support;

#[path = "integration/rpc.rs"]
mod rpc;

#[path = "integration/events.rs"]
mod events;

#[path = "integration/operations.rs"]
mod operations;

#[path = "integration/feeds.rs"]
mod feeds;

#[path = "integration/state.rs"]
mod state;

#[path = "integration/transfer.rs"]
mod transfer;

#[path = "integration/resources.rs"]
mod resources;

#[path = "integration/jobs.rs"]
mod jobs;

#[path = "integration/health.rs"]
mod health;

#[path = "integration/service_approval.rs"]
mod service_approval;

#[path = "integration/app_identity_approval.rs"]
mod app_identity_approval;

#[path = "integration/device_activation.rs"]
mod device_activation;

#[test]
fn rust_integration_manifest_conforms_to_shared_matrix() {
    support::cases::assert_rust_manifest_conforms_to_matrix();
}
