const AGENT_CONTRACT_JSON: &str = r#"{
  "description": "Drive Trellis operator RPC workflows from the Rust agent.",
  "displayName": "Trellis Agent",
  "format": "trellis.contract.v1",
  "id": "trellis.agent@v1",
  "kind": "agent",
  "uses": {
    "required": {
      "auth": {
        "contract": "trellis.auth@v1",
        "rpc": {
          "call": [
            "Auth.Deployments.Create",
            "Auth.DeviceUserAuthorities.Reviews.Decide",
            "Auth.AccountFlows.CreatePasswordSetup",
            "Auth.Capabilities.List",
            "Auth.CapabilityGroups.List",
            "Auth.Devices.Disable",
            "Auth.Deployments.Disable",
            "Auth.EnvelopeExpansions.Approve",
            "Auth.EnvelopeExpansions.List",
            "Auth.EnvelopeExpansions.Reject",
            "Auth.Envelopes.Get",
            "Auth.Envelopes.List",
            "Auth.Envelopes.Expand",
            "Auth.Envelopes.GrantOverrides.Put",
            "Auth.Envelopes.GrantOverrides.Remove",
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
            "Auth.Sessions.List",
            "Auth.Sessions.Logout",
            "Auth.Sessions.Me",
            "Auth.Users.List",
            "Auth.Users.Get",
            "Auth.Users.Create",
            "Auth.Users.Update",
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
  }
}"#;

/// Render the canonical manifest JSON for the Trellis agent contract.
pub fn agent_contract_json() -> &'static str {
    AGENT_CONTRACT_JSON
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::agent_contract_json;

    #[test]
    fn agent_contract_declares_required_auth_rpc_uses() {
        let manifest: Value =
            serde_json::from_str(agent_contract_json()).expect("agent contract should be JSON");
        let calls = manifest["uses"]["required"]["auth"]["rpc"]["call"]
            .as_array()
            .expect("agent contract should declare required auth RPC calls");

        assert!(calls.iter().any(|call| call == "Auth.Sessions.Me"));
        assert!(manifest["uses"].get("auth").is_none());
    }
}
