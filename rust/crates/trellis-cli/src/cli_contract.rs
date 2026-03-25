#[allow(dead_code)]
/// Build the local participant contract used by the `trellis` CLI.
pub fn cli_contract_manifest() -> trellis_contracts::ContractManifest {
    trellis_cli_participant::contract::contract_manifest()
}

/// Render the canonical manifest JSON for the CLI participant contract.
pub fn cli_contract_json() -> String {
    trellis_cli_participant::contract::contract_json()
}
