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

#[path = "integration/authority_plan.rs"]
mod authority_plan;

#[path = "integration/outbox.rs"]
mod outbox;

#[path = "integration/service_approval.rs"]
mod service_approval;

#[path = "integration/app_identity_approval.rs"]
mod app_identity_approval;

#[path = "integration/device_activation.rs"]
mod device_activation;

#[path = "integration/control_plane.rs"]
mod control_plane;

#[path = "integration/control_plane_jobs_admin.rs"]
mod control_plane_jobs_admin;

#[path = "integration/event_consumers.rs"]
mod event_consumers;

#[path = "integration/prepared_events.rs"]
mod prepared_events;

#[test]
fn rust_integration_manifest_conforms_to_shared_matrix() {
    support::cases::assert_rust_manifest_conforms_to_matrix();
}

#[test]
fn rust_service_integration_manifest_conforms_to_shared_matrix() {
    support::cases::assert_rust_service_manifest_conforms_to_matrix();
}
