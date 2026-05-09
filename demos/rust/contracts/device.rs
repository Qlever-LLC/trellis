use trellis_contracts::{
    state, use_contract, ContractKind, ContractManifest, ContractManifestBuilder,
    ContractStateKind, ContractsError,
};

/// Build the Rust-authored Field Device demo contract manifest.
pub fn contract_manifest() -> Result<ContractManifest, ContractsError> {
    ContractManifestBuilder::new(
        "trellis.demo-device@v1",
        "Field Device Demo",
        "Activated Field Device TUI for the consolidated demo.",
        ContractKind::Device,
    )
    .schema(
        "SelectedSiteState",
        serde_json::json!({
            "type": "object",
            "required": ["siteId", "siteName", "selectedAt"],
            "properties": {
                "siteId": {"type": "string"},
                "siteName": {"type": "string"},
                "selectedAt": {"type": "string", "format": "date-time"}
            }
        }),
    )
    .schema(
        "DraftInspectionState",
        serde_json::json!({
            "type": "object",
            "required": ["inspectionId", "siteId", "checklistName", "notes", "updatedAt"],
            "properties": {
                "inspectionId": {"type": "string"},
                "siteId": {"type": "string"},
                "checklistName": {"type": "string"},
                "notes": {"type": "string"},
                "updatedAt": {"type": "string", "format": "date-time"}
            }
        }),
    )
    .state(
        "selectedSite",
        state(ContractStateKind::Value, "SelectedSiteState").state_version("selected-site.v1"),
    )
    .state(
        "draftInspections",
        state(ContractStateKind::Map, "DraftInspectionState").state_version("draft-inspection.v1"),
    )
    .use_ref(
        "fieldOps",
        use_contract("trellis.demo-service@v1")
            .with_rpc_call([
                "Assignments.List",
                "Evidence.Download",
                "Evidence.List",
                "Sites.Get",
                "Sites.List",
            ])
            .with_operation_call(["Evidence.Upload", "Reports.Generate", "Sites.Refresh"])
            .with_event_subscribe([
                "Activity.Recorded",
                "Evidence.Uploaded",
                "Reports.Published",
                "Sites.Refreshed",
            ]),
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "state",
        use_contract("trellis.state@v1").with_rpc_call([
            "State.Delete",
            "State.Get",
            "State.List",
            "State.Put",
        ]),
    )
    .build()
}
