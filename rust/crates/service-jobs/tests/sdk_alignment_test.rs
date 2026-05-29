use trellis_rs::sdk::jobs::contract as generated_contract;
use trellis_rs::sdk::jobs::rpc as generated_rpc;
use trellis_service_jobs as service_contract;

#[path = "../contracts/trellis_jobs.rs"]
mod jobs_contract_source;

#[test]
fn service_contract_constants_match_generated_jobs_sdk() {
    assert_eq!(
        service_contract::CONTRACT_ID,
        generated_contract::CONTRACT_ID
    );
    assert_eq!(
        service_contract::CONTRACT_DIGEST,
        generated_contract::CONTRACT_DIGEST
    );
}

#[test]
fn service_contract_reexports_generated_rpc_module() {
    let _: std::marker::PhantomData<service_contract::rpc::JobsHealthRpc> =
        std::marker::PhantomData::<generated_rpc::JobsHealthRpc>;
}

#[test]
fn service_contract_manifest_matches_generated_jobs_sdk() {
    assert_eq!(
        service_contract::contract_manifest(),
        generated_contract::contract_manifest()
    );
}

#[test]
fn rust_builder_manifest_matches_generated_jobs_sdk() {
    assert_eq!(
        jobs_contract_source::contract_manifest().expect("jobs contract builder manifest"),
        generated_contract::contract_manifest()
    );
}

#[test]
fn generated_jobs_contract_uses_scoped_rpc_capability_names() {
    let contract = generated_contract::contract_manifest();

    assert!(contract
        .capabilities
        .contains_key("trellis.jobs::admin.read"));
    assert!(contract
        .capabilities
        .contains_key("trellis.jobs::admin.mutate"));

    let jobs_cancel = contract.rpc.get("Jobs.Cancel").expect("Jobs.Cancel rpc");
    assert_eq!(
        jobs_cancel
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.as_ref()),
        Some(&vec!["trellis.jobs::admin.mutate".to_string()])
    );

    let jobs_get = contract.rpc.get("Jobs.Get").expect("Jobs.Get rpc");
    assert_eq!(
        jobs_get
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.as_ref()),
        Some(&vec!["trellis.jobs::admin.read".to_string()])
    );
}

#[test]
fn generated_jobs_contract_declares_runtime_core_bootstrap_uses() {
    let contract = generated_contract::contract_manifest();
    let core_use = contract.uses.get("core").expect("core use");

    assert_eq!(core_use.contract, "trellis.core@v1");
    assert_eq!(
        core_use.rpc.as_ref().and_then(|rpc| rpc.call.as_ref()),
        Some(&vec![
            "Trellis.Bindings.Get".to_string(),
            "Trellis.Catalog".to_string(),
        ])
    );
}

#[test]
fn expected_contract_uses_generated_jobs_sdk_metadata() {
    let expected = service_contract::expected_contract();
    assert_eq!(expected.id, generated_contract::CONTRACT_ID);
    assert_eq!(expected.digest, generated_contract::CONTRACT_DIGEST);
}
