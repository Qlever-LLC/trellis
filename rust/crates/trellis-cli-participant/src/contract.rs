//! Contract metadata for the `trellis.cli@v1` participant.

use trellis_contracts::ContractManifest;

use crate::manifest_json::CONTRACT_JSON;

/// Canonical Trellis contract id.
pub const CONTRACT_ID: &str = "trellis.cli@v1";

/// Human-readable contract name.
pub const CONTRACT_NAME: &str = "Trellis CLI";

/// Build the local participant contract used by the `trellis` CLI.
pub fn contract_manifest() -> ContractManifest {
    serde_json::from_str(CONTRACT_JSON).expect("cli participant manifest")
}

/// Render the canonical manifest JSON for the CLI participant contract.
pub fn contract_json() -> String {
    CONTRACT_JSON.to_string()
}
