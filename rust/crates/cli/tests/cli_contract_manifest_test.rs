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

    assert!(calls.iter().any(|value| value == "Auth.Sessions.Me"));
    assert!(calls.iter().any(|value| value == "Auth.Identities.List"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.IdentityEnvelopes.Revoke"));
    assert!(calls.iter().any(|value| value == "Auth.Deployments.Create"));
    assert!(!calls.iter().any(|value| value == "Auth.Envelopes.List"));
    assert!(!calls.iter().any(|value| value == "Auth.Envelopes.Get"));
    assert!(!calls.iter().any(|value| value == "Auth.Envelopes.Expand"));
    assert!(!calls
        .iter()
        .any(|value| value == "Auth.Envelopes.Changes.Preview"));
    assert!(!calls
        .iter()
        .any(|value| value == "Auth.EnvelopeExpansions.Approve"));
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
    assert!(!calls.iter().any(|value| value == "Auth.Users.Update"));

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
        trellis_auth::contract_digest(trellis_cli::agent_contract::agent_contract_json())
            .expect("agent contract digest"),
        "bQKziOoOmzLq77RUIrPtznMFlut-9qvktkowjNJpJYs"
    );
}
