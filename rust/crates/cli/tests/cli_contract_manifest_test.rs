#[test]
fn agent_contract_manifest_validates_and_declares_expected_auth_and_core_surface() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path = temp_dir.path().join("trellis.agent@v1.json");
    std::fs::write(
        &manifest_path,
        format!("{}\n", trellis_cli::agent_contract::agent_contract_json()),
    )
    .expect("write agent contract manifest");

    let loaded =
        trellis_contracts::load_manifest(&manifest_path).expect("load agent contract manifest");

    assert_eq!(loaded.manifest.id, "trellis.agent@v1");
    assert_eq!(loaded.manifest.kind, trellis_contracts::ContractKind::Agent);
    assert_eq!(loaded.manifest.display_name, "Trellis Agent");

    let auth = loaded
        .manifest
        .uses
        .get("auth")
        .expect("auth alias present");
    assert_eq!(auth.contract, "trellis.auth@v1");

    let calls = auth
        .rpc
        .as_ref()
        .and_then(|rpc| rpc.call.as_ref())
        .expect("auth rpc call list");

    for expected in [
        "Auth.Sessions.Me",
        "Auth.Sessions.List",
        "Auth.Identities.List",
        "Auth.IdentityEnvelopes.Revoke",
        "Auth.Deployments.Create",
        "Auth.Users.List",
        "Auth.Users.Get",
        "Auth.Users.Create",
        "Auth.Users.Update",
        "Auth.Capabilities.List",
        "Auth.CapabilityGroups.List",
        "Auth.Users.PasswordReset.Create",
        "Auth.EnvelopeExpansions.Approve",
        "Auth.EnvelopeExpansions.List",
        "Auth.EnvelopeExpansions.Reject",
        "Auth.Envelopes.Get",
        "Auth.Envelopes.List",
        "Auth.Envelopes.Expand",
        "Auth.Envelopes.GrantOverrides.Put",
        "Auth.Envelopes.GrantOverrides.Remove",
    ] {
        assert!(
            calls.iter().any(|value| value == expected),
            "agent contract should declare {expected}"
        );
    }
    assert!(!calls
        .iter()
        .any(|value| value == "Auth.Envelopes.Changes.Preview"));
    assert!(!calls.iter().any(|value| value == "Auth.Envelopes.Shrink"));
    assert!(calls.iter().any(|value| value == "Auth.Deployments.List"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.Deployments.Disable"));
    assert!(calls.iter().any(|value| value == "Auth.Deployments.Enable"));
    assert!(calls.iter().any(|value| value == "Auth.Deployments.Remove"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ServiceInstances.Provision"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ServiceInstances.List"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ServiceInstances.Disable"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ServiceInstances.Enable"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ServiceInstances.Remove"));
    assert!(calls.iter().any(|value| value == "Auth.Devices.Provision"));
    assert!(calls.iter().any(|value| value == "Auth.Devices.List"));
    assert!(calls.iter().any(|value| value == "Auth.Devices.Disable"));
    assert!(calls.iter().any(|value| value == "Auth.Devices.Enable"));
    assert!(calls.iter().any(|value| value == "Auth.Devices.Remove"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DeviceUserAuthorities.List"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DeviceUserAuthorities.Revoke"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DeviceUserAuthorities.Reviews.List"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DeviceUserAuthorities.Reviews.Decide"));

    let core = loaded
        .manifest
        .uses
        .get("core")
        .expect("core alias present");
    assert_eq!(core.contract, "trellis.core@v1");

    let calls = core
        .rpc
        .as_ref()
        .and_then(|rpc| rpc.call.as_ref())
        .expect("core rpc call list");

    assert!(calls.iter().any(|value| value == "Trellis.Catalog"));
    assert!(calls.iter().any(|value| value == "Trellis.Contract.Get"));
}

#[test]
fn agent_contract_digest_matches_js_projection() {
    assert_eq!(
        trellis::auth::contract_digest(trellis_cli::agent_contract::agent_contract_json())
            .expect("agent contract digest"),
        "LEOgHsfRM_QzaVP5w9kVqXtmTpiA2QKdPJStzfh6_oU"
    );
}
