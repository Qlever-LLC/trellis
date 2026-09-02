use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::{json, Value};
use trellis_protocol::GrantSet;

use super::{
    ephemeral::BrowserConsentProposal, AuthorizationStateError, CapabilityGroupRecord,
    LoginPortalRecord, LoginSettingsRecord, ParticipantBindingRecord, PortalGrantOverrideRecord,
    PortalPolicySnapshot,
};

pub(crate) fn portal_allows_authenticated_provider(
    portal: &LoginPortalRecord,
    settings: &LoginSettingsRecord,
    provider_id: &str,
) -> bool {
    !portal.disabled
        && !portal.removed
        && portal.provider_ids.iter().any(|id| id == provider_id)
        && (provider_id != "local" || settings.local_login_enabled)
}

pub(crate) fn portal_policy_snapshot(
    portal: &LoginPortalRecord,
    settings: &LoginSettingsRecord,
    participant_id: &str,
    policy: Option<&PortalGrantOverrideRecord>,
    groups: &BTreeMap<String, CapabilityGroupRecord>,
) -> Result<PortalPolicySnapshot, AuthorizationStateError> {
    if settings.portal_id != portal.portal_id
        || policy.is_some_and(|policy| {
            policy.portal_id != portal.portal_id || policy.participant_id != participant_id
        })
    {
        return Err(AuthorizationStateError::InvalidRecord(
            "portal policy snapshot inputs disagree".to_owned(),
        ));
    }
    let mut pending = policy
        .into_iter()
        .flat_map(|policy| {
            policy
                .capability_group_keys
                .iter()
                .chain(
                    policy
                        .role_mappings
                        .iter()
                        .flat_map(|mapping| mapping.capability_group_keys.iter()),
                )
                .cloned()
        })
        .collect::<Vec<_>>();
    let mut versions = BTreeMap::new();
    let mut fingerprints = BTreeMap::new();
    while let Some(group_key) = pending.pop() {
        if versions.contains_key(&group_key) {
            continue;
        }
        let group = groups.get(&group_key).ok_or_else(|| {
            AuthorizationStateError::InvalidRecord(format!(
                "portal policy references missing capability group {group_key}"
            ))
        })?;
        versions.insert(group_key, group.version);
        fingerprints.insert(group.group_key.clone(), policy_record_fingerprint(group)?);
        pending.extend(group.included_groups.iter().cloned());
    }
    Ok(PortalPolicySnapshot {
        portal_id: portal.portal_id.clone(),
        portal_version: portal.version,
        portal_fingerprint: policy_record_fingerprint(portal)?,
        login_settings_version: settings.version,
        login_settings_fingerprint: policy_record_fingerprint(settings)?,
        participant_id: participant_id.to_owned(),
        policy_version: policy.map(|policy| policy.version),
        policy_fingerprint: policy.map(policy_record_fingerprint).transpose()?,
        capability_group_versions: versions.into_iter().collect(),
        capability_group_fingerprints: fingerprints.into_iter().collect(),
    })
}

pub(super) fn policy_record_fingerprint<T: Serialize>(
    record: &T,
) -> Result<String, AuthorizationStateError> {
    let value = serde_json::to_value(record)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    trellis_protocol::digest_json(&value)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))
}

pub(crate) fn browser_consent_proposal(
    binding: &ParticipantBindingRecord,
) -> Result<BrowserConsentProposal, AuthorizationStateError> {
    let resolved = binding.resolve()?;
    let proposal = resolved.proposal();
    let participant: Value = serde_json::from_str(&binding.participant_json)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let consent_view = json!({
        "participant": {
            "id": binding.participant_id,
            "digest": binding.artifact_digest,
            "displayName": participant.get("displayName").and_then(Value::as_str).unwrap_or(&binding.participant_id),
            "description": participant.get("description").and_then(Value::as_str).unwrap_or("Trellis participant"),
        },
        "required": {
            "permissions": proposal.required().grant_set().permissions(),
            "capabilities": proposal.required().capabilities().iter().map(|capability| capability.name()).collect::<Vec<_>>(),
        },
        "optionalBundles": resolved.optional_apis().iter().map(|used| json!({
            "id": used.alias(),
            "apiId": used.api(),
            "permissions": used.grant_set().permissions(),
        })).collect::<Vec<_>>(),
    });
    let required_grant_set = proposal.required().grant_set().clone();
    let optional_grant_bundles = resolved
        .optional_apis()
        .iter()
        .map(|used| (used.alias().to_owned(), used.grant_set().clone()))
        .collect::<BTreeMap<_, _>>();
    let mut required_capabilities = proposal
        .required()
        .capabilities()
        .iter()
        .map(|capability| capability.name().to_owned())
        .collect::<Vec<_>>();
    required_capabilities.sort();
    required_capabilities.dedup();
    let optional_capability_definitions = proposal
        .optional()
        .capabilities()
        .iter()
        .map(|capability| {
            (
                capability.name().to_owned(),
                GrantSet::new(capability.allows().to_vec()),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let consent_view_digest = trellis_protocol::digest_json(&consent_view)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let proposal_digest = trellis_protocol::digest_json(&json!({
        "participantId": binding.participant_id,
        "participantArtifactDigest": binding.artifact_digest,
        "participantNeedsDigest": binding.needs_digest,
        "requiredGrantSet": required_grant_set,
        "optionalGrantBundles": optional_grant_bundles,
        "requiredCapabilities": required_capabilities,
        "optionalCapabilityDefinitions": optional_capability_definitions,
    }))
    .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let consent = BrowserConsentProposal {
        participant_id: binding.participant_id.clone(),
        participant_artifact_digest: binding.artifact_digest.clone(),
        participant_needs_digest: binding.needs_digest.clone(),
        consent_view,
        consent_view_digest,
        proposal_digest,
        required_grant_set,
        optional_grant_bundles,
        required_capabilities,
        optional_capability_definitions,
    };
    consent.validate()?;
    Ok(consent)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProviderLoginAttributes {
    pub provider_id: String,
    pub roles: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PortalAuthoritySelection {
    pub grant_set: GrantSet,
    pub capabilities: Vec<String>,
    pub effective_policy_digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EffectivePortalAuthority<'a> {
    format: &'static str,
    portal_id: &'a str,
    participant_id: &'a str,
    participant_artifact_digest: &'a str,
    participant_needs_digest: &'a str,
    grant_set: &'a GrantSet,
    capabilities: &'a [String],
}

pub(crate) fn resolve_portal_authority_selection(
    policy: &PortalGrantOverrideRecord,
    groups: &BTreeMap<String, CapabilityGroupRecord>,
    consent: &BrowserConsentProposal,
    attributes: &ProviderLoginAttributes,
) -> Result<PortalAuthoritySelection, AuthorizationStateError> {
    if policy.participant_id != consent.participant_id {
        return Err(AuthorizationStateError::InvalidRecord(
            "portal policy participant does not match consent proposal".to_owned(),
        ));
    }
    let mut selected = policy
        .direct_capabilities
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    expand_groups(&policy.capability_group_keys, groups, &mut selected)?;
    for mapping in &policy.role_mappings {
        if mapping.provider_id == attributes.provider_id
            && attributes.roles.binary_search(&mapping.role).is_ok()
        {
            selected.extend(mapping.direct_capabilities.iter().cloned());
            expand_groups(&mapping.capability_group_keys, groups, &mut selected)?;
        }
    }

    let mut permissions = consent.required_grant_set.permissions().to_vec();
    let mut capabilities = consent.required_capabilities.clone();
    // The admin marker is platform classification, not participant permission
    // evidence, so it bypasses proposal bounding; only admins can write the
    // policy that selects it.
    let admin_marker_selected = selected.contains("trellis.auth::admin");
    for capability in selected {
        if let Some(grants) = consent.optional_capability_definitions.get(&capability) {
            permissions.extend_from_slice(grants.permissions());
            capabilities.push(capability);
        }
    }
    if admin_marker_selected {
        capabilities.push("trellis.auth::admin".to_owned());
    }
    capabilities.sort();
    capabilities.dedup();
    let grant_set = GrantSet::new(permissions);
    let digest_value = serde_json::to_value(EffectivePortalAuthority {
        format: "trellis.portal-effective-authority.v1",
        portal_id: &policy.portal_id,
        participant_id: &policy.participant_id,
        participant_artifact_digest: &consent.participant_artifact_digest,
        participant_needs_digest: &consent.participant_needs_digest,
        grant_set: &grant_set,
        capabilities: &capabilities,
    })
    .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let effective_policy_digest = trellis_protocol::digest_json(&digest_value)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;

    Ok(PortalAuthoritySelection {
        grant_set,
        capabilities,
        effective_policy_digest,
    })
}

fn expand_groups(
    group_keys: &[String],
    groups: &BTreeMap<String, CapabilityGroupRecord>,
    capabilities: &mut BTreeSet<String>,
) -> Result<(), AuthorizationStateError> {
    let mut pending = group_keys.to_vec();
    let mut visited = BTreeSet::new();
    while let Some(key) = pending.pop() {
        if !visited.insert(key.clone()) {
            continue;
        }
        let group = groups.get(&key).ok_or_else(|| {
            AuthorizationStateError::InvalidRecord(format!("capability group '{key}' is missing"))
        })?;
        capabilities.extend(group.capabilities.iter().cloned());
        pending.extend(group.included_groups.iter().cloned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use trellis_protocol::{ApiSurfaceKind, PermissionAction, PermissionAtom, PermissionTarget};

    fn atom(name: &str) -> PermissionAtom {
        PermissionAtom::new(
            PermissionTarget::api_surface("app@v1", ApiSurfaceKind::Rpc, name).unwrap(),
            PermissionAction::Call,
        )
        .unwrap()
    }

    fn grant(name: &str) -> GrantSet {
        GrantSet::new(vec![atom(name)])
    }

    fn group(key: &str, capabilities: &[&str], included: &[&str]) -> CapabilityGroupRecord {
        CapabilityGroupRecord {
            group_key: key.to_owned(),
            display_name: key.to_owned(),
            description: String::new(),
            capabilities: capabilities
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
            included_groups: included.iter().map(|value| (*value).to_owned()).collect(),
            created_at: 1,
            updated_at: 1,
            version: 1,
        }
    }

    #[test]
    fn expands_nested_provider_scoped_roles_without_optional_bundles() {
        let consent = BrowserConsentProposal {
            participant_id: "app".to_owned(),
            participant_artifact_digest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
            participant_needs_digest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
            consent_view: json!({}),
            consent_view_digest: String::new(),
            proposal_digest: String::new(),
            required_grant_set: grant("Required"),
            optional_grant_bundles: BTreeMap::from([("bundle".to_owned(), grant("Bundle"))]),
            required_capabilities: vec!["required".to_owned()],
            optional_capability_definitions: BTreeMap::from([
                ("app::read".to_owned(), grant("Read")),
                ("app::write".to_owned(), grant("Write")),
            ]),
        };
        let policy = PortalGrantOverrideRecord {
            portal_id: "portal".to_owned(),
            participant_id: "app".to_owned(),
            direct_capabilities: vec!["app::unknown".to_owned()],
            capability_group_keys: vec!["nested".to_owned()],
            role_mappings: vec![super::super::PortalRoleMapping {
                provider_id: "oidc".to_owned(),
                role: "Admin".to_owned(),
                direct_capabilities: vec!["app::write".to_owned()],
                capability_group_keys: vec![],
            }],
            created_at: 1,
            updated_at: 1,
            version: 1,
        };
        let groups = BTreeMap::from([
            ("base".to_owned(), group("base", &["app::read"], &[])),
            ("nested".to_owned(), group("nested", &[], &["base"])),
        ]);
        let selection = resolve_portal_authority_selection(
            &policy,
            &groups,
            &consent,
            &ProviderLoginAttributes {
                provider_id: "oidc".to_owned(),
                roles: vec!["Admin".to_owned()],
            },
        )
        .unwrap();
        assert_eq!(
            selection.capabilities,
            ["app::read", "app::write", "required"]
        );
        assert!(selection.grant_set.permissions().contains(&atom("Read")));
        assert!(!selection.grant_set.permissions().contains(&atom("Bundle")));
        let other = resolve_portal_authority_selection(
            &policy,
            &groups,
            &consent,
            &ProviderLoginAttributes {
                provider_id: "other".to_owned(),
                roles: vec!["Admin".to_owned()],
            },
        )
        .unwrap();
        assert_eq!(other.capabilities, ["app::read", "required"]);
    }

    #[test]
    fn roles_are_exact_and_order_independent() {
        let consent = BrowserConsentProposal {
            participant_id: "app".to_owned(),
            participant_artifact_digest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
            participant_needs_digest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
            consent_view: json!({}),
            consent_view_digest: String::new(),
            proposal_digest: String::new(),
            required_grant_set: grant("Required"),
            optional_grant_bundles: BTreeMap::new(),
            required_capabilities: vec!["required".to_owned()],
            optional_capability_definitions: BTreeMap::from([(
                "app::write".to_owned(),
                grant("Write"),
            )]),
        };
        let policy = PortalGrantOverrideRecord {
            portal_id: "portal".to_owned(),
            participant_id: "app".to_owned(),
            direct_capabilities: vec![],
            capability_group_keys: vec![],
            role_mappings: vec![
                super::super::PortalRoleMapping {
                    provider_id: "oidc".to_owned(),
                    role: "Admin".to_owned(),
                    direct_capabilities: vec!["app::write".to_owned()],
                    capability_group_keys: vec![],
                },
                super::super::PortalRoleMapping {
                    provider_id: "oidc".to_owned(),
                    role: "*".to_owned(),
                    direct_capabilities: vec!["app::write".to_owned()],
                    capability_group_keys: vec![],
                },
            ],
            created_at: 1,
            updated_at: 1,
            version: 1,
        };
        let first = resolve_portal_authority_selection(
            &policy,
            &BTreeMap::new(),
            &consent,
            &ProviderLoginAttributes {
                provider_id: "oidc".to_owned(),
                roles: vec!["Reader".to_owned(), "Admin".to_owned()],
            },
        )
        .unwrap();
        let reordered = resolve_portal_authority_selection(
            &policy,
            &BTreeMap::new(),
            &consent,
            &ProviderLoginAttributes {
                provider_id: "oidc".to_owned(),
                roles: vec!["Admin".to_owned(), "Reader".to_owned()],
            },
        )
        .unwrap();
        assert_eq!(first, reordered);
        assert_eq!(first.capabilities, ["app::write", "required"]);

        let wildcard_only = resolve_portal_authority_selection(
            &policy,
            &BTreeMap::new(),
            &consent,
            &ProviderLoginAttributes {
                provider_id: "oidc".to_owned(),
                roles: vec!["Operator".to_owned()],
            },
        )
        .unwrap();
        assert_eq!(wildcard_only.capabilities, ["required"]);
    }

    #[test]
    fn rejects_reserved_capabilities_outside_platform_administration() {
        let consent = BrowserConsentProposal {
            participant_id: "app".to_owned(),
            participant_artifact_digest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
            participant_needs_digest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
            consent_view: json!({}),
            consent_view_digest: String::new(),
            proposal_digest: String::new(),
            required_grant_set: grant("Required"),
            optional_grant_bundles: BTreeMap::new(),
            required_capabilities: vec![],
            optional_capability_definitions: BTreeMap::from([(
                "trellis.auth::users.mutate".to_owned(),
                grant("Admin"),
            )]),
        };
        let policy = PortalGrantOverrideRecord {
            portal_id: "portal".to_owned(),
            participant_id: "app".to_owned(),
            direct_capabilities: vec!["trellis.auth::users.mutate".to_owned()],
            capability_group_keys: vec![],
            role_mappings: vec![],
            created_at: 1,
            updated_at: 1,
            version: 1,
        };

        assert!(resolve_portal_authority_selection(
            &policy,
            &BTreeMap::new(),
            &consent,
            &ProviderLoginAttributes {
                provider_id: "local".to_owned(),
                roles: vec![],
            },
        )
        .is_ok());
    }
}
