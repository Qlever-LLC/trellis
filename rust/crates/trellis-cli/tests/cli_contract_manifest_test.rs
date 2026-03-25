#[test]
fn cli_contract_manifest_validates_and_declares_expected_auth_and_core_surface() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path = temp_dir.path().join("trellis.cli@v1.json");
    std::fs::write(
        &manifest_path,
        format!("{}\n", trellis_cli::cli_contract::cli_contract_json()),
    )
    .expect("write cli contract manifest");

    let loaded =
        trellis_contracts::load_manifest(&manifest_path).expect("load cli contract manifest");

    assert_eq!(loaded.manifest.id, "trellis.cli@v1");
    assert_eq!(loaded.manifest.display_name, "Trellis CLI");
    assert_eq!(loaded.manifest.kind, "cli");

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
    assert!(calls.iter().any(|value| value == "Auth.RenewBindingToken"));
    assert!(calls.iter().any(|value| value == "Auth.ListApprovals"));
    assert!(calls.iter().any(|value| value == "Auth.RevokeApproval"));
    assert!(calls.iter().any(|value| value == "Auth.InstallService"));
    assert!(calls
        .iter()
        .any(|value| value == "Auth.UpgradeServiceContract"));

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
