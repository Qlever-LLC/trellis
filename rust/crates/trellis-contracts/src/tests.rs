use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::*;

fn unique_temp_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("trellis-contracts-{label}-{nanos}"))
}

#[test]
fn canonicalize_sorts_keys_and_matches_digest_vector() {
    let value = json!({"b": 1, "a": "x"});
    let canonical = canonicalize_json(&value).unwrap();
    assert_eq!(canonical, r#"{"a":"x","b":1}"#);
    assert_eq!(
        sha256_base64url(&canonical),
        "zasGfp876zLRJSz9Y-SSWS_sv1kbDQjK2yS7F_OGQkY"
    );
}

#[test]
fn canonicalize_matches_shared_conformance_vector() {
    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../conformance/canonical-json/vectors.json");
    let fixtures: Vec<Value> =
        serde_json::from_str(&fs::read_to_string(fixture_path).unwrap()).unwrap();

    for fixture in fixtures {
        let input = fixture.get("input").cloned().unwrap();
        let canonical = fixture.get("canonical").and_then(Value::as_str).unwrap();
        let digest = fixture.get("digest").and_then(Value::as_str).unwrap();

        assert_eq!(canonicalize_json(&input).unwrap(), canonical);
        assert_eq!(digest_json(&input).unwrap(), digest);
    }
}

#[test]
fn pack_trellis_owned_contracts_matches_shared_fixture() {
    let root = unique_temp_dir("trellis-owned-contracts");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("trellis.core@v1.json"),
        canonicalize_json(&json!({
            "format": "trellis.contract.v1",
            "id": "trellis.core@v1",
            "displayName": "Trellis Core",
            "description": "Trellis runtime RPCs available to all connected participants.",
            "kind": "service",
            "schemas": {
                "CatalogInput": {"type": "object", "properties": {}, "additionalProperties": false},
                "CatalogOutput": {"type": "object", "properties": {}, "additionalProperties": false}
            },
            "rpc": {
                "Trellis.Catalog": {
                    "version": "v1",
                    "subject": "rpc.v1.Trellis.Catalog",
                    "input": {"schema": "CatalogInput"},
                    "output": {"schema": "CatalogOutput"}
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        root.join("trellis.auth@v1.json"),
        canonicalize_json(&json!({
            "format": "trellis.contract.v1",
            "id": "trellis.auth@v1",
            "displayName": "Trellis Auth",
            "description": "Provide Trellis authentication, session, service install, and admin RPCs.",
            "kind": "service",
            "schemas": {
                "AuthConnectEvent": {"type": "object", "properties": {}, "additionalProperties": false}
            },
            "events": {
                "Auth.Connect": {
                    "version": "v1",
                    "subject": "events.v1.Auth.Connect",
                    "event": {"schema": "AuthConnectEvent"}
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let pack = pack_manifest_dir(&root).unwrap();
    let fixture = json!({
        "format": "trellis.catalog.v1",
        "contracts": [
            {
                "id": "trellis.auth@v1",
                "digest": pack.contracts[0].digest,
                "displayName": "Trellis Auth",
                "description": "Provide Trellis authentication, session, service install, and admin RPCs.",
                "kind": "service"
            },
            {
                "id": "trellis.core@v1",
                "digest": pack.contracts[1].digest,
                "displayName": "Trellis Core",
                "description": "Trellis runtime RPCs available to all connected participants.",
                "kind": "service"
            }
        ]
    });
    let packed = serde_json::to_value(pack.catalog).unwrap();

    assert_eq!(packed, fixture);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn manifest_validation_requires_display_metadata_fields() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.contract@v1",
        "description": "Example contract",
        "kind": "service"
    }))
    .expect_err("manifest without displayName should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("displayName"));
}

#[test]
fn manifest_validation_ignores_unknown_top_level_fields() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.contract@v1",
        "displayName": "Example Contract",
        "description": "Example contract",
        "kind": "service",
        "xFutureMetadata": { "hello": "world" }
    }))
    .expect("manifest with unknown top-level field should parse");

    assert_eq!(manifest.id, "example.contract@v1");
    let serialized = serde_json::to_value(&manifest).expect("serialize manifest");
    assert!(serialized.get("xFutureMetadata").is_none());
}

#[test]
fn packing_catalog_includes_manifest_metadata() {
    let root = unique_temp_dir("catalog-metadata");
    fs::create_dir_all(&root).expect("create temp dir");
    let manifest_path = root.join("example.contract@v1.json");
    fs::write(
        &manifest_path,
        serde_json::to_string(&json!({
            "format": "trellis.contract.v1",
            "id": "example.contract@v1",
            "displayName": "Example Contract",
            "description": "Example contract used in catalog tests.",
            "kind": "service",
            "rpc": {},
            "events": {},
            "subjects": {}
        }))
        .expect("serialize manifest"),
    )
    .expect("write manifest");

    let pack = pack_manifest_paths(&[manifest_path]).expect("pack manifests");
    assert_eq!(
        pack.catalog.contracts,
        vec![CatalogEntry {
            id: "example.contract@v1".to_string(),
            digest: pack.contracts[0].digest.clone(),
            display_name: "Example Contract".to_string(),
            description: "Example contract used in catalog tests.".to_string(),
            kind: "service".to_string(),
        }]
    );

    fs::remove_dir_all(root).expect("remove temp dir");
}

#[test]
fn embedded_schemas_match_shared_source_of_truth() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for schema_name in [
        "trellis.contract.v1.schema.json",
        "trellis.catalog.v1.schema.json",
    ] {
        let embedded = fs::read_to_string(root.join("schemas").join(schema_name)).unwrap();
        let shared = fs::read_to_string(
            root.join("../../../js/packages/contracts/schemas")
                .join(schema_name),
        )
        .unwrap();
        assert_eq!(embedded, shared, "schema drift detected for {schema_name}");
    }
}

#[test]
fn manifest_paths_fail_loudly_on_malformed_manifest_json() {
    let root = unique_temp_dir("malformed-manifest");
    fs::create_dir_all(&root).expect("create temp dir");
    fs::write(root.join("broken.contract@v1.json"), "{").expect("write malformed json");

    let error = manifest_paths_in_dir(&root).expect_err("malformed manifest should fail");
    assert!(matches!(error, ContractsError::Json(_)));

    fs::remove_dir_all(root).expect("remove temp dir");
}

#[test]
fn manifest_paths_only_select_contract_manifest_candidates() {
    let root = unique_temp_dir("manifest-filter");
    fs::create_dir_all(&root).expect("create temp dir");
    fs::write(root.join("deno.json"), "{\"name\":\"trellis\"}").expect("write deno json");
    let manifest_path = root.join("example.contract@v1.json");
    fs::write(
        &manifest_path,
        serde_json::to_string(&json!({
            "format": "trellis.contract.v1",
            "id": "example.contract@v1",
            "displayName": "Example Contract",
            "description": "Example contract used in filter tests.",
            "kind": "service"
        }))
        .expect("serialize manifest"),
    )
    .expect("write manifest");

    let paths = manifest_paths_in_dir(&root).expect("manifest paths should load");
    assert_eq!(paths, vec![manifest_path]);

    fs::remove_dir_all(root).expect("remove temp dir");
}

#[test]
fn manifest_parses_stream_resources() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.streams@v1",
        "displayName": "Example Streams",
        "description": "Expose stream resources",
        "kind": "service",
        "resources": {
            "streams": {
                "activity": {
                    "purpose": "Persist activity events",
                    "required": true,
                    "subjects": ["events.v1.Activity.Recorded"]
                }
            }
        }
    }))
    .expect("manifest with streams should parse");

    let streams = &manifest.resources.streams;
    assert_eq!(streams.len(), 1);
    let activity = streams.get("activity").expect("activity stream resource");
    assert_eq!(activity.purpose, "Persist activity events");
    assert_eq!(activity.required, Some(true));
    assert_eq!(
        activity.subjects,
        vec!["events.v1.Activity.Recorded".to_string()]
    );
    assert!(activity.retention.is_none());
    assert!(activity.sources.is_none());
}

#[test]
fn manifest_parses_owned_and_used_operations() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.operations@v1",
        "displayName": "Example Operations",
        "description": "Expose operations.",
        "kind": "service",
        "schemas": {
            "CaptureRequest": {"type": "object", "properties": {}, "additionalProperties": false},
            "CaptureProgress": {"type": "object", "properties": {}, "additionalProperties": false},
            "CaptureResult": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        "uses": {
            "billing": {
                "contract": "billing@v1",
                "operations": {
                    "call": ["Billing.Refund"]
                }
            }
        },
        "operations": {
            "Payments.Capture": {
                "version": "v1",
                "subject": "operations.v1.Payments.Capture",
                "input": {"schema": "CaptureRequest"},
                "progress": {"schema": "CaptureProgress"},
                "output": {"schema": "CaptureResult"},
                "cancel": true,
                "capabilities": {
                    "call": ["payments.capture"],
                    "read": ["payments.read"],
                    "cancel": ["payments.cancel"]
                }
            }
        }
    }))
    .expect("manifest with operations should parse");

    let op = manifest
        .operations
        .get("Payments.Capture")
        .expect("owned operation should exist");
    assert_eq!(op.version, "v1");
    assert_eq!(op.subject, "operations.v1.Payments.Capture");
    assert_eq!(op.input.schema, "CaptureRequest");
    assert_eq!(
        op.progress.as_ref().map(|value| value.schema.as_str()),
        Some("CaptureProgress")
    );
    assert_eq!(
        op.output.as_ref().map(|value| value.schema.as_str()),
        Some("CaptureResult")
    );
    assert_eq!(op.cancel, Some(true));
    let capabilities = op.capabilities.as_ref().expect("operation capabilities");
    assert_eq!(
        capabilities.call.as_ref(),
        Some(&vec!["payments.capture".to_string()])
    );
    assert_eq!(
        capabilities.read.as_ref(),
        Some(&vec!["payments.read".to_string()])
    );
    assert_eq!(
        capabilities.cancel.as_ref(),
        Some(&vec!["payments.cancel".to_string()])
    );

    let use_ref = manifest
        .uses
        .get("billing")
        .expect("billing use should exist");
    assert_eq!(
        use_ref
            .operations
            .as_ref()
            .and_then(|value| value.call.as_ref())
            .cloned(),
        Some(vec!["Billing.Refund".to_string()])
    );
}

#[test]
fn manifest_validation_rejects_unknown_operation_schema_refs() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.operations@v1",
        "displayName": "Example Operations",
        "description": "Expose operations.",
        "kind": "service",
        "schemas": {
            "CaptureRequest": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        "operations": {
            "Payments.Capture": {
                "version": "v1",
                "subject": "operations.v1.Payments.Capture",
                "input": {"schema": "CaptureRequest"},
                "progress": {"schema": "MissingProgress"},
                "output": {"schema": "MissingResult"}
            }
        }
    }))
    .expect_err("manifest with missing operation schemas should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("operation"));
    assert!(details.contains("unknown schema"));
}

#[test]
fn manifest_parses_rich_stream_resources_with_sources() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.streams@v1",
        "displayName": "Example Streams",
        "description": "Expose stream resources",
        "kind": "service",
        "resources": {
            "streams": {
                "jobs": {
                    "purpose": "Store append-only job lifecycle events",
                    "required": true,
                    "subjects": ["trellis.jobs.>"],
                    "retention": "limits",
                    "storage": "file",
                    "numReplicas": 3,
                    "discard": "old",
                    "maxMsgs": -1,
                    "maxBytes": -1,
                    "maxAgeMs": 0
                },
                "jobsWork": {
                    "purpose": "Store sourced work-queue messages",
                    "required": true,
                    "subjects": ["trellis.work.>"],
                    "retention": "workqueue",
                    "storage": "file",
                    "numReplicas": 3,
                    "sources": [
                        {
                            "fromAlias": "jobs",
                            "filterSubject": "trellis.jobs.*.*.*.created",
                            "subjectTransformDest": "trellis.work.$1.$2"
                        }
                    ]
                }
            }
        }
    }))
    .expect("manifest with rich streams should parse");

    let jobs = manifest
        .resources
        .streams
        .get("jobs")
        .expect("jobs stream resource");
    assert_eq!(jobs.retention.as_deref(), Some("limits"));
    assert_eq!(jobs.storage.as_deref(), Some("file"));
    assert_eq!(jobs.num_replicas, Some(3));
    assert_eq!(jobs.discard.as_deref(), Some("old"));
    assert_eq!(jobs.max_msgs, Some(-1));
    assert_eq!(jobs.max_bytes, Some(-1));
    assert_eq!(jobs.max_age_ms, Some(0));

    let jobs_work = manifest
        .resources
        .streams
        .get("jobsWork")
        .expect("jobsWork stream resource");
    let sources = jobs_work.sources.as_ref().expect("jobsWork sources");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].from_alias, "jobs");
    assert_eq!(
        sources[0].filter_subject.as_deref(),
        Some("trellis.jobs.*.*.*.created")
    );
    assert_eq!(
        sources[0].subject_transform_dest.as_deref(),
        Some("trellis.work.$1.$2")
    );
}

#[test]
fn manifest_validation_rejects_empty_stream_subjects() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.streams@v1",
        "displayName": "Example Streams",
        "description": "Expose stream resources",
        "kind": "service",
        "resources": {
            "streams": {
                "activity": {
                    "purpose": "Persist activity events",
                    "subjects": []
                }
            }
        }
    }))
    .expect_err("manifest with empty stream subjects should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("subjects"));
}

#[test]
fn manifest_validation_rejects_unknown_stream_source_alias() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.streams@v1",
        "displayName": "Example Streams",
        "description": "Expose stream resources",
        "kind": "service",
        "resources": {
            "streams": {
                "jobsWork": {
                    "purpose": "Store sourced work-queue messages",
                    "subjects": ["trellis.work.>"],
                    "sources": [
                        {
                            "fromAlias": "jobs",
                            "filterSubject": "trellis.jobs.*.*.*.created",
                            "subjectTransformDest": "trellis.work.$1.$2"
                        }
                    ]
                }
            }
        }
    }))
    .expect_err("manifest with unknown stream source alias should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("fromAlias"));
    assert!(details.contains("jobs"));
}
