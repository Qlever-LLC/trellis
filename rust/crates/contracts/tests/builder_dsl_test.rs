use serde_json::json;
use trellis_contracts::{
    schema_ref, state, store, use_contract, ContractCapabilityMetadata, ContractKind,
    ContractManifestBuilder, ContractStateKind, ContractsError, CONTRACT_FORMAT_V1,
};

#[test]
fn builder_minimal_manifest_defaults_format_and_validates() {
    let manifest = ContractManifestBuilder::new(
        "example.contract@v1",
        "Example Contract",
        "Example contract description.",
        ContractKind::Service,
    )
    .build()
    .expect("builder should produce a valid minimal manifest");

    assert_eq!(manifest.format, CONTRACT_FORMAT_V1);
    assert_eq!(manifest.id, "example.contract@v1");
}

#[test]
fn builder_adds_baseline_health_for_service_contracts() {
    let manifest = ContractManifestBuilder::new(
        "example.service@v1",
        "Example Service",
        "Example service description.",
        ContractKind::Service,
    )
    .build()
    .expect("builder should produce a valid service manifest");

    let health = manifest.uses.get("health").expect("baseline health use");
    assert_eq!(health.contract, "trellis.health@v1");
    assert_eq!(
        health
            .events
            .as_ref()
            .and_then(|events| events.publish.as_ref()),
        Some(&vec!["Health.Heartbeat".to_string()])
    );

    let serialized = serde_json::to_value(&manifest).expect("serialize manifest");
    assert_eq!(
        serialized["uses"]["required"]["health"]["contract"],
        json!("trellis.health@v1")
    );
}

#[test]
fn builder_does_not_add_baseline_health_to_health_contract_itself() {
    let manifest = ContractManifestBuilder::new(
        "trellis.health@v1",
        "Trellis Health",
        "Expose shared Trellis heartbeat events.",
        ContractKind::Service,
    )
    .build()
    .expect("health contract should build without self-use");

    assert!(!manifest.uses.contains_key("health"));
}

#[test]
fn builder_adds_baseline_health_for_device_contracts_with_state() {
    let manifest = ContractManifestBuilder::new(
        "example.device@v1",
        "Example Device",
        "Example device manifest.",
        ContractKind::Device,
    )
    .schema("Preferences", json!({ "type": "object", "properties": {} }))
    .state(
        "preferences",
        state(ContractStateKind::Value, "Preferences"),
    )
    .build()
    .expect("builder should produce a valid device manifest");

    assert!(manifest.uses.contains_key("health"));
}

#[test]
fn builder_merges_explicit_health_use_with_baseline_heartbeat() {
    let manifest = ContractManifestBuilder::new(
        "example.explicit-health@v1",
        "Example Explicit Health",
        "Example explicit health manifest.",
        ContractKind::Service,
    )
    .use_ref(
        "health",
        use_contract("trellis.health@v1").with_event_subscribe(["Health.Heartbeat"]),
    )
    .build()
    .expect("builder should produce a valid service manifest");

    let events = manifest.uses["health"]
        .events
        .as_ref()
        .expect("health events");
    assert_eq!(events.publish, Some(vec!["Health.Heartbeat".to_string()]));
    assert_eq!(events.subscribe, Some(vec!["Health.Heartbeat".to_string()]));
}

#[test]
fn builder_preserves_event_publish_and_subscribe_on_same_use() {
    let manifest = ContractManifestBuilder::new(
        "example.events-agent@v1",
        "Example Events Agent",
        "Example events agent manifest.",
        ContractKind::Agent,
    )
    .use_ref(
        "events",
        use_contract("example.events@v1")
            .with_event_publish(["Example.Changed"])
            .with_event_subscribe(["Example.Changed"]),
    )
    .build()
    .expect("builder should preserve both event permissions");

    let events = manifest.uses["events"].events.as_ref().expect("events use");
    assert_eq!(events.publish, Some(vec!["Example.Changed".to_string()]));
    assert_eq!(events.subscribe, Some(vec!["Example.Changed".to_string()]));
}

#[test]
fn builder_returns_error_for_conflicting_implicit_health_alias() {
    let error = ContractManifestBuilder::new(
        "example.bad-health@v1",
        "Example Bad Health",
        "Example bad health manifest.",
        ContractKind::Service,
    )
    .use_ref("health", use_contract("example.health@v1"))
    .build()
    .expect_err("conflicting implicit health alias should fail");

    let ContractsError::ContractUseConflict {
        alias,
        existing_contract,
        new_contract,
    } = error
    else {
        panic!("expected contract use conflict error");
    };
    assert_eq!(alias, "health");
    assert_eq!(existing_contract, "example.health@v1");
    assert_eq!(new_contract, "trellis.health@v1");
}

#[test]
fn builder_supports_uses_rpc_kv_store_and_job_queue_resources() {
    let manifest = ContractManifestBuilder::new(
        "example.jobs@v1",
        "Example Jobs",
        "Example jobs manifest.",
        ContractKind::Service,
    )
    .schema(
        "HealthRequest",
        json!({ "type": "object", "properties": {} }),
    )
    .schema(
        "HealthResponse",
        json!({
            "type": "object",
            "required": ["ok"],
            "properties": {"ok": {"type": "boolean"}}
        }),
    )
    .schema(
        "CacheState",
        json!({
            "type": "object",
            "required": ["status"],
            "properties": {"status": {"type": "string"}}
        }),
    )
    .use_ref(
        "core",
        use_contract("trellis.core@v1").with_rpc_call(["Trellis.Catalog"]),
    )
    .capability(
        "jobs.admin.read",
        ContractCapabilityMetadata {
            display_name: "Read jobs".to_string(),
            description: "View jobs.".to_string(),
            consequence: None,
        },
    )
    .rpc(
        "Jobs.Health",
        trellis_contracts::rpc(
            "v1",
            "rpc.v1.Jobs.Health",
            "HealthRequest",
            "HealthResponse",
        )
        .with_call_capabilities(["jobs.admin.read", "service"])
        .with_error_types(["UnexpectedError"]),
    )
    .kv_resource(
        "cacheState",
        trellis_contracts::kv("Store projected cache state", "CacheState")
            .required(true)
            .history(1)
            .ttl_ms(0),
    )
    .store_resource("uploads", store("Temporary uploaded files"))
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
    assert!(manifest
        .capabilities
        .contains_key("example.jobs::jobs.admin.read"));
    assert_eq!(
        manifest
            .rpc
            .get("Jobs.Health")
            .and_then(|rpc| rpc.capabilities.as_ref())
            .and_then(|capabilities| capabilities.call.as_ref()),
        Some(&vec![
            "example.jobs::jobs.admin.read".to_string(),
            "service".to_string()
        ])
    );
    assert!(manifest.resources.kv.contains_key("cacheState"));
    assert_eq!(
        manifest.resources.kv["cacheState"].schema.schema,
        "CacheState"
    );
    assert!(manifest.resources.store.contains_key("uploads"));
    assert!(manifest.jobs.contains_key("document-process"));
}

#[test]
fn builder_supports_contract_local_error_declarations() {
    let manifest = ContractManifestBuilder::new(
        "example.errors@v1",
        "Example Errors",
        "Example error manifest.",
        ContractKind::Service,
    )
    .schema(
        "NotFoundErrorData",
        json!({
            "type": "object",
            "required": ["id", "type", "message", "resource"],
            "properties": {
                "id": { "type": "string" },
                "type": { "type": "string", "const": "NotFoundError" },
                "message": { "type": "string" },
                "resource": { "type": "string" },
                "context": { "type": "object", "patternProperties": { "^.*$": {} } },
                "traceId": { "type": "string" }
            }
        }),
    )
    .error("NotFoundError", "NotFoundError", "NotFoundErrorData")
    .build()
    .expect("builder should produce a valid manifest");

    let error = manifest
        .errors
        .get("NotFoundError")
        .expect("declared error");
    assert_eq!(error.error_type, "NotFoundError");
    assert_eq!(
        error.schema.as_ref().map(|schema| schema.schema.as_str()),
        Some("NotFoundErrorData")
    );
}

#[test]
fn builder_supports_store_resources() {
    let manifest = ContractManifestBuilder::new(
        "example.store@v1",
        "Example Store",
        "Example store manifest.",
        ContractKind::Service,
    )
    .store_resource(
        "uploads",
        store("Temporary uploaded files")
            .required(true)
            .ttl_ms(0)
            .max_object_bytes(1_048_576)
            .max_total_bytes(2_097_152),
    )
    .build()
    .expect("builder should produce a valid manifest");

    let uploads = manifest
        .resources
        .store
        .get("uploads")
        .expect("uploads store resource");
    assert_eq!(uploads.purpose, "Temporary uploaded files");
    assert_eq!(uploads.required, Some(true));
    assert_eq!(uploads.ttl_ms, Some(0));
    assert_eq!(uploads.max_object_bytes, Some(1_048_576));
    assert_eq!(uploads.max_total_bytes, Some(2_097_152));
}

#[test]
fn builder_supports_state_stores_exports_and_events() {
    let manifest = ContractManifestBuilder::new(
        "example.device@v1",
        "Example Device",
        "Example device manifest.",
        ContractKind::Device,
    )
    .schema("Preferences", json!({ "type": "object", "properties": {} }))
    .schema("Changed", json!({ "type": "object", "properties": {} }))
    .export_schema("Preferences")
    .state(
        "preferences",
        state(ContractStateKind::Value, "Preferences").state_version("preferences.v1"),
    )
    .event(
        "Preferences.Changed",
        trellis_contracts::event("v1", "events.v1.Preferences.Changed", "Changed"),
    )
    .build()
    .expect("builder should produce a valid state manifest");

    assert_eq!(manifest.exports.schemas, vec!["Preferences"]);
    assert_eq!(manifest.state["preferences"].schema.schema, "Preferences");
    assert!(manifest.events.contains_key("Preferences.Changed"));
}

#[test]
fn builder_build_returns_validation_error_for_unknown_state_schema_ref() {
    let error = ContractManifestBuilder::new(
        "example.device@v1",
        "Example Device",
        "Example device manifest.",
        ContractKind::Device,
    )
    .state("preferences", state(ContractStateKind::Value, "Missing"))
    .build()
    .expect_err("builder should reuse state schema validation");

    let message = error.to_string();
    assert!(message.contains("state"));
    assert!(message.contains("unknown schema"));
}

#[test]
fn builder_build_returns_validation_error_for_unknown_schema_ref() {
    let error = ContractManifestBuilder::new(
        "example.contract@v1",
        "Example Contract",
        "Example contract description.",
        ContractKind::Service,
    )
    .schema("Present", json!({ "type": "object", "properties": {} }))
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
fn builder_build_returns_validation_error_for_unknown_kv_schema_ref() {
    let error = ContractManifestBuilder::new(
        "example.kv@v1",
        "Example KV",
        "Example kv manifest.",
        ContractKind::Service,
    )
    .kv_resource(
        "cacheState",
        trellis_contracts::kv("Store projected cache state", "MissingState"),
    )
    .build()
    .expect_err("builder should reuse kv schema validation");

    let message = error.to_string();
    assert!(message.contains("resources.kv"));
    assert!(message.contains("unknown schema"));
}

#[test]
fn builder_supports_owned_and_used_operations() {
    let manifest = ContractManifestBuilder::new(
        "example.operations@v1",
        "Example Operations",
        "Example operations manifest.",
        ContractKind::Service,
    )
    .schema(
        "CaptureRequest",
        json!({ "type": "object", "properties": {} }),
    )
    .schema(
        "CaptureProgress",
        json!({ "type": "object", "properties": {} }),
    )
    .schema(
        "CaptureResult",
        json!({ "type": "object", "properties": {} }),
    )
    .use_ref(
        "billing",
        use_contract("billing@v1").with_operation_call(["Billing.Refund"]),
    )
    .capability(
        "payments.capture",
        trellis_contracts::ContractCapabilityMetadata {
            display_name: "Capture payments".to_string(),
            description: "Start payment capture operations.".to_string(),
            consequence: None,
        },
    )
    .capability(
        "payments.read",
        trellis_contracts::ContractCapabilityMetadata {
            display_name: "Read payments".to_string(),
            description: "Read payment operation status.".to_string(),
            consequence: None,
        },
    )
    .capability(
        "payments.cancel",
        trellis_contracts::ContractCapabilityMetadata {
            display_name: "Cancel payments".to_string(),
            description: "Cancel payment operations.".to_string(),
            consequence: None,
        },
    )
    .capability(
        "payments.control",
        trellis_contracts::ContractCapabilityMetadata {
            display_name: "Control payments".to_string(),
            description: "Submit payment operation control signals.".to_string(),
            consequence: None,
        },
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
        .with_observe_capabilities(["payments.read"])
        .with_cancel_capabilities(["payments.cancel"])
        .with_control_capabilities(["payments.control"])
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
    assert_eq!(
        manifest
            .operations
            .get("Payments.Capture")
            .and_then(|operation| operation.capabilities.as_ref())
            .and_then(|capabilities| capabilities.control.as_ref()),
        Some(&vec!["example.operations::payments.control".to_string()])
    );
}

#[test]
fn builder_build_returns_validation_error_for_unknown_operation_schema_ref() {
    let error = ContractManifestBuilder::new(
        "example.operations@v1",
        "Example Operations",
        "Example operations manifest.",
        ContractKind::Service,
    )
    .schema(
        "CaptureRequest",
        json!({ "type": "object", "properties": {} }),
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
        ContractKind::Service,
    )
    .rpc(
        "Example.Call",
        trellis_contracts::rpc("v1", "rpc.v1.Example.Call", "Missing", "Missing"),
    )
    .build_unvalidated();

    assert_eq!(manifest.rpc.len(), 1);
}
