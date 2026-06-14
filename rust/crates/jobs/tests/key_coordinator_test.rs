use serde_json::json;
use trellis_jobs::bindings::{JobKeyStalePolicy, JobQueueWhenFull};
use trellis_jobs::keys::{
    acquire_active_slot_from_state, admit_job, derive_job_key, derive_key, release_active_slot,
    remove_queued_entry, renew_active_slot, restore_replaced_queued_entry, AcquireSlotInput,
    AcquireSlotOutcome, AdmitJobInput, AdmitJobOutcome, JobKeyPolicy, KeyRejectReason,
    LeaseMutationOutcome, QueueMutationOutcome,
};
use trellis_jobs::types::JobContext;

fn context(job_id: &str) -> JobContext {
    JobContext {
        request_id: format!("request-{job_id}"),
        trace_id: "0123456789abcdef0123456789abcdef".to_string(),
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
        tracestate: None,
    }
}

fn policy(when_full: JobQueueWhenFull, max_queued_per_key: u64) -> JobKeyPolicy {
    JobKeyPolicy {
        service: "documents".to_string(),
        job_type: "sync".to_string(),
        key: "zendesk:acme:tickets".to_string(),
        key_hash: "f13b9f743f4ea7a98d6898821d27b0df6e86d33237e042a6f1542dae12cb52f0".to_string(),
        max_active: 1,
        max_queued_per_key,
        when_full,
        stale_policy: JobKeyStalePolicy::FailStale,
    }
}

fn admit(job_id: &str, created_at: &str) -> AdmitJobInput {
    AdmitJobInput {
        job_id: job_id.to_string(),
        request_id: format!("request-{job_id}"),
        created_at: created_at.to_string(),
        context: context(job_id),
    }
}

fn acquire(job_id: &str, token: &str, started_at: &str, expires_at: &str) -> AcquireSlotInput {
    AcquireSlotInput {
        job_id: job_id.to_string(),
        slot_token: token.to_string(),
        instance_id: "instance-1".to_string(),
        started_at: started_at.to_string(),
        lease_expires_at: expires_at.to_string(),
        tries: 1,
        context: context(job_id),
    }
}

#[test]
fn derive_key_resolves_scalar_json_pointer_segments() {
    let payload = json!({ "origin": "acme", "page": 3, "full": true });

    let key = derive_key(
        &payload,
        &[
            "zendesk".to_string(),
            "/origin".to_string(),
            "/page".to_string(),
            "/full".to_string(),
        ],
    )
    .expect("key should derive");

    assert_eq!(key, "zendesk:acme:3:true");
}

#[test]
fn key_hash_is_stable_sha256_hex() {
    let derived = derive_job_key(
        &json!({ "origin": "zendesk", "ticket": { "id": 42 }, "urgent": true }),
        &[
            "tenant".to_string(),
            "/origin".to_string(),
            "/ticket/id".to_string(),
            "/urgent".to_string(),
        ],
    )
    .expect("key should derive");

    assert_eq!(derived.key, "tenant:zendesk:42:true");
    assert_eq!(
        derived.key_hash,
        "e8c14138e88d2132a5a2ed2c28ecd649a7d68edbe6a123fe4754c696663ca5c1"
    );
}

#[test]
fn key_hash_preserves_structured_segment_collisions() {
    let first = derive_job_key(
        &json!({ "value": "b:c" }),
        &["a".to_string(), "/value".to_string()],
    )
    .expect("first key should derive");
    let second = derive_job_key(
        &json!({ "value": "c" }),
        &["a:b".to_string(), "/value".to_string()],
    )
    .expect("second key should derive");

    assert_eq!(first.key, "a:b:c");
    assert_eq!(second.key, "a:b:c");
    assert_eq!(
        first.key_hash,
        "2f686b3f75fb933fd9c4cca247683d0fda7d496c672c8e626bda950dcda9b8bb"
    );
    assert_eq!(
        second.key_hash,
        "01dcef0a756e9178977200c82c32548d3fc6074a7eec0855389ea41f27f4b065"
    );
}

#[test]
fn admission_accepts_first_job_and_rejects_default_duplicate_queue_depth() {
    let policy = policy(JobQueueWhenFull::Reject, 0);
    let accepted = admit_job(None, &policy, admit("job-1", "2026-06-13T00:00:00Z"));
    let state = match accepted {
        AdmitJobOutcome::Accepted { state } => state,
        other => panic!("expected accepted, got {other:?}"),
    };

    let rejected = admit_job(Some(state), &policy, admit("job-2", "2026-06-13T00:00:01Z"));

    assert!(matches!(
        rejected,
        AdmitJobOutcome::Rejected {
            reason: KeyRejectReason::QueueDepth,
            queued: 1,
            limit: 1,
            ..
        }
    ));
}

#[test]
fn admission_coalesces_to_existing_job_when_full() {
    let policy = policy(JobQueueWhenFull::Coalesce, 0);
    let state = match admit_job(None, &policy, admit("job-1", "2026-06-13T00:00:00Z")) {
        AdmitJobOutcome::Accepted { state } => state,
        other => panic!("expected accepted, got {other:?}"),
    };

    let outcome = admit_job(Some(state), &policy, admit("job-2", "2026-06-13T00:00:01Z"));

    assert_eq!(
        outcome,
        AdmitJobOutcome::Coalesced {
            existing_job_id: "job-1".to_string()
        }
    );
}

#[test]
fn admission_replace_oldest_replaces_queued_not_active() {
    let policy = policy(JobQueueWhenFull::ReplaceOldest, 1);
    let state = match admit_job(None, &policy, admit("job-1", "2026-06-13T00:00:00Z")) {
        AdmitJobOutcome::Accepted { state } => state,
        other => panic!("expected accepted, got {other:?}"),
    };
    let state = match admit_job(Some(state), &policy, admit("job-2", "2026-06-13T00:00:01Z")) {
        AdmitJobOutcome::Accepted { state } => state,
        other => panic!("expected accepted, got {other:?}"),
    };

    let outcome = admit_job(Some(state), &policy, admit("job-3", "2026-06-13T00:00:02Z"));

    match outcome {
        AdmitJobOutcome::Replaced { state, replaced } => {
            assert_eq!(replaced.job_id, "job-1");
            assert_eq!(state.queued[0].job_id, "job-2");
            assert_eq!(state.queued[1].job_id, "job-3");
        }
        other => panic!("expected replaced, got {other:?}"),
    }
}

#[test]
fn admission_accepts_while_active_capacity_remains() {
    let mut policy = policy(JobQueueWhenFull::Reject, 0);
    policy.max_active = 2;
    let state = match acquire_active_slot_from_state(
        None,
        &policy,
        acquire(
            "job-1",
            "token-1",
            "2026-06-13T00:00:00Z",
            "2026-06-13T00:01:00Z",
        ),
    ) {
        AcquireSlotOutcome::Acquired { state, .. } => state,
        other => panic!("expected acquired, got {other:?}"),
    };

    let outcome = admit_job(Some(state), &policy, admit("job-2", "2026-06-13T00:00:01Z"));

    match outcome {
        AdmitJobOutcome::Accepted { state } => {
            assert_eq!(state.active.len(), 1);
            assert_eq!(state.queued.len(), 1);
            assert_eq!(state.queued[0].job_id, "job-2");
        }
        other => panic!("expected accepted, got {other:?}"),
    }
}

#[test]
fn restore_replaced_queued_entry_rolls_back_replacement() {
    let policy = policy(JobQueueWhenFull::ReplaceOldest, 1);
    let state = match admit_job(None, &policy, admit("job-1", "2026-06-13T00:00:00Z")) {
        AdmitJobOutcome::Accepted { state } => state,
        other => panic!("expected accepted, got {other:?}"),
    };
    let state = match admit_job(Some(state), &policy, admit("job-2", "2026-06-13T00:00:01Z")) {
        AdmitJobOutcome::Accepted { state } => state,
        other => panic!("expected accepted, got {other:?}"),
    };
    let (state, replaced) =
        match admit_job(Some(state), &policy, admit("job-3", "2026-06-13T00:00:02Z")) {
            AdmitJobOutcome::Replaced { state, replaced } => (state, replaced),
            other => panic!("expected replaced, got {other:?}"),
        };

    let restored = restore_replaced_queued_entry(state, replaced, "job-3", "2026-06-13T00:00:03Z");

    match restored {
        QueueMutationOutcome::Restored { state } => {
            assert_eq!(state.queued[0].job_id, "job-1");
            assert_eq!(state.queued[1].job_id, "job-2");
            assert_eq!(state.updated_at, "2026-06-13T00:00:03Z");
        }
        other => panic!("expected restored, got {other:?}"),
    }
}

#[test]
fn admission_queues_when_active_full_but_queue_depth_has_capacity() {
    let policy = policy(JobQueueWhenFull::Reject, 1);
    let state = match acquire_active_slot_from_state(
        None,
        &policy,
        acquire(
            "job-1",
            "token-1",
            "2026-06-13T00:00:00Z",
            "2026-06-13T00:01:00Z",
        ),
    ) {
        AcquireSlotOutcome::Acquired { state, .. } => state,
        other => panic!("expected acquired, got {other:?}"),
    };

    let outcome = admit_job(Some(state), &policy, admit("job-2", "2026-06-13T00:00:01Z"));

    match outcome {
        AdmitJobOutcome::Accepted { state } => {
            assert_eq!(state.active.len(), 1);
            assert_eq!(state.queued.len(), 1);
            assert_eq!(state.queued[0].job_id, "job-2");
        }
        other => panic!("expected queued acceptance, got {other:?}"),
    }
}

#[test]
fn remove_queued_entry_removes_terminal_pending_reservation() {
    let policy = policy(JobQueueWhenFull::Reject, 2);
    let state = match admit_job(None, &policy, admit("job-1", "2026-06-13T00:00:00Z")) {
        AdmitJobOutcome::Accepted { state } => state,
        other => panic!("expected accepted, got {other:?}"),
    };

    let outcome = remove_queued_entry(state, "job-1", "2026-06-13T00:00:05Z");

    match outcome {
        QueueMutationOutcome::Removed { state } => {
            assert!(state.queued.is_empty());
            assert_eq!(state.updated_at, "2026-06-13T00:00:05Z");
        }
        other => panic!("expected removed, got {other:?}"),
    }
}

#[test]
fn acquire_renew_and_release_active_slot() {
    let policy = policy(JobQueueWhenFull::Reject, 0);
    let acquired = acquire_active_slot_from_state(
        None,
        &policy,
        acquire(
            "job-1",
            "token-1",
            "2026-06-13T00:00:00Z",
            "2026-06-13T00:01:00Z",
        ),
    );
    let state = match acquired {
        AcquireSlotOutcome::Acquired { state, slot, .. } => {
            assert_eq!(slot.job_id, "job-1");
            state
        }
        other => panic!("expected acquired, got {other:?}"),
    };

    let renewed = renew_active_slot(
        state,
        "job-1",
        "token-1",
        "2026-06-13T00:00:30Z",
        "2026-06-13T00:01:30Z",
    );
    let state = match renewed {
        LeaseMutationOutcome::Renewed { state } => {
            assert_eq!(state.active[0].heartbeat_at, "2026-06-13T00:00:30Z");
            state
        }
        other => panic!("expected renewed, got {other:?}"),
    };

    assert!(matches!(
        release_active_slot(state, "job-1", "token-1", "2026-06-13T00:00:45Z"),
        LeaseMutationOutcome::Released { .. }
    ));
}

#[test]
fn acquire_blocks_when_active_slot_is_fresh() {
    let policy = policy(JobQueueWhenFull::Reject, 0);
    let state = match acquire_active_slot_from_state(
        None,
        &policy,
        acquire(
            "job-1",
            "token-1",
            "2026-06-13T00:00:00Z",
            "2026-06-13T00:01:00Z",
        ),
    ) {
        AcquireSlotOutcome::Acquired { state, .. } => state,
        other => panic!("expected acquired, got {other:?}"),
    };

    let blocked = acquire_active_slot_from_state(
        Some(state),
        &policy,
        acquire(
            "job-2",
            "token-2",
            "2026-06-13T00:00:30Z",
            "2026-06-13T00:01:30Z",
        ),
    );

    assert!(matches!(
        blocked,
        AcquireSlotOutcome::Blocked {
            reason: KeyRejectReason::ActiveLimit,
            ..
        }
    ));
}

#[test]
fn acquire_replaces_expired_slot_and_reports_stale_job() {
    let policy = policy(JobQueueWhenFull::Reject, 0);
    let state = match acquire_active_slot_from_state(
        None,
        &policy,
        acquire(
            "job-1",
            "token-1",
            "2026-06-13T00:00:00Z",
            "2026-06-13T00:01:00Z",
        ),
    ) {
        AcquireSlotOutcome::Acquired { state, .. } => state,
        other => panic!("expected acquired, got {other:?}"),
    };

    let acquired = acquire_active_slot_from_state(
        Some(state),
        &policy,
        acquire(
            "job-2",
            "token-2",
            "2026-06-13T00:02:00Z",
            "2026-06-13T00:03:00Z",
        ),
    );

    match acquired {
        AcquireSlotOutcome::Acquired {
            state, stale_slots, ..
        } => {
            assert_eq!(stale_slots[0].job_id, "job-1");
            assert_eq!(stale_slots[0].context, Some(context("job-1")));
            assert_eq!(state.stale_takeover_count, 1);
            assert_eq!(state.active[0].job_id, "job-2");
        }
        other => panic!("expected acquired, got {other:?}"),
    }
}

#[test]
fn release_with_wrong_token_reports_lost_slot() {
    let policy = policy(JobQueueWhenFull::Reject, 0);
    let state = match acquire_active_slot_from_state(
        None,
        &policy,
        acquire(
            "job-1",
            "token-1",
            "2026-06-13T00:00:00Z",
            "2026-06-13T00:01:00Z",
        ),
    ) {
        AcquireSlotOutcome::Acquired { state, .. } => state,
        other => panic!("expected acquired, got {other:?}"),
    };

    assert!(matches!(
        release_active_slot(state, "job-1", "other-token", "2026-06-13T00:00:30Z"),
        LeaseMutationOutcome::Lost { .. }
    ));
}
