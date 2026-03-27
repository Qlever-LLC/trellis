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
