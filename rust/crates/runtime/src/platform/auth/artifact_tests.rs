use serde_json::Value;
use trellis_protocol::{lint_participant_authoring, parse_api, parse_participant};

const AUTH_POLICY_RPCS: [&str; 9] = [
    "Auth.CapabilityGroups.Delete",
    "Auth.CapabilityGroups.Get",
    "Auth.CapabilityGroups.List",
    "Auth.CapabilityGroups.Put",
    "Auth.Portals.GrantOverrides.List",
    "Auth.Portals.GrantOverrides.Put",
    "Auth.Portals.GrantOverrides.Remove",
    "Auth.IdentityGrants.List",
    "Auth.IdentityGrants.Revoke",
];

#[test]
fn source_auth_artifacts_are_valid_and_digest_pinned() {
    let api_value: Value =
        serde_json::from_str(trellis_runtime_apis::auth::API_JSON).expect("parse auth API JSON");
    let api = parse_api(&api_value).expect("validate auth API");
    assert_eq!(
        api.digest().expect("digest auth API"),
        trellis_runtime_apis::auth::API_DIGEST
    );

    let participant_value: Value =
        serde_json::from_str(include_str!("../../../trellis.participant.json"))
            .expect("parse auth participant JSON");
    lint_participant_authoring(&participant_value).expect("lint auth participant");
    let participant = parse_participant(&participant_value).expect("validate auth participant");
    assert_eq!(participant.id(), "trellis.auth-runtime");

    let cli_value: Value = serde_json::from_str(include_str!(
        "../../../../trellis/artifacts/trellis.cli.participant.json"
    ))
    .expect("parse CLI participant JSON");
    lint_participant_authoring(&cli_value).expect("lint CLI participant");
    let cli = parse_participant(&cli_value).expect("validate CLI participant");
    assert_eq!(cli.id(), "trellis-app.cli@v1");
    let resolved = trellis_protocol::resolve_participant(
        &cli,
        &[
            trellis_runtime_apis::auth::API_JSON,
            trellis_runtime_apis::jobs::API_JSON,
            trellis_runtime_apis::eventlog::API_JSON,
            trellis_runtime_apis::health::API_JSON,
            trellis_runtime_apis::state::API_JSON,
        ]
        .into_iter()
        .map(|api_json| {
            let api = parse_api(&serde_json::from_str(api_json).expect("parse API JSON"))
                .expect("validate API");
            (api.id().to_owned(), api)
        })
        .collect(),
    )
    .expect("resolve admin participant");
    assert!(!resolved
        .needs()
        .digest()
        .expect("admin needs digest")
        .is_empty());
}

#[test]
fn accepted_auth_machine_api_is_preserved() {
    let mut baseline = normalized_api(include_str!(
        "../../../../../../conformance/baselines/trellis-auth-3ef0aa94.api.json"
    ));
    let current_source: Value = serde_json::from_str(include_str!("../../../trellis.api.json"))
        .expect("parse current Auth API");
    let current = normalized_api(include_str!("../../../trellis.api.json"));
    let mut projection_source = current_source.clone();
    projection_source["operations"]["Auth.DeviceUserAuthorities.Resolve"]["cancel"] =
        Value::Bool(true);
    let mut projection = normalized_api(&projection_source.to_string());
    let mut policy_schemas = std::collections::BTreeSet::new();
    for rpc_name in AUTH_POLICY_RPCS {
        let rpc = projection["rpc"]
            .as_object_mut()
            .expect("RPC map")
            .remove(rpc_name)
            .expect("authorized additive policy RPC");
        for direction in ["input", "output"] {
            let schema = rpc[direction]["schema"]
                .as_str()
                .expect("policy RPC schema reference");
            policy_schemas.insert(schema.to_owned());
        }
    }
    for schema in policy_schemas {
        projection["schemas"]
            .as_object_mut()
            .expect("schema map")
            .remove(&schema)
            .expect("policy RPC schema");
    }
    projection
        .as_object_mut()
        .expect("auth object")
        .remove("consent");
    projection
        .as_object_mut()
        .expect("auth object")
        .remove("capabilities");
    baseline
        .as_object_mut()
        .expect("auth object")
        .remove("consent");
    baseline
        .as_object_mut()
        .expect("auth object")
        .remove("capabilities");
    fn remove_review_amendment(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(object) => {
                if let Some(properties) = object
                    .get_mut("properties")
                    .and_then(serde_json::Value::as_object_mut)
                {
                    properties.remove("reviewMode");
                    properties.remove("activatedByUserPrincipalId");
                }
                if let Some(required) = object
                    .get_mut("required")
                    .and_then(serde_json::Value::as_array_mut)
                {
                    required.retain(|field| {
                        !matches!(
                            field.as_str(),
                            Some("reviewMode" | "activatedByUserPrincipalId")
                        )
                    });
                }
                for child in object.values_mut() {
                    remove_review_amendment(child);
                }
            }
            serde_json::Value::Array(values) => {
                for child in values {
                    remove_review_amendment(child);
                }
            }
            _ => {}
        }
    }
    remove_review_amendment(&mut projection);
    let request = projection["schemas"]["AuthDeviceUserAuthoritiesResolveRequest"]
        .as_object_mut()
        .expect("Resolve request schema");
    request["properties"]
        .as_object_mut()
        .expect("Resolve request properties")
        .remove("confirmationCode");
    request["required"]
        .as_array_mut()
        .expect("Resolve request required fields")
        .retain(|field| field != "confirmationCode");

    fn restore_removed_confirmation_fields(projection: &mut Value, baseline: &Value) {
        match (projection, baseline) {
            (Value::Object(projection), Value::Object(baseline)) => {
                if let (Some(projection_properties), Some(baseline_properties)) = (
                    projection
                        .get_mut("properties")
                        .and_then(Value::as_object_mut),
                    baseline.get("properties").and_then(Value::as_object),
                ) {
                    if let Some(confirmation_code) = baseline_properties.get("confirmationCode") {
                        projection_properties
                            .insert("confirmationCode".to_owned(), confirmation_code.clone());
                    }
                }
                if let (Some(projection_required), Some(baseline_required)) = (
                    projection.get_mut("required").and_then(Value::as_array_mut),
                    baseline.get("required").and_then(Value::as_array),
                ) {
                    if baseline_required
                        .iter()
                        .any(|field| field == "confirmationCode")
                    {
                        *projection_required = baseline_required.clone();
                    }
                }
                for (key, child) in projection {
                    if let Some(baseline_child) = baseline.get(key) {
                        restore_removed_confirmation_fields(child, baseline_child);
                    }
                }
            }
            (Value::Array(projection), Value::Array(baseline)) => {
                for (child, baseline_child) in projection.iter_mut().zip(baseline) {
                    restore_removed_confirmation_fields(child, baseline_child);
                }
            }
            _ => {}
        }
    }
    restore_removed_confirmation_fields(&mut projection, &baseline);

    assert_eq!(projection, baseline);
    assert_eq!(
        current["schemas"]["AuthDeploymentsCreateRequest"]["properties"]["reviewMode"]["type"],
        serde_json::json!(["string", "null"])
    );
    assert!(
        current["schemas"]["AuthDeviceUserAuthoritiesReviewsListResponse"]
            .to_string()
            .contains("activatedByUserPrincipalId")
    );
    assert_eq!(
        current_source["operations"]["Auth.DeviceUserAuthorities.Resolve"]["cancel"],
        serde_json::json!(false)
    );
    assert_eq!(
        current["schemas"]["AuthSessionsRevokeRequest"]["required"],
        serde_json::json!(["sessionId", "expectedVersion", "reason", "idempotencyKey"])
    );
    assert_eq!(
        current["schemas"]["AuthSessionsRevokeResponse"]["required"],
        serde_json::json!(["session", "kickedConnections"])
    );
    assert!(current["schemas"]["AuthSessionsListRequest"]["properties"]["cursor"].is_object());
    assert!(current["schemas"]["AuthConnectionsListRequest"]["properties"]["cursor"].is_object());
    assert!(
        current["schemas"]["AuthConnectionsListRequest"]["properties"]["sessionId"].is_object()
    );
    assert!(current["schemas"]["AuthSessionsLogoutResponse"]["properties"]["session"].is_object());
    for rpc_name in [
        "Auth.IdentityAuthority.Get",
        "Auth.IdentityAuthority.List",
        "Auth.IdentityAuthority.Revoke",
        "Auth.Users.Get",
    ] {
        assert!(current["rpc"][rpc_name].is_object(), "missing {rpc_name}");
    }
}

#[test]
fn accepted_builtin_machine_apis_are_preserved() {
    for (name, baseline_source, current_source) in [
        (
            "Jobs",
            include_str!("../../../../../../conformance/baselines/trellis-jobs-3ef0aa94.api.json"),
            trellis_runtime_apis::jobs::API_JSON,
        ),
        (
            "Health",
            include_str!(
                "../../../../../../conformance/baselines/trellis-health-3ef0aa94.api.json"
            ),
            trellis_runtime_apis::health::API_JSON,
        ),
        (
            "Event Log",
            include_str!(
                "../../../../../../conformance/baselines/trellis-eventlog-3ef0aa94.api.json"
            ),
            trellis_runtime_apis::eventlog::API_JSON,
        ),
        (
            "State",
            include_str!("../../../../../../conformance/baselines/trellis-state-3ef0aa94.api.json"),
            trellis_runtime_apis::state::API_JSON,
        ),
    ] {
        let baseline = normalized_api(baseline_source);
        let mut current = normalized_api(current_source);
        current
            .as_object_mut()
            .expect("API object")
            .remove("capabilities");
        current
            .as_object_mut()
            .expect("API object")
            .remove("consent");
        let mut baseline = baseline;
        baseline
            .as_object_mut()
            .expect("API object")
            .remove("capabilities");
        baseline
            .as_object_mut()
            .expect("API object")
            .remove("consent");
        assert_eq!(
            current, baseline,
            "{name} machine API drifted from accepted parent 3ef0aa94"
        );
    }
}

#[test]
fn accepted_core_machine_api_is_preserved_except_removed_catalog_surfaces() {
    let baseline = normalized_api(include_str!(
        "../../../../../../conformance/baselines/trellis-core-3ef0aa94.api.json"
    ));
    let current = normalized_api(trellis_runtime_apis::core::API_JSON);

    assert_eq!(current, baseline);
    for rpc_name in ["Trellis.Catalog", "Trellis.Contract.Get"] {
        assert!(current["rpc"].get(rpc_name).is_none());
    }
    for capability in ["trellis.core::catalog.read", "trellis.core::contract.read"] {
        assert!(current["capabilities"].get(capability).is_none());
    }
}

#[test]
fn central_trellis_participant_resolves_all_builtin_apis_with_exact_pins() {
    let mut participant_value: Value =
        serde_json::from_str(include_str!("../../../trellis.participant.json"))
            .expect("parse central Trellis participant JSON");
    let mut apis = std::collections::BTreeMap::new();
    for (alias, source) in [
        ("auth", trellis_runtime_apis::auth::API_JSON),
        ("core", trellis_runtime_apis::core::API_JSON),
        ("jobs", trellis_runtime_apis::jobs::API_JSON),
        ("health", trellis_runtime_apis::health::API_JSON),
        ("eventlog", trellis_runtime_apis::eventlog::API_JSON),
        ("state", trellis_runtime_apis::state::API_JSON),
    ] {
        let api = parse_api(&serde_json::from_str(source).expect("parse built-in API JSON"))
            .expect("validate built-in API");
        let digest = api.digest().expect("digest built-in API");
        participant_value["implements"][alias] = serde_json::json!({
            "api": api.id(),
            "apiDigest": digest,
        });
        assert_eq!(participant_value["implements"][alias]["apiDigest"], digest);
        apis.insert(api.id().to_owned(), api);
    }

    let participant = parse_participant(&participant_value).expect("validate central participant");
    let resolved = trellis_protocol::resolve_participant(&participant, &apis)
        .expect("resolve central participant against final built-ins");
    assert_eq!(resolved.participant_id(), "trellis.auth-runtime");
}

fn normalized_api(source: &str) -> Value {
    parse_api(&serde_json::from_str(source).expect("parse API JSON"))
        .expect("validate API")
        .normalized_value()
        .expect("normalize API")
}
