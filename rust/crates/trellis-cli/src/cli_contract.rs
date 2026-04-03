use serde_json::Value;

const CLI_CONTRACT_JSON: &str = r#"{"description":"Drive Trellis operator RPC workflows from the Rust CLI.","displayName":"Trellis CLI","format":"trellis.contract.v1","id":"trellis.cli@v1","kind":"cli","uses":{"auth":{"contract":"trellis.auth@v1","rpc":{"call":["Auth.InstallService","Auth.ListApprovals","Auth.ListServices","Auth.Logout","Auth.Me","Auth.RenewBindingToken","Auth.RevokeApproval","Auth.UpgradeServiceContract"]}},"core":{"contract":"trellis.core@v1","rpc":{"call":["Trellis.Catalog","Trellis.Contract.Get"]}}}}"#;

#[allow(dead_code)]
/// Build the local contract used by the `trellis` CLI.
pub fn cli_contract_manifest() -> trellis_contracts::ContractManifest {
    trellis_contracts::parse_manifest(
        serde_json::from_str::<Value>(CLI_CONTRACT_JSON).expect("cli manifest json"),
    )
    .expect("cli manifest")
}

/// Render the canonical manifest JSON for the CLI contract.
pub fn cli_contract_json() -> String {
    CLI_CONTRACT_JSON.to_string()
}
