use trellis_server::{
    validate_bootstrap_contract_state, BootstrapBinding, BootstrapContractRef, ServerError,
};

fn expected_contract() -> BootstrapContractRef {
    BootstrapContractRef {
        id: "trellis.jobs@v1".to_string(),
        digest: "sha256:expected".to_string(),
    }
}

#[test]
fn validate_bootstrap_contract_state_rejects_inactive_contract_digest() {
    let expected = expected_contract();
    let catalog = vec![BootstrapContractRef {
        id: expected.id.clone(),
        digest: "sha256:different".to_string(),
    }];
    let binding = BootstrapBinding {
        contract_id: expected.id.clone(),
        digest: expected.digest.clone(),
    };

    let result =
        validate_bootstrap_contract_state("jobs-service", &expected, &catalog, Some(&binding));

    assert!(matches!(
        result,
        Err(ServerError::BootstrapInactiveContract {
            service_name,
            contract_id,
            contract_digest,
        }) if service_name == "jobs-service" && contract_id == expected.id && contract_digest == expected.digest
    ));
}

#[test]
fn validate_bootstrap_contract_state_rejects_binding_mismatch() {
    let expected = expected_contract();
    let catalog = vec![expected.clone()];
    let binding = BootstrapBinding {
        contract_id: expected.id.clone(),
        digest: "sha256:unexpected".to_string(),
    };

    let result =
        validate_bootstrap_contract_state("jobs-service", &expected, &catalog, Some(&binding));

    assert!(matches!(
        result,
        Err(ServerError::BootstrapBindingMismatch {
            service_name,
            expected_contract_id,
            expected_contract_digest,
            actual_contract_id,
            actual_contract_digest,
        }) if service_name == "jobs-service"
            && expected_contract_id == expected.id
            && expected_contract_digest == expected.digest
            && actual_contract_id == expected.id
            && actual_contract_digest == "sha256:unexpected"
    ));
}

#[test]
fn validate_bootstrap_contract_state_returns_binding_on_happy_path() {
    let expected = expected_contract();
    let catalog = vec![expected.clone()];
    let binding = BootstrapBinding {
        contract_id: expected.id.clone(),
        digest: expected.digest.clone(),
    };

    let validated =
        validate_bootstrap_contract_state("jobs-service", &expected, &catalog, Some(&binding))
            .expect("bootstrap validation should succeed");

    assert_eq!(validated, binding);
}
