use serde_json::json;
use trellis_contracts::{
    schema_ref, stream, stream_source, subject, use_contract, ContractManifestBuilder,
    CONTRACT_FORMAT_V1,
};

#[test]
fn builder_minimal_manifest_defaults_format_and_validates() {
    let manifest = ContractManifestBuilder::new(
        "example.contract@v1",
        "Example Contract",
        "Example contract description.",
    )
    .build()
    .expect("builder should produce a valid minimal manifest");

    assert_eq!(manifest.format, CONTRACT_FORMAT_V1);
    assert_eq!(manifest.id, "example.contract@v1");
}

#[test]
fn builder_supports_uses_rpc_subject_kv_stream_and_job_queue_resources() {
    let manifest =
        ContractManifestBuilder::new("example.jobs@v1", "Example Jobs", "Example jobs manifest.")
            .schema(
                "HealthRequest",
                json!({ "type": "object", "properties": {}, "additionalProperties": false }),
            )
            .schema(
                "HealthResponse",
                json!({
                    "type": "object",
                    "required": ["ok"],
                    "properties": {"ok": {"type": "boolean"}},
                    "additionalProperties": false
                }),
            )
            .use_ref(
                "core",
                use_contract("trellis.core@v1").with_rpc_call(["Trellis.Catalog"]),
            )
            .rpc(
                "Jobs.Health",
                trellis_contracts::rpc(
                    "v1",
                    "rpc.v1.Jobs.Health",
                    "HealthRequest",
                    "HealthResponse",
                )
                .with_call_capabilities(["jobs.admin.read"])
                .with_error_types(["UnexpectedError"]),
            )
            .subject(
                "Jobs.Stream",
                subject("trellis.jobs.>")
                    .with_publish_capabilities(["service:jobs"])
                    .with_subscribe_capabilities(["jobs.admin.stream"]),
            )
            .kv_resource(
                "jobsState",
                trellis_contracts::kv("Store projected job state")
                    .required(true)
                    .history(1)
                    .ttl_ms(0),
            )
            .stream_resource(
                "jobsEvents",
                stream("Observe job events", ["events.v1.Jobs.>"]),
            )
            .job_queue(
                "document-process",
                trellis_contracts::job_queue(
                    schema_ref("HealthRequest"),
                    Some(schema_ref("HealthResponse")),
                ),
            )
            .build()
            .expect("builder should produce a valid manifest");

    assert!(manifest.uses.contains_key("core"));
    assert!(manifest.rpc.contains_key("Jobs.Health"));
    assert!(manifest.subjects.contains_key("Jobs.Stream"));
    assert!(manifest.resources.kv.contains_key("jobsState"));
    assert!(manifest.resources.streams.contains_key("jobsEvents"));
    assert!(manifest.resources.jobs.is_some());
    assert!(manifest
        .resources
        .jobs
        .expect("jobs resources")
        .queues
        .contains_key("document-process"));
}

#[test]
fn builder_supports_rich_stream_resources_with_sources() {
    let manifest = ContractManifestBuilder::new(
        "example.streams@v1",
        "Example Streams",
        "Example stream manifest.",
    )
    .stream_resource(
        "jobs",
        stream("Store append-only job lifecycle events", ["trellis.jobs.>"])
            .required(true)
            .retention("limits")
            .storage("file")
            .num_replicas(3)
            .discard("old")
            .max_msgs(-1)
            .max_bytes(-1)
            .max_age_ms(0),
    )
    .stream_resource(
        "jobsWork",
        stream("Store sourced work-queue messages", ["trellis.work.>"])
            .required(true)
            .retention("workqueue")
            .storage("file")
            .num_replicas(3)
            .source(
                stream_source("jobs")
                    .filter_subject("trellis.jobs.*.*.*.created")
                    .subject_transform_dest("trellis.work.$1.$2"),
            ),
    )
    .build()
    .expect("builder should produce a valid manifest");

    let jobs = manifest
        .resources
        .streams
        .get("jobs")
        .expect("jobs stream resource");
    assert_eq!(jobs.retention.as_deref(), Some("limits"));
    assert_eq!(jobs.storage.as_deref(), Some("file"));
    assert_eq!(jobs.num_replicas, Some(3));
    assert_eq!(jobs.discard.as_deref(), Some("old"));

    let jobs_work = manifest
        .resources
        .streams
        .get("jobsWork")
        .expect("jobsWork stream resource");
    let sources = jobs_work.sources.as_ref().expect("jobsWork sources");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].from_alias, "jobs");
}

#[test]
fn builder_build_returns_validation_error_for_unknown_schema_ref() {
    let error = ContractManifestBuilder::new(
        "example.contract@v1",
        "Example Contract",
        "Example contract description.",
    )
    .schema(
        "Present",
        json!({ "type": "object", "properties": {}, "additionalProperties": false }),
    )
    .rpc(
        "Example.Call",
        trellis_contracts::rpc("v1", "rpc.v1.Example.Call", "Missing", "Present"),
    )
    .build()
    .expect_err("builder should reuse manifest schema validation");

    let message = error.to_string();
    assert!(message.contains("unknown schema"));
}

#[test]
fn builder_supports_owned_and_used_operations() {
    let manifest = ContractManifestBuilder::new(
        "example.operations@v1",
        "Example Operations",
        "Example operations manifest.",
    )
    .schema(
        "CaptureRequest",
        json!({ "type": "object", "properties": {}, "additionalProperties": false }),
    )
    .schema(
        "CaptureProgress",
        json!({ "type": "object", "properties": {}, "additionalProperties": false }),
    )
    .schema(
        "CaptureResult",
        json!({ "type": "object", "properties": {}, "additionalProperties": false }),
    )
    .use_ref(
        "billing",
        use_contract("billing@v1").with_operation_call(["Billing.Refund"]),
    )
    .operation(
        "Payments.Capture",
        trellis_contracts::operation(
            "v1",
            "operations.v1.Payments.Capture",
            "CaptureRequest",
            Some("CaptureProgress"),
            Some("CaptureResult"),
        )
        .with_call_capabilities(["payments.capture"])
        .with_read_capabilities(["payments.read"])
        .with_cancel_capabilities(["payments.cancel"])
        .cancel(true),
    )
    .build()
    .expect("builder should produce a valid operation manifest");

    assert!(manifest.uses.contains_key("billing"));
    assert!(manifest.operations.contains_key("Payments.Capture"));
    assert!(manifest
        .uses
        .get("billing")
        .and_then(|use_ref| use_ref.operations.as_ref())
        .is_some());
}

#[test]
fn builder_build_returns_validation_error_for_unknown_operation_schema_ref() {
    let error = ContractManifestBuilder::new(
        "example.operations@v1",
        "Example Operations",
        "Example operations manifest.",
    )
    .schema(
        "CaptureRequest",
        json!({ "type": "object", "properties": {}, "additionalProperties": false }),
    )
    .operation(
        "Payments.Capture",
        trellis_contracts::operation(
            "v1",
            "operations.v1.Payments.Capture",
            "CaptureRequest",
            Some("MissingProgress"),
            Some("MissingResult"),
        ),
    )
    .build()
    .expect_err("builder should reuse operation schema validation");

    let message = error.to_string();
    assert!(message.contains("operation"));
    assert!(message.contains("unknown schema"));
}

#[test]
fn builder_allows_unvalidated_build_for_staging() {
    let manifest = ContractManifestBuilder::new(
        "example.contract@v1",
        "Example Contract",
        "Example contract description.",
    )
    .rpc(
        "Example.Call",
        trellis_contracts::rpc("v1", "rpc.v1.Example.Call", "Missing", "Missing"),
    )
    .build_unvalidated();

    assert_eq!(manifest.rpc.len(), 1);
}
