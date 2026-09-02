use std::collections::BTreeMap;

use serde_json::Value;

use super::{AuthorizationStateError, ParticipantBindingRecord, ParticipantBindingState};

pub(crate) const AUTH_RUNTIME_PARTICIPANT_ID: &str = "trellis.auth-runtime";

pub(crate) fn validate_participant_namespace(participant_id: &str) -> Result<(), String> {
    if participant_id.starts_with("trellis.") && participant_id != AUTH_RUNTIME_PARTICIPANT_ID {
        return Err(format!(
            "participant id '{participant_id}' uses the reserved 'trellis.' namespace"
        ));
    }
    Ok(())
}

pub(crate) fn validate_binding_namespace(
    binding: &ParticipantBindingRecord,
) -> Result<(), AuthorizationStateError> {
    if binding.participant_id.starts_with("trellis.") {
        let canonical_digest = match binding.participant_id.as_str() {
            AUTH_RUNTIME_PARTICIPANT_ID => {
                auth_runtime_participant_binding(binding.resolved_at)?.artifact_digest
            }
            _ => {
                return Err(AuthorizationStateError::InvalidRecord(format!(
                    "participant id '{}' uses the reserved 'trellis.' namespace",
                    binding.participant_id
                )))
            }
        };
        if binding.artifact_digest != canonical_digest {
            return Err(AuthorizationStateError::InvalidRecord(format!(
                "participant '{}' does not match its canonical Trellis artifact",
                binding.participant_id
            )));
        }
    }

    let artifacts: BTreeMap<String, Value> = serde_json::from_str(&binding.api_artifacts_json)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    for (api_id, value) in artifacts {
        if !api_id.starts_with("trellis.") {
            continue;
        }
        let api = trellis_protocol::parse_api(&value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let digest = api
            .digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        if !is_platform_api(&api_id, &digest) {
            return Err(AuthorizationStateError::InvalidRecord(format!(
                "API '{api_id}' uses the reserved 'trellis.' namespace"
            )));
        }
    }
    Ok(())
}

pub(crate) fn is_platform_api(api_id: &str, api_digest: &str) -> bool {
    [
        (
            trellis_runtime_apis::auth::API_ID,
            trellis_runtime_apis::auth::API_DIGEST,
        ),
        (
            trellis_runtime_apis::core::API_ID,
            trellis_runtime_apis::core::API_DIGEST,
        ),
        (
            trellis_runtime_apis::eventlog::API_ID,
            trellis_runtime_apis::eventlog::API_DIGEST,
        ),
        (
            trellis_runtime_apis::health::API_ID,
            trellis_runtime_apis::health::API_DIGEST,
        ),
        (
            trellis_runtime_apis::jobs::API_ID,
            trellis_runtime_apis::jobs::API_DIGEST,
        ),
        (
            trellis_runtime_apis::state::API_ID,
            trellis_runtime_apis::state::API_DIGEST,
        ),
    ]
    .contains(&(api_id, api_digest))
}

pub(crate) fn cli_participant_binding(
    resolved_at: i64,
) -> Result<ParticipantBindingRecord, AuthorizationStateError> {
    let mut participant_value: Value = serde_json::from_str(include_str!(
        "../../../../trellis/artifacts/trellis.cli.participant.json"
    ))
    .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let mut api_values = BTreeMap::new();
    for (section, api_json) in [
        ("required", trellis_runtime_apis::auth::API_JSON),
        ("required", trellis_runtime_apis::jobs::API_JSON),
        ("required", trellis_runtime_apis::state::API_JSON),
        ("optional", trellis_runtime_apis::eventlog::API_JSON),
        ("required", trellis_runtime_apis::health::API_JSON),
    ] {
        let api_value: Value = serde_json::from_str(api_json)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        trellis_protocol::lint_api_authoring(&api_value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let api = trellis_protocol::parse_api(&api_value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        participant_value["uses"][section][api.id()]["apiDigest"] = Value::String(
            api.digest()
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        );
        api_values.insert(api.id().to_owned(), api_value);
    }
    builtin_participant_binding(
        &serde_json::to_string(&participant_value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        api_values,
        resolved_at,
    )
}

pub(crate) fn auth_runtime_participant_binding(
    resolved_at: i64,
) -> Result<ParticipantBindingRecord, AuthorizationStateError> {
    let api_value: Value = serde_json::from_str(trellis_runtime_apis::auth::API_JSON)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    trellis_protocol::lint_api_authoring(&api_value)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let api = trellis_protocol::parse_api(&api_value)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let mut participant_value: Value =
        serde_json::from_str(include_str!("../../../trellis.participant.json"))
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    participant_value["implements"]["auth"]["apiDigest"] = Value::String(
        api.digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
    );
    let mut api_values = BTreeMap::from([(api.id().to_owned(), api_value)]);
    for (alias, api_json) in [
        ("core", trellis_runtime_apis::core::API_JSON),
        ("eventlog", trellis_runtime_apis::eventlog::API_JSON),
        ("health", trellis_runtime_apis::health::API_JSON),
        ("jobs", trellis_runtime_apis::jobs::API_JSON),
        ("state", trellis_runtime_apis::state::API_JSON),
    ] {
        let value: Value = serde_json::from_str(api_json)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        trellis_protocol::lint_api_authoring(&value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let parsed = trellis_protocol::parse_api(&value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        participant_value["implements"][alias] = serde_json::json!({
            "api": parsed.id(),
            "apiDigest": parsed.digest().map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        });
        api_values.insert(parsed.id().to_owned(), value);
    }
    builtin_participant_binding(
        &serde_json::to_string(&participant_value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        api_values,
        resolved_at,
    )
}

fn builtin_participant_binding(
    participant_json: &str,
    api_values: BTreeMap<String, Value>,
    resolved_at: i64,
) -> Result<ParticipantBindingRecord, AuthorizationStateError> {
    trellis_protocol::lint_participant_authoring(
        &serde_json::from_str(participant_json)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
    )
    .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let participant_value: Value = serde_json::from_str(participant_json)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let participant = trellis_protocol::parse_participant(&participant_value)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let mut apis = BTreeMap::new();
    for value in api_values.values() {
        let api = trellis_protocol::parse_api(value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        apis.insert(api.id().to_owned(), api);
    }
    let resolved = trellis_protocol::resolve_participant(&participant, &apis)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    Ok(ParticipantBindingRecord {
        participant_id: resolved.participant_id().to_owned(),
        participant_kind: resolved.participant_kind(),
        artifact_digest: resolved.participant_digest().to_owned(),
        needs_digest: resolved
            .needs()
            .digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        participant_json: participant
            .canonical_json()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        api_artifacts_json: trellis_protocol::canonicalize_json(
            &serde_json::to_value(api_values)
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        )
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        resolved_at,
        state: ParticipantBindingState::Resolved,
        error: None,
    })
}

#[cfg(test)]
mod state_api_digest_test {
    #[test]
    fn cli_binding_includes_state_admin_api() {
        let binding = super::cli_participant_binding(0).expect("CLI binding");
        assert!(binding.api_artifacts_json.contains("trellis.state@v1"));
    }

    #[test]
    fn platform_api_identity_requires_the_canonical_digest() {
        assert!(super::is_platform_api(
            trellis_runtime_apis::jobs::API_ID,
            trellis_runtime_apis::jobs::API_DIGEST,
        ));
        assert!(!super::is_platform_api(
            trellis_runtime_apis::jobs::API_ID,
            trellis_runtime_apis::auth::API_DIGEST,
        ));
        assert!(!super::is_platform_api(
            "trellis.community-defined@v1",
            trellis_runtime_apis::auth::API_DIGEST,
        ));
        assert!(!super::is_platform_api(
            "example.jobs@v1",
            trellis_runtime_apis::jobs::API_DIGEST,
        ));
    }

    #[test]
    fn trellis_participant_namespace_is_platform_reserved() {
        assert!(super::validate_participant_namespace("trellis-app.cli@v1").is_ok());
        assert!(super::validate_participant_namespace(super::AUTH_RUNTIME_PARTICIPANT_ID).is_ok());
        assert!(super::validate_participant_namespace("example.console").is_ok());
        assert!(super::validate_participant_namespace("trellis-app.console@v1").is_ok());
        assert!(super::validate_participant_namespace("demo.app@v1").is_ok());
        assert!(super::validate_participant_namespace("trellis.deployment-owned").is_err());

        let mut ordinary_cli = super::cli_participant_binding(0).expect("CLI binding");
        ordinary_cli.artifact_digest = "other-artifact".to_owned();
        assert!(super::validate_binding_namespace(&ordinary_cli).is_ok());

        let mut forged = super::auth_runtime_participant_binding(0).expect("auth binding");
        forged.artifact_digest = "forged".to_owned();
        assert!(super::validate_binding_namespace(&forged).is_err());
    }
}
