use trellis_jobs::keys::{job_key, worker_presence_key};
use trellis_jobs::subjects::{job_event_subject, work_subject, worker_heartbeat_subject};
use trellis_jobs::types::JobEventType;

#[test]
fn job_key_formats_service_job_type_and_job_id() {
    assert_eq!(
        job_key("documents", "document-process", "job-1"),
        "documents.document-process.job-1"
    );
}

#[test]
fn job_event_subject_formats_created_subject() {
    assert_eq!(
        job_event_subject(
            "documents",
            "document-process",
            "job-1",
            JobEventType::Created,
        ),
        "trellis.jobs.documents.document-process.job-1.created"
    );
}

#[test]
fn work_subject_formats_service_and_job_type() {
    assert_eq!(
        work_subject("documents", "document-process"),
        "trellis.work.documents.document-process"
    );
}

#[test]
fn worker_presence_key_formats_service_job_type_and_instance_id() {
    assert_eq!(
        worker_presence_key("documents", "document-process", "instance-1"),
        "documents.document-process.instance-1"
    );
}

#[test]
fn worker_heartbeat_subject_formats_service_job_type_and_instance_id() {
    assert_eq!(
        worker_heartbeat_subject("documents", "document-process", "instance-1"),
        "trellis.jobs.workers.documents.document-process.instance-1.heartbeat"
    );
}
