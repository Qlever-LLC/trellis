use trellis_jobs::registry::{new_worker_heartbeat, ActiveJobCancellationRegistry};
use trellis_jobs::runtime_worker::JobCancellationToken;

#[test]
fn new_worker_heartbeat_sets_expected_fields() {
    let heartbeat = new_worker_heartbeat(
        "documents",
        "document-process",
        "instance-1",
        Some(2),
        Some("0.6.1".to_string()),
        "2026-03-30T12:00:00.000Z".to_string(),
    );

    assert_eq!(heartbeat.service, "documents");
    assert_eq!(heartbeat.job_type, "document-process");
    assert_eq!(heartbeat.instance_id, "instance-1");
    assert_eq!(heartbeat.concurrency, Some(2));
    assert_eq!(heartbeat.version.as_deref(), Some("0.6.1"));
    assert_eq!(heartbeat.timestamp, "2026-03-30T12:00:00.000Z");
}

#[test]
fn active_job_cancellation_registry_cancels_registered_tokens() {
    let registry = ActiveJobCancellationRegistry::new();
    let token = JobCancellationToken::new();
    let _guard = registry.register("documents.document-process.job-1", token.clone());

    assert!(registry.cancel("documents.document-process.job-1"));
    assert!(token.is_cancelled());
}

#[test]
fn active_job_cancellation_registry_unregisters_on_guard_drop() {
    let registry = ActiveJobCancellationRegistry::new();
    let token = JobCancellationToken::new();
    let guard = registry.register("documents.document-process.job-1", token.clone());
    drop(guard);

    assert!(!registry.cancel("documents.document-process.job-1"));
    assert!(!token.is_cancelled());
}

#[test]
fn active_job_cancellation_registry_applies_pending_cancel_on_late_register() {
    let registry = ActiveJobCancellationRegistry::new();
    assert!(!registry.cancel("documents.document-process.job-1"));

    let token = JobCancellationToken::new();
    let _guard = registry.register("documents.document-process.job-1", token.clone());

    assert!(token.is_cancelled());
}

#[test]
fn active_job_cancellation_registry_forgets_pending_cancel_after_stale_work_reconciliation() {
    let registry = ActiveJobCancellationRegistry::new();
    assert!(!registry.cancel("documents.document-process.job-1"));

    registry.clear_pending("documents.document-process.job-1");

    let token = JobCancellationToken::new();
    let _guard = registry.register("documents.document-process.job-1", token.clone());

    assert!(!token.is_cancelled());
}

#[test]
fn active_job_cancellation_registry_shares_pending_cleanup_across_clones() {
    let registry = ActiveJobCancellationRegistry::new();
    let shared_registry = registry.clone();
    assert!(!registry.cancel("documents.document-process.job-1"));

    shared_registry.clear_pending("documents.document-process.job-1");

    let token = JobCancellationToken::new();
    let _guard = registry.register("documents.document-process.job-1", token.clone());

    assert!(!token.is_cancelled());
}
