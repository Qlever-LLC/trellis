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
fn contract_kind_serializes_and_deserializes_device() {
    let serialized = serde_json::to_value(ContractKind::Device).expect("serialize contract kind");
    assert_eq!(serialized, Value::String("device".to_string()));

    let deserialized: ContractKind = serde_json::from_value(Value::String("device".to_string()))
        .expect("deserialize contract kind");
    assert_eq!(deserialized, ContractKind::Device);
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
fn contract_digest_matches_shared_conformance_vector() {
    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../conformance/contract-digest/vectors.json");
    let fixtures: Vec<Value> =
        serde_json::from_str(&fs::read_to_string(fixture_path).unwrap()).unwrap();

    for fixture in fixtures {
        let name = fixture.get("name").and_then(Value::as_str).unwrap();
        let input = fixture.get("input").cloned().unwrap();
        let digest = fixture.get("digest").and_then(Value::as_str).unwrap();

        assert_eq!(digest_contract_value(&input).unwrap(), digest, "{name}");
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
            "description": "Provide Trellis authentication, session, deployment, and admin RPCs.",
            "kind": "service",
            "schemas": {
                "AuthConnectionsOpenedEvent": {"type": "object", "properties": {}, "additionalProperties": false}
            },
            "events": {
                "Auth.Connections.Opened": {
                    "version": "v1",
                    "subject": "events.v1.Auth.Connections.Opened",
                    "event": {"schema": "AuthConnectionsOpenedEvent"}
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
                "description": "Provide Trellis authentication, session, deployment, and admin RPCs."
            },
            {
                "id": "trellis.core@v1",
                "digest": pack.contracts[1].digest,
                "displayName": "Trellis Core",
                "description": "Trellis runtime RPCs available to all connected participants."
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
        "kind": "service",
        "description": "Example contract"
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
            "events": {}
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
        }]
    );

    fs::remove_dir_all(root).expect("remove temp dir");
}

#[test]
fn loaded_manifest_digest_uses_contract_identity_projection() {
    let root = unique_temp_dir("identity-digest");
    fs::create_dir_all(&root).expect("create temp dir");
    let manifest_path = root.join("example.contract@v1.json");
    let mut manifest = json!({
        "format": "trellis.contract.v1",
        "id": "example.contract@v1",
        "displayName": "Example Contract",
        "description": "Example contract used in digest tests.",
        "kind": "service",
        "schemas": {
            "PingInput": {"type": "object", "properties": {}, "additionalProperties": false},
            "PingOutput": {"type": "object", "properties": {}, "additionalProperties": false},
            "Unused": {"type": "object", "properties": {"ignored": {"type": "string"}}, "additionalProperties": false}
        },
        "rpc": {
            "Example.Ping": {
                "version": "v1",
                "subject": "rpc.v1.Example.Ping",
                "input": {"schema": "PingInput"},
                "output": {"schema": "PingOutput"}
            }
        }
    });
    fs::write(&manifest_path, serde_json::to_string(&manifest).unwrap()).expect("write manifest");
    let digest = load_manifest(&manifest_path).expect("load manifest").digest;

    manifest["displayName"] = json!("Renamed Contract");
    manifest["description"] = json!("Changed display metadata.");
    manifest["schemas"]["Unused"] = json!({
        "type": "object",
        "properties": {"stillIgnored": {"type": "number"}},
        "additionalProperties": false
    });
    fs::write(&manifest_path, serde_json::to_string(&manifest).unwrap()).expect("rewrite manifest");
    let metadata_only_digest = load_manifest(&manifest_path)
        .expect("load metadata-only manifest")
        .digest;
    assert_eq!(metadata_only_digest, digest);

    manifest["schemas"]["PingOutput"] = json!({
        "type": "object",
        "required": ["pong"],
        "properties": {"pong": {"type": "boolean"}},
        "additionalProperties": false
    });
    fs::write(&manifest_path, serde_json::to_string(&manifest).unwrap()).expect("rewrite manifest");
    let changed_interface_digest = load_manifest(&manifest_path)
        .expect("load interface-changed manifest")
        .digest;
    assert_ne!(changed_interface_digest, digest);

    fs::remove_dir_all(root).expect("remove temp dir");
}

#[test]
fn public_contract_digest_helpers_match_loaded_manifest_and_include_capabilities() {
    let root = unique_temp_dir("public-digest-helpers");
    fs::create_dir_all(&root).expect("create temp dir");
    let manifest_path = root.join("example.capabilities@v1.json");
    let mut manifest = json!({
        "format": "trellis.contract.v1",
        "id": "example.capabilities@v1",
        "displayName": "Capabilities",
        "description": "Contract with capability metadata.",
        "kind": "service",
        "capabilities": {
            "example.capabilities::read": {
                "displayName": "Read",
                "description": "Read example data."
            }
        }
    });
    let manifest_json = serde_json::to_string(&manifest).expect("manifest json");
    fs::write(&manifest_path, &manifest_json).expect("write manifest");

    let loaded = load_manifest(&manifest_path).expect("load manifest");
    assert_eq!(
        digest_contract_json(&manifest_json).expect("digest json"),
        loaded.digest
    );
    assert_eq!(
        digest_contract_value(&manifest).expect("digest value"),
        loaded.digest
    );

    manifest["capabilities"]["example.capabilities::read"]["description"] =
        json!("Read example data with changed approval meaning.");
    assert_ne!(
        digest_contract_value(&manifest).expect("changed digest"),
        loaded.digest
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
            root.join("../../../js/packages/trellis/contract_support/schemas")
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
fn manifest_parses_kv_resources_with_schema() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.kv@v1",
        "displayName": "Example KV",
        "description": "Expose kv resources",
        "kind": "service",
        "schemas": {
            "CacheState": {
                "type": "object",
                "required": ["status"],
                "properties": {"status": {"type": "string"}},
                "additionalProperties": false
            }
        },
        "resources": {
            "kv": {
                "cacheState": {
                    "purpose": "Store projected cache state",
                    "schema": {"schema": "CacheState"},
                    "required": true,
                    "history": 1,
                    "ttlMs": 0
                }
            }
        }
    }))
    .expect("manifest with kv resources should parse");

    let cache_state = manifest
        .resources
        .kv
        .get("cacheState")
        .expect("cacheState kv resource");
    assert_eq!(cache_state.purpose, "Store projected cache state");
    assert_eq!(cache_state.schema.schema, "CacheState");
    assert_eq!(cache_state.required, Some(true));
    assert_eq!(cache_state.history, Some(1));
    assert_eq!(cache_state.ttl_ms, Some(0));
}

#[test]
fn manifest_validation_rejects_unknown_kv_schema_refs() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.kv@v1",
        "displayName": "Example KV",
        "description": "Expose kv resources",
        "kind": "service",
        "resources": {
            "kv": {
                "cacheState": {
                    "purpose": "Store projected cache state",
                    "schema": {"schema": "MissingState"}
                }
            }
        }
    }))
    .expect_err("manifest with missing kv schema should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("resources.kv"));
    assert!(details.contains("unknown schema"));
}

#[test]
fn manifest_validation_rejects_stream_resources() {
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
                    "required": true,
                    "subjects": ["events.v1.Activity.Recorded"]
                }
            }
        }
    }))
    .expect_err("manifest with stream resources should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("resources"));
    assert!(details.contains("streams"));
}

#[test]
fn manifest_parses_store_resources() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.store@v1",
        "displayName": "Example Store",
        "description": "Expose store resources",
        "kind": "service",
        "resources": {
            "store": {
                "uploads": {
                    "purpose": "Temporary uploaded files",
                    "required": true,
                    "ttlMs": 0,
                    "maxObjectBytes": 1048576,
                    "maxTotalBytes": 2097152
                }
            }
        }
    }))
    .expect("manifest with store resources should parse");

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
                "transfer": {
                    "direction": "send",
                    "store": "uploads",
                    "key": "/key",
                    "contentType": "/contentType",
                    "expiresInMs": 60000
                },
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
    let transfer = op.transfer.as_ref().expect("operation transfer");
    assert_eq!(transfer.direction, ContractOperationTransferDirection::Send);
    assert_eq!(transfer.store, "uploads");
    assert_eq!(transfer.key, "/key");
    assert_eq!(transfer.content_type.as_deref(), Some("/contentType"));
    assert_eq!(transfer.expires_in_ms, Some(60_000));
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
fn manifest_parses_explicit_rpc_receive_transfer() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.rpc-transfer@v1",
        "displayName": "Example RPC Transfer",
        "description": "Expose receive transfer grant RPCs.",
        "kind": "service",
        "schemas": {
            "DownloadRequest": {"type": "object", "properties": {}, "additionalProperties": false},
            "DownloadResponse": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        "rpc": {
            "Evidence.Download": {
                "version": "v1",
                "subject": "rpc.v1.Evidence.Download",
                "input": {"schema": "DownloadRequest"},
                "output": {"schema": "DownloadResponse"},
                "transfer": {"direction": "receive"}
            }
        }
    }))
    .expect("manifest with RPC receive transfer should parse");

    let rpc = manifest
        .rpc
        .get("Evidence.Download")
        .expect("owned RPC should exist");
    let transfer = rpc.transfer.as_ref().expect("RPC transfer");
    assert_eq!(transfer.direction, ContractRpcTransferDirection::Receive);
}

#[test]
fn manifest_parses_top_level_feeds() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.feeds@v1",
        "displayName": "Example Feeds",
        "description": "Expose queryable feeds.",
        "kind": "service",
        "schemas": {
            "ActivityFeedInput": {"type": "object", "properties": {}, "additionalProperties": false},
            "ActivityFeedEvent": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        "feeds": {
            "Activity.Feed": {
                "version": "v1",
                "subject": "feeds.v1.Activity.Feed",
                "input": {"schema": "ActivityFeedInput"},
                "event": {"schema": "ActivityFeedEvent"},
                "capabilities": {
                    "subscribe": ["activity.feed.subscribe"]
                }
            }
        }
    }))
    .expect("manifest with feeds should parse");

    let feed = manifest
        .feeds
        .get("Activity.Feed")
        .expect("owned feed should exist");
    assert_eq!(feed.version, "v1");
    assert_eq!(feed.subject, "feeds.v1.Activity.Feed");
    assert_eq!(feed.input.schema, "ActivityFeedInput");
    assert_eq!(feed.event.schema, "ActivityFeedEvent");
    assert_eq!(
        feed.capabilities
            .as_ref()
            .and_then(|value| value.subscribe.as_ref()),
        Some(&vec!["activity.feed.subscribe".to_string()])
    );
}

#[test]
fn manifest_parses_used_feed_subscriptions() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.feed-client@v1",
        "displayName": "Example Feed Client",
        "description": "Subscribe to queryable feeds.",
        "kind": "service",
        "uses": {
            "activity": {
                "contract": "activity@v1",
                "feeds": {
                    "subscribe": ["Activity.Feed"]
                }
            }
        }
    }))
    .expect("manifest with used feeds should parse");

    let use_ref = manifest
        .uses
        .get("activity")
        .expect("activity use should exist");
    assert_eq!(
        use_ref
            .feeds
            .as_ref()
            .and_then(|value| value.subscribe.as_ref())
            .cloned(),
        Some(vec!["Activity.Feed".to_string()])
    );
}

#[test]
fn manifest_parses_grouped_required_and_optional_uses() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.grouped-client@v1",
        "displayName": "Example Grouped Client",
        "description": "Use required and optional dependencies.",
        "kind": "service",
        "uses": {
            "required": {
                "billing": {
                    "contract": "billing@v1",
                    "rpc": {"call": ["Billing.Charge"]}
                }
            },
            "optional": {
                "activity": {
                    "contract": "activity@v1",
                    "feeds": {"subscribe": ["Activity.Feed"]}
                }
            }
        }
    }))
    .expect("manifest with grouped uses should parse");

    let billing = manifest.uses.get("billing").expect("required use");
    assert_eq!(billing.contract, "billing@v1");
    assert_eq!(
        billing.rpc.as_ref().and_then(|rpc| rpc.call.as_ref()),
        Some(&vec!["Billing.Charge".to_string()])
    );

    let activity = manifest.uses.get("activity").expect("optional use");
    assert_eq!(activity.contract, "activity@v1");
    assert_eq!(
        activity
            .feeds
            .as_ref()
            .and_then(|feeds| feeds.subscribe.as_ref()),
        Some(&vec!["Activity.Feed".to_string()])
    );
    assert!(manifest.uses.required().contains_key("billing"));
    assert!(manifest.uses.optional().contains_key("activity"));
}

#[test]
fn grouped_required_uses_take_precedence_over_duplicate_optional_aliases() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.duplicate-uses@v1",
        "displayName": "Example Duplicate Uses",
        "description": "Declare the same alias as required and optional.",
        "kind": "service",
        "uses": {
            "required": {
                "billing": {
                    "contract": "billing@v1",
                    "rpc": {"call": ["Billing.Charge"]}
                }
            },
            "optional": {
                "billing": {
                    "contract": "billing@v1",
                    "events": {"subscribe": ["Billing.Changed"]}
                }
            }
        }
    }))
    .expect("manifest with duplicate grouped alias should parse");

    let billing = manifest.uses.get("billing").expect("required use");
    assert_eq!(billing.contract, "billing@v1");
    assert_eq!(
        billing.rpc.as_ref().and_then(|rpc| rpc.call.as_ref()),
        Some(&vec!["Billing.Charge".to_string()])
    );
    assert_eq!(manifest.uses.iter().count(), 1);
}

#[test]
fn contract_digest_treats_legacy_flat_uses_as_grouped_required() {
    let legacy = json!({
        "format": "trellis.contract.v1",
        "id": "example.uses-digest@v1",
        "displayName": "Uses Digest",
        "description": "Compare uses layouts.",
        "kind": "service",
        "uses": {
            "billing": {
                "contract": "billing@v1",
                "rpc": {"call": ["Billing.Charge", "Billing.Refund"]}
            }
        }
    });
    let grouped = json!({
        "format": "trellis.contract.v1",
        "id": "example.uses-digest@v1",
        "displayName": "Uses Digest",
        "description": "Compare uses layouts.",
        "kind": "service",
        "uses": {
            "required": {
                "billing": {
                    "contract": "billing@v1",
                    "rpc": {"call": ["Billing.Charge", "Billing.Refund"]}
                }
            }
        }
    });

    assert_eq!(
        digest_contract_value(&legacy).expect("legacy digest"),
        digest_contract_value(&grouped).expect("grouped digest")
    );
}

#[test]
fn contract_digest_keeps_legacy_flat_aliases_named_required() {
    let manifest = json!({
        "format": "trellis.contract.v1",
        "id": "example.required-alias@v1",
        "displayName": "Required Alias",
        "description": "Legacy alias name overlaps grouped uses.",
        "kind": "service",
        "uses": {
            "required": {
                "contract": "required@v1",
                "rpc": {"call": ["Required.Ping"]}
            }
        }
    });
    let projected = project_contract_digest_manifest(&manifest);

    assert_eq!(
        projected["uses"]["required"]["contract"],
        json!("required@v1")
    );
}

#[test]
fn contract_digest_keeps_grouped_aliases_named_contract() {
    let manifest = json!({
        "format": "trellis.contract.v1",
        "id": "example.contract-alias@v1",
        "displayName": "Contract Alias",
        "description": "Grouped alias name overlaps use-ref contract field.",
        "kind": "service",
        "uses": {
            "required": {
                "contract": {
                    "contract": "required@v1",
                    "rpc": {"call": ["Required.Ping"]}
                }
            },
            "optional": {
                "activity": {
                    "contract": "activity@v1",
                    "feeds": {"subscribe": ["Activity.Feed"]}
                }
            }
        }
    });
    let projected = project_contract_digest_manifest(&manifest);

    assert_eq!(
        projected["uses"]["required"]["contract"]["contract"],
        json!("required@v1")
    );
    assert_eq!(
        projected["uses"]["optional"]["activity"]["feeds"]["subscribe"],
        json!(["Activity.Feed"])
    );
}

#[test]
fn contract_digest_ignores_duplicate_optional_aliases_when_required() {
    let required = json!({
        "format": "trellis.contract.v1",
        "id": "example.duplicate-digest@v1",
        "displayName": "Duplicate Digest",
        "description": "Required aliases take precedence.",
        "kind": "service",
        "uses": {
            "required": {
                "billing": {
                    "contract": "billing@v1",
                    "rpc": {"call": ["Billing.Charge"]}
                }
            }
        }
    });
    let duplicate = json!({
        "format": "trellis.contract.v1",
        "id": "example.duplicate-digest@v1",
        "displayName": "Duplicate Digest",
        "description": "Required aliases take precedence.",
        "kind": "service",
        "uses": {
            "required": {
                "billing": {
                    "contract": "billing@v1",
                    "rpc": {"call": ["Billing.Charge"]}
                }
            },
            "optional": {
                "billing": {
                    "contract": "billing@v1",
                    "events": {"subscribe": ["Billing.Changed"]}
                }
            }
        }
    });

    assert_eq!(
        digest_contract_value(&required).expect("required digest"),
        digest_contract_value(&duplicate).expect("duplicate digest")
    );
}

#[test]
fn contract_digest_includes_sorted_optional_uses_and_feed_subscriptions() {
    let optional = json!({
        "format": "trellis.contract.v1",
        "id": "example.optional-uses-digest@v1",
        "displayName": "Optional Uses Digest",
        "description": "Optional dependencies affect identity.",
        "kind": "service",
        "uses": {
            "optional": {
                "activity": {
                    "contract": "activity@v1",
                    "feeds": {"subscribe": ["Activity.Z", "Activity.A", "Activity.Z"]}
                }
            }
        }
    });
    let sorted = json!({
        "format": "trellis.contract.v1",
        "id": "example.optional-uses-digest@v1",
        "displayName": "Optional Uses Digest",
        "description": "Optional dependencies affect identity.",
        "kind": "service",
        "uses": {
            "optional": {
                "activity": {
                    "contract": "activity@v1",
                    "feeds": {"subscribe": ["Activity.A", "Activity.Z"]}
                }
            }
        }
    });
    let changed = json!({
        "format": "trellis.contract.v1",
        "id": "example.optional-uses-digest@v1",
        "displayName": "Optional Uses Digest",
        "description": "Optional dependencies affect identity.",
        "kind": "service",
        "uses": {
            "optional": {
                "activity": {
                    "contract": "activity@v1",
                    "feeds": {"subscribe": ["Activity.A"]}
                }
            }
        }
    });

    let optional_digest = digest_contract_value(&optional).expect("optional digest");
    assert_eq!(
        optional_digest,
        digest_contract_value(&sorted).expect("sorted optional digest")
    );
    assert_ne!(
        optional_digest,
        digest_contract_value(&changed).expect("changed optional digest")
    );
}

#[test]
fn builder_use_ref_is_required_and_optional_use_ref_is_grouped_optional() {
    let manifest = ContractManifestBuilder::new(
        "example.builder-uses@v1",
        "Builder Uses",
        "Build required and optional uses.",
        ContractKind::App,
    )
    .use_ref(
        "billing",
        use_contract("billing@v1").with_rpc_call(["Billing.Charge"]),
    )
    .optional_use_ref(
        "activity",
        use_contract("activity@v1").with_feed_subscribe(["Activity.Feed"]),
    )
    .build()
    .expect("builder manifest");

    assert!(manifest.uses.required().contains_key("billing"));
    assert!(manifest.uses.optional().contains_key("activity"));
}

#[test]
fn manifest_validation_rejects_unknown_feed_schema_refs() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.feeds@v1",
        "displayName": "Example Feeds",
        "description": "Expose queryable feeds.",
        "kind": "service",
        "schemas": {
            "ActivityFeedInput": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        "feeds": {
            "Activity.Feed": {
                "version": "v1",
                "subject": "feeds.v1.Activity.Feed",
                "input": {"schema": "ActivityFeedInput"},
                "event": {"schema": "MissingFeedEvent"}
            }
        }
    }))
    .expect_err("manifest with missing feed schema should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("feed"));
    assert!(details.contains("unknown schema"));
}

#[test]
fn contract_digest_changes_when_feed_schemas_change() {
    let mut manifest = json!({
        "format": "trellis.contract.v1",
        "id": "example.feed-digest@v1",
        "displayName": "Example Feed Digest",
        "description": "Expose queryable feeds.",
        "kind": "service",
        "schemas": {
            "ActivityFeedInput": {"type": "object", "properties": {}, "additionalProperties": false},
            "ActivityFeedEvent": {"type": "object", "properties": {}, "additionalProperties": false},
            "Unused": {"type": "object", "properties": {"ignored": {"type": "string"}}, "additionalProperties": false}
        },
        "feeds": {
            "Activity.Feed": {
                "version": "v1",
                "subject": "feeds.v1.Activity.Feed",
                "input": {"schema": "ActivityFeedInput"},
                "event": {"schema": "ActivityFeedEvent"}
            }
        }
    });
    let digest = digest_contract_value(&manifest).expect("digest feed manifest");

    manifest["schemas"]["Unused"] = json!({
        "type": "object",
        "properties": {"stillIgnored": {"type": "number"}},
        "additionalProperties": false
    });
    assert_eq!(
        digest_contract_value(&manifest).expect("digest with unused schema change"),
        digest
    );

    manifest["schemas"]["ActivityFeedInput"] = json!({
        "type": "object",
        "required": ["cursor"],
        "properties": {"cursor": {"type": "string"}},
        "additionalProperties": false
    });
    assert_ne!(
        digest_contract_value(&manifest).expect("digest with input schema change"),
        digest
    );

    manifest["schemas"]["ActivityFeedInput"] =
        json!({"type": "object", "properties": {}, "additionalProperties": false});
    manifest["schemas"]["ActivityFeedEvent"] = json!({
        "type": "object",
        "required": ["id"],
        "properties": {"id": {"type": "string"}},
        "additionalProperties": false
    });
    assert_ne!(
        digest_contract_value(&manifest).expect("digest with event schema change"),
        digest
    );
}

#[test]
fn manifest_parses_top_level_jobs() {
    let manifest = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.jobs@v1",
        "displayName": "Example Jobs",
        "description": "Expose job queues.",
        "kind": "service",
        "schemas": {
            "JobPayload": {"type": "object", "properties": {}, "additionalProperties": false},
            "JobResult": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        "jobs": {
            "document-process": {
                "payload": {"schema": "JobPayload"},
                "result": {"schema": "JobResult"},
                "maxDeliver": 5,
                "backoffMs": [1000, 5000],
                "ackWaitMs": 30000,
                "defaultDeadlineMs": 60000,
                "progress": true,
                "logs": true,
                "dlq": true,
                "concurrency": 4
            }
        }
    }))
    .expect("manifest with top-level jobs should parse");

    let queue = manifest
        .jobs
        .get("document-process")
        .expect("document-process queue");
    assert_eq!(queue.payload.schema, "JobPayload");
    assert_eq!(
        queue.result.as_ref().map(|schema| schema.schema.as_str()),
        Some("JobResult")
    );
    assert_eq!(queue.max_deliver, Some(5));
    assert_eq!(queue.backoff_ms.as_ref(), Some(&vec![1000, 5000]));
    assert_eq!(queue.ack_wait_ms, Some(30_000));
    assert_eq!(queue.default_deadline_ms, Some(60_000));
    assert_eq!(queue.progress, Some(true));
    assert_eq!(queue.logs, Some(true));
    assert_eq!(queue.dlq, Some(true));
    assert_eq!(queue.concurrency, Some(4));
}

#[test]
fn manifest_validation_rejects_legacy_resource_jobs() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.jobs@v1",
        "displayName": "Example Jobs",
        "description": "Expose job queues.",
        "kind": "service",
        "schemas": {
            "JobPayload": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        "resources": {
            "jobs": {
                "queues": {
                    "document-process": {
                        "payload": {"schema": "JobPayload"}
                    }
                }
            }
        }
    }))
    .expect_err("legacy resources.jobs manifest should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("resources"));
    assert!(details.contains("jobs"));
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
fn manifest_validation_rejects_missing_kind() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.missing-kind@v1",
        "displayName": "Missing Kind",
        "description": "Missing kind field"
    }))
    .expect_err("manifest without kind should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("kind"));
}

#[test]
fn manifest_validation_rejects_raw_subjects() {
    let error = parse_manifest(json!({
        "format": "trellis.contract.v1",
        "id": "example.subjects@v1",
        "displayName": "Example Subjects",
        "description": "Expose raw subjects",
        "kind": "service",
        "subjects": {
            "Activity.Raw": {
                "subject": "activity.raw"
            }
        }
    }))
    .expect_err("manifest with raw subjects should fail");

    let ContractsError::SchemaValidation { details, .. } = error else {
        panic!("expected schema validation error");
    };
    assert!(details.contains("subjects"));
}
