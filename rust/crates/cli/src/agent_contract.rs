const AGENT_CONTRACT_JSON: &str = r#"{
  "description": "Drive Trellis operator RPC workflows from the Rust agent.",
  "displayName": "Trellis Agent",
  "format": "trellis.contract.v1",
  "id": "trellis.agent@v1",
  "kind": "agent",
  "uses": {
    "auth": {
      "contract": "trellis.auth@v1",
      "rpc": {
        "call": [
          "Auth.Deployments.Create",
          "Auth.DeviceUserAuthorities.Reviews.Decide",
          "Auth.Devices.Disable",
          "Auth.Deployments.Disable",
          "Auth.ServiceInstances.Disable",
          "Auth.Devices.Enable",
          "Auth.Deployments.Enable",
          "Auth.ServiceInstances.Enable",
          "Auth.Identities.List",
          "Auth.DeviceUserAuthorities.Reviews.List",
          "Auth.DeviceUserAuthorities.List",
          "Auth.Devices.List",
          "Auth.Deployments.List",
          "Auth.ServiceInstances.List",
          "Auth.Sessions.Logout",
          "Auth.Sessions.Me",
          "Auth.Devices.Provision",
          "Auth.ServiceInstances.Provision",
          "Auth.Devices.Remove",
          "Auth.Deployments.Remove",
          "Auth.ServiceInstances.Remove",
          "Auth.IdentityEnvelopes.Revoke",
          "Auth.DeviceUserAuthorities.Revoke"
        ]
      }
    },
    "core": {
      "contract": "trellis.core@v1",
      "rpc": {
        "call": ["Trellis.Catalog", "Trellis.Contract.Get"]
      }
    }
  }
}"#;

/// Render the canonical manifest JSON for the Trellis agent contract.
pub fn agent_contract_json() -> &'static str {
    AGENT_CONTRACT_JSON
}
