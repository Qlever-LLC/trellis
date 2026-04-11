use serde_json::json;
use trellis_jobs::projection::{job_from_work_event, reduce_job_event};
use trellis_jobs::types::{
    Job, JobEvent, JobEventType, JobLogEntry, JobLogLevel, JobProgress, JobState,
};

fn event(
    event_type: JobEventType,
    state: JobState,
    overrides: impl FnOnce(&mut JobEvent),
) -> JobEvent {
    let mut value = JobEvent {
        job_id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        event_type,
        state,
        previous_state: None,
        tries: 0,
        max_tries: None,
        error: None,
        progress: None,
        logs: None,
        payload: None,
        result: None,
        deadline: None,
        timestamp: "2026-03-28T12:00:00.000Z".to_string(),
    };
    overrides(&mut value);
    value
}

#[test]
fn reduce_job_event_returns_none_for_non_created_when_current_missing() {
    let started = event(JobEventType::Started, JobState::Active, |_| {});
    assert_eq!(reduce_job_event(None, &started), None);
}

#[test]
fn reduce_job_event_returns_none_for_created_without_payload() {
    let created = event(JobEventType::Created, JobState::Pending, |_| {});
    assert_eq!(reduce_job_event(None, &created), None);
}

#[test]
fn reduce_job_event_creates_job_from_created_event() {
    let created = event(JobEventType::Created, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(5);
        value.deadline = Some("2026-03-28T12:30:00.000Z".to_string());
    });

    let job = reduce_job_event(None, &created).expect("created event should produce job");
    assert_eq!(job.id, "job-1");
    assert_eq!(job.service, "documents");
    assert_eq!(job.job_type, "document-process");
    assert_eq!(job.state, JobState::Pending);
    assert_eq!(job.payload, json!({ "documentId": "doc-1" }));
    assert_eq!(job.tries, 0);
    assert_eq!(job.max_tries, 5);
    assert_eq!(job.deadline.as_deref(), Some("2026-03-28T12:30:00.000Z"));
    assert_eq!(job.created_at, "2026-03-28T12:00:00.000Z");
    assert_eq!(job.updated_at, "2026-03-28T12:00:00.000Z");
}

#[test]
fn job_from_work_event_materializes_retried_event_with_payload() {
    let retried = event(JobEventType::Retried, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(5);
        value.deadline = Some("2026-03-28T12:30:00.000Z".to_string());
    });

    let job = job_from_work_event(&retried).expect("retried event should produce work job");
    assert_eq!(job.state, JobState::Pending);
    assert_eq!(job.payload, json!({ "documentId": "doc-1" }));
    assert_eq!(job.max_tries, 5);
    assert_eq!(job.deadline.as_deref(), Some("2026-03-28T12:30:00.000Z"));
}

#[test]
fn job_from_work_event_rejects_retried_event_without_payload() {
    let retried = event(JobEventType::Retried, JobState::Pending, |_| {});
    assert_eq!(job_from_work_event(&retried), None);
}

#[test]
fn reduce_job_event_happy_path_created_started_progress_logged_completed() {
    let created = event(JobEventType::Created, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(5);
    });
    let created_job = reduce_job_event(None, &created).expect("created job");

    let started = event(JobEventType::Started, JobState::Active, |value| {
        value.previous_state = Some(JobState::Pending);
        value.tries = 1;
        value.timestamp = "2026-03-28T12:01:00.000Z".to_string();
    });
    let started_job = reduce_job_event(Some(&created_job), &started).expect("started job");

    let progress = event(JobEventType::Progress, JobState::Active, |value| {
        value.previous_state = Some(JobState::Active);
        value.tries = 1;
        value.progress = Some(JobProgress {
            step: Some("extract".to_string()),
            message: Some("Extracting".to_string()),
            current: Some(2),
            total: Some(5),
        });
        value.timestamp = "2026-03-28T12:02:00.000Z".to_string();
    });
    let progressed_job = reduce_job_event(Some(&started_job), &progress).expect("progressed job");

    let logged = event(JobEventType::Logged, JobState::Active, |value| {
        value.previous_state = Some(JobState::Active);
        value.tries = 1;
        value.logs = Some(vec![JobLogEntry {
            timestamp: "2026-03-28T12:02:30.000Z".to_string(),
            level: JobLogLevel::Info,
            message: "halfway".to_string(),
        }]);
        value.timestamp = "2026-03-28T12:02:30.000Z".to_string();
    });
    let logged_job = reduce_job_event(Some(&progressed_job), &logged).expect("logged job");

    let completed = event(JobEventType::Completed, JobState::Completed, |value| {
        value.previous_state = Some(JobState::Active);
        value.tries = 1;
        value.result = Some(json!({ "pages": 3 }));
        value.timestamp = "2026-03-28T12:03:00.000Z".to_string();
    });
    let completed_job = reduce_job_event(Some(&logged_job), &completed).expect("completed job");

    assert_eq!(completed_job.state, JobState::Completed);
    assert_eq!(completed_job.result, Some(json!({ "pages": 3 })));
    assert_eq!(
        completed_job.started_at.as_deref(),
        Some("2026-03-28T12:01:00.000Z")
    );
    assert_eq!(
        completed_job.completed_at.as_deref(),
        Some("2026-03-28T12:03:00.000Z")
    );
    assert_eq!(completed_job.logs.as_ref().map(Vec::len), Some(1));
    assert_eq!(
        completed_job.progress,
        Some(JobProgress {
            step: Some("extract".to_string()),
            message: Some("Extracting".to_string()),
            current: Some(2),
            total: Some(5),
        })
    );
}

#[test]
fn reduce_job_event_rejects_completed_from_pending() {
    let created = event(JobEventType::Created, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(5);
    });
    let current = reduce_job_event(None, &created).expect("created job");

    let completed = event(JobEventType::Completed, JobState::Completed, |value| {
        value.previous_state = Some(JobState::Active);
        value.tries = 1;
        value.result = Some(json!({ "pages": 3 }));
    });

    assert_eq!(reduce_job_event(Some(&current), &completed), Some(current));
}

#[test]
fn reduce_job_event_rejects_progress_from_pending() {
    let created = event(JobEventType::Created, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(5);
    });
    let current = reduce_job_event(None, &created).expect("created job");

    let progress = event(JobEventType::Progress, JobState::Active, |value| {
        value.previous_state = Some(JobState::Active);
        value.tries = 1;
        value.progress = Some(JobProgress {
            step: Some("extract".to_string()),
            message: Some("Extracting".to_string()),
            current: Some(1),
            total: Some(5),
        });
    });

    assert_eq!(reduce_job_event(Some(&current), &progress), Some(current));
}

#[test]
fn reduce_job_event_rejects_started_when_previous_state_does_not_match_current() {
    let current = Job {
        id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state: JobState::Active,
        payload: json!({ "documentId": "doc-1" }),
        result: None,
        created_at: "2026-03-28T12:00:00.000Z".to_string(),
        updated_at: "2026-03-28T12:01:00.000Z".to_string(),
        started_at: Some("2026-03-28T12:01:00.000Z".to_string()),
        completed_at: None,
        tries: 1,
        max_tries: 5,
        last_error: None,
        deadline: None,
        progress: None,
        logs: None,
    };

    let started = event(JobEventType::Started, JobState::Active, |value| {
        value.previous_state = Some(JobState::Pending);
        value.tries = 2;
    });

    assert_eq!(reduce_job_event(Some(&current), &started), Some(current));
}

#[test]
fn reduce_job_event_sets_completed_at_for_terminal_events() {
    let created = event(JobEventType::Created, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(5);
    });
    let created_job = reduce_job_event(None, &created).expect("created job");
    let active = reduce_job_event(
        Some(&created_job),
        &event(JobEventType::Started, JobState::Active, |value| {
            value.previous_state = Some(JobState::Pending);
            value.tries = 1;
            value.timestamp = "2026-03-28T12:01:00.000Z".to_string();
        }),
    )
    .expect("active job");

    let retry = reduce_job_event(
        Some(&active),
        &event(JobEventType::Retry, JobState::Retry, |value| {
            value.previous_state = Some(JobState::Active);
            value.tries = 1;
            value.error = Some("backoff".to_string());
            value.timestamp = "2026-03-28T12:01:30.000Z".to_string();
        }),
    )
    .expect("retry job");

    for (current_state, event_type, state, previous_state) in [
        (
            JobState::Active,
            JobEventType::Failed,
            JobState::Failed,
            JobState::Active,
        ),
        (
            JobState::Retry,
            JobEventType::Cancelled,
            JobState::Cancelled,
            JobState::Retry,
        ),
        (
            JobState::Active,
            JobEventType::Expired,
            JobState::Expired,
            JobState::Active,
        ),
        (
            JobState::Failed,
            JobEventType::Dead,
            JobState::Dead,
            JobState::Failed,
        ),
        (
            JobState::Dead,
            JobEventType::Dismissed,
            JobState::Dismissed,
            JobState::Dead,
        ),
    ] {
        let current = match current_state {
            JobState::Retry => retry.clone(),
            JobState::Active => active.clone(),
            JobState::Failed => reduce_job_event(
                Some(&active),
                &event(JobEventType::Failed, JobState::Failed, |value| {
                    value.previous_state = Some(JobState::Active);
                    value.tries = 1;
                    value.error = Some("boom".to_string());
                    value.timestamp = "2026-03-28T12:02:00.000Z".to_string();
                }),
            )
            .expect("failed job"),
            JobState::Dead => {
                let failed = reduce_job_event(
                    Some(&active),
                    &event(JobEventType::Failed, JobState::Failed, |value| {
                        value.previous_state = Some(JobState::Active);
                        value.tries = 1;
                        value.error = Some("boom".to_string());
                        value.timestamp = "2026-03-28T12:02:00.000Z".to_string();
                    }),
                )
                .expect("failed job");
                reduce_job_event(
                    Some(&failed),
                    &event(JobEventType::Dead, JobState::Dead, |value| {
                        value.previous_state = Some(JobState::Failed);
                        value.tries = 1;
                        value.error = Some("dlq".to_string());
                        value.timestamp = "2026-03-28T12:03:00.000Z".to_string();
                    }),
                )
                .expect("dead job")
            }
            _ => unreachable!("covered above"),
        };

        let terminal = event(event_type, state, |value| {
            value.previous_state = Some(previous_state);
            value.tries = 1;
            value.error = Some("boom".to_string());
            value.timestamp = "2026-03-28T12:05:00.000Z".to_string();
        });
        let next = reduce_job_event(Some(&current), &terminal).expect("terminal job");
        assert_eq!(
            next.completed_at.as_deref(),
            Some("2026-03-28T12:05:00.000Z")
        );
    }
}

#[test]
fn reduce_job_event_preserves_terminal_state_for_non_retried_event() {
    let terminal = Job {
        id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state: JobState::Completed,
        payload: json!({ "documentId": "doc-1" }),
        result: Some(json!({ "ok": true })),
        created_at: "2026-03-28T12:00:00.000Z".to_string(),
        updated_at: "2026-03-28T12:01:00.000Z".to_string(),
        started_at: Some("2026-03-28T12:00:30.000Z".to_string()),
        completed_at: Some("2026-03-28T12:01:00.000Z".to_string()),
        tries: 1,
        max_tries: 3,
        last_error: None,
        deadline: None,
        progress: None,
        logs: None,
    };

    let too_late_failed = event(JobEventType::Failed, JobState::Failed, |value| {
        value.error = Some("too late".to_string());
        value.timestamp = "2026-03-28T12:02:00.000Z".to_string();
    });

    assert_eq!(
        reduce_job_event(Some(&terminal), &too_late_failed),
        Some(terminal)
    );
}

#[test]
fn reduce_job_event_allows_retried_from_terminal_and_clears_runtime_fields() {
    let terminal = Job {
        id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state: JobState::Failed,
        payload: json!({ "documentId": "doc-1" }),
        result: Some(json!({ "ok": false })),
        created_at: "2026-03-28T12:00:00.000Z".to_string(),
        updated_at: "2026-03-28T12:01:00.000Z".to_string(),
        started_at: Some("2026-03-28T12:00:30.000Z".to_string()),
        completed_at: Some("2026-03-28T12:01:00.000Z".to_string()),
        tries: 3,
        max_tries: 3,
        last_error: Some("boom".to_string()),
        deadline: None,
        progress: Some(JobProgress {
            step: Some("finalize".to_string()),
            message: None,
            current: Some(5),
            total: Some(10),
        }),
        logs: Some(vec![JobLogEntry {
            timestamp: "2026-03-28T12:00:40.000Z".to_string(),
            level: JobLogLevel::Warn,
            message: "retrying".to_string(),
        }]),
    };

    let retried = event(JobEventType::Retried, JobState::Pending, |value| {
        value.previous_state = Some(JobState::Failed);
        value.tries = 0;
        value.timestamp = "2026-03-28T12:03:00.000Z".to_string();
    });

    let updated = reduce_job_event(Some(&terminal), &retried).expect("retried job");
    assert_eq!(updated.state, JobState::Pending);
    assert_eq!(updated.tries, 0);
    assert_eq!(updated.result, None);
    assert_eq!(updated.completed_at, None);
    assert_eq!(updated.started_at, None);
    assert_eq!(updated.last_error, None);
    assert_eq!(updated.progress, None);
    assert_eq!(updated.payload, json!({ "documentId": "doc-1" }));
    assert_eq!(updated.logs, None);
}

#[test]
fn reduce_job_event_sets_last_error_for_retry_failed_expired_and_dead() {
    let created = event(JobEventType::Created, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(5);
    });
    let current = reduce_job_event(None, &created).expect("created job");

    let active = reduce_job_event(
        Some(&current),
        &event(JobEventType::Started, JobState::Active, |value| {
            value.previous_state = Some(JobState::Pending);
            value.tries = 1;
            value.timestamp = "2026-03-28T12:01:00.000Z".to_string();
        }),
    )
    .expect("active job");

    for (current_job, event_type, state, previous_state) in [
        (
            &active,
            JobEventType::Retry,
            JobState::Retry,
            JobState::Active,
        ),
        (
            &active,
            JobEventType::Failed,
            JobState::Failed,
            JobState::Active,
        ),
        (
            &active,
            JobEventType::Expired,
            JobState::Expired,
            JobState::Active,
        ),
    ] {
        let update = event(event_type, state, |value| {
            value.previous_state = Some(previous_state);
            value.error = Some("boom".to_string());
            value.tries = 1;
            value.timestamp = "2026-03-28T12:10:00.000Z".to_string();
        });
        let next =
            reduce_job_event(Some(current_job), &update).expect("job should stay materialized");
        assert_eq!(next.last_error.as_deref(), Some("boom"));
    }

    let failed = reduce_job_event(
        Some(&active),
        &event(JobEventType::Failed, JobState::Failed, |value| {
            value.previous_state = Some(JobState::Active);
            value.tries = 1;
            value.error = Some("boom".to_string());
            value.timestamp = "2026-03-28T12:11:00.000Z".to_string();
        }),
    )
    .expect("failed job");
    let dead = event(JobEventType::Dead, JobState::Dead, |value| {
        value.previous_state = Some(JobState::Failed);
        value.tries = 1;
        value.error = Some("boom".to_string());
        value.timestamp = "2026-03-28T12:12:00.000Z".to_string();
    });
    let next = reduce_job_event(Some(&failed), &dead).expect("dead job");
    assert_eq!(next.last_error.as_deref(), Some("boom"));
}

#[test]
fn reduce_job_event_updates_max_tries_only_when_present() {
    let created = event(JobEventType::Created, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(5);
    });
    let current = reduce_job_event(None, &created).expect("created job");

    let without_max = event(JobEventType::Started, JobState::Active, |value| {
        value.previous_state = Some(JobState::Pending);
        value.tries = 1;
        value.timestamp = "2026-03-28T12:01:00.000Z".to_string();
    });
    let still_five = reduce_job_event(Some(&current), &without_max).expect("started job");
    assert_eq!(still_five.max_tries, 5);

    let with_max = event(JobEventType::Retry, JobState::Retry, |value| {
        value.previous_state = Some(JobState::Active);
        value.tries = 1;
        value.max_tries = Some(7);
        value.error = Some("backoff".to_string());
        value.timestamp = "2026-03-28T12:02:00.000Z".to_string();
    });
    let updated = reduce_job_event(Some(&still_five), &with_max).expect("retry job");
    assert_eq!(updated.max_tries, 7);
}

#[test]
fn reduce_job_event_rejects_non_retried_transitions_from_all_terminal_states() {
    for terminal_state in [
        JobState::Completed,
        JobState::Failed,
        JobState::Cancelled,
        JobState::Expired,
        JobState::Dead,
    ] {
        let current = Job {
            id: "job-1".to_string(),
            service: "documents".to_string(),
            job_type: "document-process".to_string(),
            state: terminal_state,
            payload: json!({ "documentId": "doc-1" }),
            result: None,
            created_at: "2026-03-28T12:00:00.000Z".to_string(),
            updated_at: "2026-03-28T12:01:00.000Z".to_string(),
            started_at: None,
            completed_at: None,
            tries: 1,
            max_tries: 3,
            last_error: None,
            deadline: None,
            progress: None,
            logs: None,
        };

        let started = event(JobEventType::Started, JobState::Active, |value| {
            value.tries = 2;
            value.timestamp = "2026-03-28T12:02:00.000Z".to_string();
        });
        assert_eq!(
            reduce_job_event(Some(&current), &started),
            Some(current.clone()),
            "terminal state {terminal_state:?} should be preserved",
        );
    }
}

#[test]
fn reduce_job_event_supports_retry_redelivery_and_retry_terminal_transitions() {
    let created = event(JobEventType::Created, JobState::Pending, |value| {
        value.payload = Some(json!({ "documentId": "doc-1" }));
        value.max_tries = Some(3);
    });
    let created_job = reduce_job_event(None, &created).expect("created job");

    let active = reduce_job_event(
        Some(&created_job),
        &event(JobEventType::Started, JobState::Active, |value| {
            value.previous_state = Some(JobState::Pending);
            value.tries = 1;
            value.timestamp = "2026-03-28T12:00:30.000Z".to_string();
        }),
    )
    .expect("active job");

    let retry = event(JobEventType::Retry, JobState::Retry, |value| {
        value.previous_state = Some(JobState::Active);
        value.tries = 1;
        value.error = Some("transient".to_string());
        value.timestamp = "2026-03-28T12:01:00.000Z".to_string();
    });
    let retry_job = reduce_job_event(Some(&active), &retry).expect("retry job");
    assert_eq!(retry_job.state, JobState::Retry);

    let redelivered_started = event(JobEventType::Started, JobState::Active, |value| {
        value.previous_state = Some(JobState::Retry);
        value.tries = 2;
        value.timestamp = "2026-03-28T12:02:00.000Z".to_string();
    });
    let active_again =
        reduce_job_event(Some(&retry_job), &redelivered_started).expect("active on redelivery");
    assert_eq!(active_again.state, JobState::Active);

    let cancelled = event(JobEventType::Cancelled, JobState::Cancelled, |value| {
        value.previous_state = Some(JobState::Retry);
        value.tries = 1;
        value.timestamp = "2026-03-28T12:03:00.000Z".to_string();
    });
    let cancelled_job = reduce_job_event(Some(&retry_job), &cancelled).expect("cancelled job");
    assert_eq!(cancelled_job.state, JobState::Cancelled);

    let expired = event(JobEventType::Expired, JobState::Expired, |value| {
        value.previous_state = Some(JobState::Retry);
        value.tries = 1;
        value.error = Some("deadline".to_string());
        value.timestamp = "2026-03-28T12:03:00.000Z".to_string();
    });
    let expired_job = reduce_job_event(Some(&retry_job), &expired).expect("expired job");
    assert_eq!(expired_job.state, JobState::Expired);
    assert_eq!(expired_job.last_error.as_deref(), Some("deadline"));
}
