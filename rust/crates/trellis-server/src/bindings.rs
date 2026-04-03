use crate::ServerError;

/// Contract identifier and digest pair used for bootstrap checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapContractRef {
    pub id: String,
    pub digest: String,
}

/// Resolved active binding for one service session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapBinding {
    pub contract_id: String,
    pub digest: String,
}

/// Validate that the expected contract is active and bindings match it.
pub fn validate_bootstrap_contract_state(
    service_name: &str,
    expected: &BootstrapContractRef,
    catalog_contracts: &[BootstrapContractRef],
    binding: Option<&BootstrapBinding>,
) -> Result<BootstrapBinding, ServerError> {
    let is_active = catalog_contracts
        .iter()
        .any(|contract| contract.id == expected.id && contract.digest == expected.digest);

    if !is_active {
        return Err(ServerError::BootstrapInactiveContract {
            service_name: service_name.to_string(),
            contract_id: expected.id.clone(),
            contract_digest: expected.digest.clone(),
        });
    }

    let binding = binding.ok_or_else(|| ServerError::BootstrapMissingBinding {
        service_name: service_name.to_string(),
        contract_id: expected.id.clone(),
        contract_digest: expected.digest.clone(),
    })?;

    if binding.contract_id != expected.id || binding.digest != expected.digest {
        return Err(ServerError::BootstrapBindingMismatch {
            service_name: service_name.to_string(),
            expected_contract_id: expected.id.clone(),
            expected_contract_digest: expected.digest.clone(),
            actual_contract_id: binding.contract_id.clone(),
            actual_contract_digest: binding.digest.clone(),
        });
    }

    Ok(binding.clone())
}
