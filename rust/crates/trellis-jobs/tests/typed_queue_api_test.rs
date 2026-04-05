use std::sync::{Arc, Mutex};

use serde_json::json;
use trellis_jobs::api::{
    ActiveJob, JobIdentity, JobRef, JobSnapshot, JobWorkerHost, JobsError, JobsFacade, JobsService,
};
use trellis_jobs::runtime_worker::JobCancellationToken;
use trellis_jobs::{Job, JobLogEntry, JobLogLevel, JobProgress, JobState};

#[test]
fn job_progress_matches_public_shape() {
    let progress = JobProgress {
        step: Some("processor".to_string()),
        message: Some("Submitting refund".to_string()),
        current: Some(2),
        total: Some(5),
    };

    let encoded = serde_json::to_value(progress).expect("encode progress");
    assert_eq!(encoded["step"], json!("processor"));
    assert_eq!(encoded["message"], json!("Submitting refund"));
    assert_eq!(encoded["current"], json!(2));
    assert_eq!(encoded["total"], json!(5));
}

#[test]
fn snapshot_round_trips_to_typed_payload_and_result() {
    let job = Job {
        id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state: JobState::Completed,
        payload: json!({"documentId":"doc-1"}),
        result: Some(json!({"pages": 3})),
        created_at: "2026-03-28T12:00:00Z".to_string(),
        updated_at: "2026-03-28T12:01:00Z".to_string(),
        started_at: Some("2026-03-28T12:00:05Z".to_string()),
        completed_at: Some("2026-03-28T12:01:00Z".to_string()),
        tries: 2,
        max_tries: 5,
        last_error: None,
        deadline: None,
        progress: None,
        logs: None,
    };

    let snapshot: JobSnapshot<serde_json::Value, serde_json::Value> =
        job.try_into().expect("convert job");
    assert_eq!(snapshot.id, "job-1");
    assert_eq!(snapshot.result, Some(json!({"pages": 3})));
    assert!(snapshot.logs.is_empty());
}

#[tokio::test]
async fn job_ref_uses_callbacks_for_get_wait_and_cancel() {
    let identity = JobIdentity {
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        id: "job-1".to_string(),
    };
    let snapshot: JobSnapshot<serde_json::Value, serde_json::Value> = JobSnapshot {
        id: identity.id.clone(),
        service: identity.service.clone(),
        r#type: identity.job_type.clone(),
        state: JobState::Pending,
        payload: json!({"documentId":"doc-1"}),
        result: None,
        created_at: "2026-03-28T12:00:00Z".to_string(),
        updated_at: "2026-03-28T12:00:00Z".to_string(),
        started_at: None,
        completed_at: None,
        tries: 0,
        max_tries: 5,
        last_error: None,
        progress: None,
        logs: vec![],
    };
    let calls = Arc::new(Mutex::new(Vec::<&'static str>::new()));

    let job = JobRef::new(
        identity,
        {
            let calls = Arc::clone(&calls);
            let snapshot = snapshot.clone();
            move || {
                let calls = Arc::clone(&calls);
                let snapshot = snapshot.clone();
                Box::pin(async move {
                    calls.lock().expect("lock calls").push("get");
                    Ok(snapshot)
                })
            }
        },
        {
            let calls = Arc::clone(&calls);
            let snapshot = snapshot.clone();
            move || {
                let calls = Arc::clone(&calls);
                let snapshot = snapshot.clone();
                Box::pin(async move {
                    calls.lock().expect("lock calls").push("wait");
                    Ok(snapshot)
                })
            }
        },
        {
            let calls = Arc::clone(&calls);
            let snapshot = snapshot.clone();
            move || {
                let calls = Arc::clone(&calls);
                let snapshot = snapshot.clone();
                Box::pin(async move {
                    calls.lock().expect("lock calls").push("cancel");
                    Ok(snapshot)
                })
            }
        },
    );

    assert_eq!(job.identity().id, "job-1");
    assert_eq!(job.get().await.expect("get"), snapshot);
    assert_eq!(job.wait().await.expect("wait"), snapshot);
    assert_eq!(job.cancel().await.expect("cancel"), snapshot);
    assert_eq!(
        *calls.lock().expect("lock calls"),
        vec!["get", "wait", "cancel"]
    );
}

#[tokio::test]
async fn active_job_exposes_public_handler_api() {
    let calls = Arc::new(Mutex::new(Vec::<&'static str>::new()));
    let cancellation = JobCancellationToken::new();
    cancellation.cancel();

    let active: ActiveJob<serde_json::Value, serde_json::Value> = ActiveJob::new(
        json!({"documentId":"doc-1"}),
        JobState::Active,
        2,
        cancellation,
        {
            let calls = Arc::clone(&calls);
            move || {
                let calls = Arc::clone(&calls);
                Box::pin(async move {
                    calls.lock().expect("lock calls").push("heartbeat");
                    Ok(())
                })
            }
        },
        {
            let calls = Arc::clone(&calls);
            move |progress: JobProgress| {
                let calls = Arc::clone(&calls);
                Box::pin(async move {
                    assert_eq!(progress.current, Some(1));
                    calls.lock().expect("lock calls").push("progress");
                    Ok(())
                })
            }
        },
        {
            let calls = Arc::clone(&calls);
            move |entry: JobLogEntry| {
                let calls = Arc::clone(&calls);
                Box::pin(async move {
                    assert_eq!(entry.level, JobLogLevel::Info);
                    calls.lock().expect("lock calls").push("log");
                    Ok(())
                })
            }
        },
    );

    assert_eq!(active.payload(), &json!({"documentId":"doc-1"}));
    assert!(active.is_redelivery());
    assert!(active.is_cancelled());
    active.heartbeat().await.expect("heartbeat");
    active
        .progress(JobProgress {
            step: Some("processor".to_string()),
            message: Some("step 1".to_string()),
            current: Some(1),
            total: Some(3),
        })
        .await
        .expect("progress");
    active
        .log(JobLogEntry {
            timestamp: "2026-03-28T12:00:01Z".to_string(),
            level: JobLogLevel::Info,
            message: "started".to_string(),
        })
        .await
        .expect("log");

    assert_eq!(
        *calls.lock().expect("lock calls"),
        vec!["heartbeat", "progress", "log"]
    );
}

#[test]
fn typed_jobs_traits_compile_for_custom_facades() {
    struct DemoHost;

    impl JobWorkerHost for DemoHost {
        fn stop(self) -> impl std::future::Future<Output = Result<(), JobsError>> + Send {
            async { Ok(()) }
        }

        fn join(self) -> impl std::future::Future<Output = Result<(), JobsError>> + Send {
            async { Ok(()) }
        }
    }

    struct DemoFacade;

    impl JobsFacade for DemoFacade {
        type WorkerHost = DemoHost;

        fn start_workers(
            &self,
        ) -> impl std::future::Future<Output = Result<Self::WorkerHost, JobsError>> + Send {
            async { Ok(DemoHost) }
        }
    }

    struct DemoService;

    impl JobsService for DemoService {
        type Facade = DemoFacade;

        fn jobs(&self) -> Self::Facade {
            DemoFacade
        }
    }

    fn assert_service<T: JobsService>() {}
    assert_service::<DemoService>();
}
