use std::collections::BTreeMap;

use serde_json::json;
use trellis_jobs::bindings::{parse_jobs_binding, JobsBindingError, JobsRuntimeBinding};
use trellis_sdk_core::types::{
    TrellisBindingsGetResponseBinding, TrellisBindingsGetResponseBindingResources,
    TrellisBindingsGetResponseBindingResourcesJobs,
    TrellisBindingsGetResponseBindingResourcesJobsQueuesValue,
    TrellisBindingsGetResponseBindingResourcesJobsQueuesValuePayload,
    TrellisBindingsGetResponseBindingResourcesJobsQueuesValueResult,
    TrellisBindingsGetResponseBindingResourcesStreamsValue,
};

#[test]
fn parse_jobs_binding_maps_queue_values() {
    let binding = parse_jobs_binding(
        "documents",
        &BTreeMap::from([(
            "document-process".to_string(),
            json!({
                "publishPrefix": "trellis.jobs.documents.document-process",
                "workSubject": "trellis.work.documents.document-process",
                "consumerName": "documents-document-process",
                "maxDeliver": 5,
                "backoffMs": [5000, 30000],
                "ackWaitMs": 60000,
                "defaultDeadlineMs": 120000,
                "progress": true,
                "logs": true,
                "concurrency": 2
            }),
        )]),
    )
    .expect("binding should parse");

    assert_eq!(binding.namespace, "documents");
    assert_eq!(binding.jobs_state_bucket, None);
    let queue = binding
        .queues
        .get("document-process")
        .expect("queue binding should exist");
    assert_eq!(
        queue.publish_prefix,
        "trellis.jobs.documents.document-process"
    );
    assert_eq!(
        queue.work_subject,
        "trellis.work.documents.document-process"
    );
    assert_eq!(queue.consumer_name, "documents-document-process");
    assert_eq!(queue.max_deliver, 5);
    assert_eq!(queue.backoff_ms, vec![5000, 30000]);
    assert_eq!(queue.ack_wait_ms, 60000);
    assert_eq!(queue.default_deadline_ms, Some(120000));
    assert!(queue.progress);
    assert!(queue.logs);
    assert_eq!(queue.concurrency, 2);
}

#[test]
fn parse_jobs_binding_rejects_invalid_queue_shape() {
    let error = parse_jobs_binding(
        "documents",
        &BTreeMap::from([(
            "document-process".to_string(),
            json!({ "publishPrefix": true }),
        )]),
    )
    .expect_err("invalid binding should fail");

    assert!(matches!(
        error,
        JobsBindingError::InvalidQueueBinding { queue_type, .. } if queue_type == "document-process"
    ));
}

fn sample_core_binding() -> TrellisBindingsGetResponseBinding {
    TrellisBindingsGetResponseBinding {
        contract_id: "trellis.jobs@v1".to_string(),
        digest: "sha256:expected".to_string(),
        resources: TrellisBindingsGetResponseBindingResources {
            jobs: Some(TrellisBindingsGetResponseBindingResourcesJobs {
                namespace: "documents".to_string(),
                queues: BTreeMap::from([(
                    "document-process".to_string(),
                    TrellisBindingsGetResponseBindingResourcesJobsQueuesValue {
                        ack_wait_ms: 60_000,
                        backoff_ms: vec![5_000, 30_000],
                        concurrency: 2,
                        consumer_name: "documents-document-process".to_string(),
                        default_deadline_ms: Some(120_000),
                        dlq: true,
                        logs: true,
                        max_deliver: 5,
                        payload: TrellisBindingsGetResponseBindingResourcesJobsQueuesValuePayload {
                            schema: "DocumentPayload".to_string(),
                        },
                        progress: true,
                        publish_prefix: "trellis.jobs.documents.document-process".to_string(),
                        queue_type: "document-process".to_string(),
                        result: Some(
                            TrellisBindingsGetResponseBindingResourcesJobsQueuesValueResult {
                                schema: "DocumentResult".to_string(),
                            },
                        ),
                        work_subject: "trellis.work.documents.document-process".to_string(),
                    },
                )]),
            }),
            kv: Some(BTreeMap::from([(
                "jobsState".to_string(),
                trellis_sdk_core::types::TrellisBindingsGetResponseBindingResourcesKvValue {
                    bucket: "trellis_jobs".to_string(),
                    history: 1,
                    max_value_bytes: None,
                    ttl_ms: 0,
                },
            )])),
            streams: Some(BTreeMap::from([(
                "jobsWork".to_string(),
                TrellisBindingsGetResponseBindingResourcesStreamsValue {
                    discard: None,
                    max_age_ms: None,
                    max_bytes: None,
                    max_msgs: None,
                    name: "JOBS_WORK".to_string(),
                    num_replicas: Some(3),
                    retention: Some("workqueue".to_string()),
                    sources: None,
                    storage: Some("file".to_string()),
                    subjects: vec!["trellis.work.>".to_string()],
                },
            )])),
        },
    }
}

#[test]
fn jobs_runtime_binding_try_from_core_binding_maps_jobs_and_work_stream() {
    let runtime = JobsRuntimeBinding::try_from(&sample_core_binding()).expect("binding should map");

    assert_eq!(runtime.work_stream, "JOBS_WORK");
    assert_eq!(runtime.jobs.namespace, "documents");
    assert_eq!(
        runtime.jobs.jobs_state_bucket.as_deref(),
        Some("trellis_jobs")
    );
    let queue = runtime.jobs.queues.get("document-process").expect("queue");
    assert_eq!(queue.max_deliver, 5);
    assert_eq!(queue.default_deadline_ms, Some(120_000));
    assert_eq!(queue.concurrency, 2);
}

#[test]
fn parse_jobs_binding_and_runtime_binding_share_same_queue_shape() {
    let parsed = parse_jobs_binding(
        "documents",
        &BTreeMap::from([(
            "document-process".to_string(),
            json!({
                "publishPrefix": "trellis.jobs.documents.document-process",
                "workSubject": "trellis.work.documents.document-process",
                "consumerName": "documents-document-process",
                "maxDeliver": 5,
                "backoffMs": [5000, 30000],
                "ackWaitMs": 60000,
                "defaultDeadlineMs": 120000,
                "progress": true,
                "logs": true,
                "concurrency": 2
            }),
        )]),
    )
    .expect("parsed binding");

    let runtime = JobsRuntimeBinding::try_from(&sample_core_binding()).expect("runtime binding");

    assert_eq!(parsed.namespace, runtime.jobs.namespace);
    assert_eq!(parsed.queues, runtime.jobs.queues);
}

#[test]
fn jobs_runtime_binding_try_from_core_binding_rejects_missing_jobs_resource() {
    let mut binding = sample_core_binding();
    binding.resources.jobs = None;

    let error = JobsRuntimeBinding::try_from(&binding).expect_err("missing jobs should fail");
    assert!(matches!(error, JobsBindingError::MissingJobsResource));
}

#[test]
fn jobs_runtime_binding_try_from_core_binding_rejects_missing_jobs_work_stream() {
    let mut binding = sample_core_binding();
    binding.resources.streams = None;

    let error =
        JobsRuntimeBinding::try_from(&binding).expect_err("missing jobsWork stream should fail");
    assert!(matches!(error, JobsBindingError::MissingWorkStream));
}

#[test]
fn jobs_runtime_binding_try_from_core_binding_rejects_negative_numeric_queue_fields() {
    let mut binding = sample_core_binding();
    binding
        .resources
        .jobs
        .as_mut()
        .expect("jobs")
        .queues
        .get_mut("document-process")
        .expect("queue")
        .max_deliver = -1;

    let error =
        JobsRuntimeBinding::try_from(&binding).expect_err("negative max_deliver should fail");
    assert!(matches!(
        error,
        JobsBindingError::InvalidQueueBinding { queue_type, .. } if queue_type == "document-process"
    ));
}

#[test]
fn jobs_runtime_binding_try_from_core_binding_rejects_concurrency_over_u32_range() {
    let mut binding = sample_core_binding();
    binding
        .resources
        .jobs
        .as_mut()
        .expect("jobs")
        .queues
        .get_mut("document-process")
        .expect("queue")
        .concurrency = i64::from(u32::MAX) + 1;

    let error =
        JobsRuntimeBinding::try_from(&binding).expect_err("overflow concurrency should fail");
    assert!(matches!(
        error,
        JobsBindingError::InvalidQueueBinding { queue_type, .. } if queue_type == "document-process"
    ));
}
