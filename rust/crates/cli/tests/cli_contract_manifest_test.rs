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

    assert!(calls.iter().any(|value| value == "Auth.Me"));
    assert!(calls.iter().any(|value| value == "Auth.ListApprovals"));
    assert!(calls.iter().any(|value| value == "Auth.RevokeApproval"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.CreateServiceProfile"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ApplyServiceProfileContract"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.UnapplyServiceProfileContract"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ListServiceProfiles"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DisableServiceProfile"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.EnableServiceProfile"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.RemoveServiceProfile"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ProvisionServiceInstance"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ListServiceInstances"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DisableServiceInstance"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.EnableServiceInstance"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.RemoveServiceInstance"));
    assert!(calls.iter().any(|value| value == "Auth.CreatePortal"));
    assert!(calls.iter().any(|value| value == "Auth.ListPortals"));
    assert!(calls.iter().any(|value| value == "Auth.DisablePortal"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.GetLoginPortalDefault"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ListInstanceGrantPolicies"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.UpsertInstanceGrantPolicy"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DisableInstanceGrantPolicy"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.SetLoginPortalDefault"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ListLoginPortalSelections"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.SetLoginPortalSelection"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ClearLoginPortalSelection"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.GetDevicePortalDefault"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.SetDevicePortalDefault"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ListDevicePortalSelections"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.SetDevicePortalSelection"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ClearDevicePortalSelection"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.CreateDeviceProfile"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ApplyDeviceProfileContract"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.UnapplyDeviceProfileContract"));
    assert!(calls.iter().any(|value| value == "Auth.ListDeviceProfiles"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DisableDeviceProfile"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.EnableDeviceProfile"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.RemoveDeviceProfile"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ProvisionDeviceInstance"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ListDeviceInstances"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DisableDeviceInstance"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.EnableDeviceInstance"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.RemoveDeviceInstance"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ListDeviceActivations"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.RevokeDeviceActivation"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.ListDeviceActivationReviews"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.DecideDeviceActivationReview"));
    assert!(!calls.iter().any(|value| value == "Auth.InstallService"));
    assert!(!calls
        .iter()
        .any(|value| value == "Auth.UpgradeServiceContract"));
    assert!(!calls.iter().any(|value| value == "Auth.RemoveService"));

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
