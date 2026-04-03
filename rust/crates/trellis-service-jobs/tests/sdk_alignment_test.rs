use trellis_sdk_jobs::contract as generated_contract;
use trellis_sdk_jobs::rpc as generated_rpc;
use trellis_service_jobs as service_contract;

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
fn generated_jobs_contract_uses_new_capability_names() {
    let contract = generated_contract::contract_manifest();

    let jobs_cancel = contract.rpc.get("Jobs.Cancel").expect("Jobs.Cancel rpc");
    assert_eq!(
        jobs_cancel
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.as_ref()),
        Some(&vec!["jobs.admin.mutate".to_string()])
    );

    let jobs_get = contract.rpc.get("Jobs.Get").expect("Jobs.Get rpc");
    assert_eq!(
        jobs_get
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.as_ref()),
        Some(&vec!["jobs.admin.read".to_string()])
    );

    let jobs_stream = contract
        .subjects
        .get("Jobs.Stream")
        .expect("Jobs.Stream subject");
    assert_eq!(
        jobs_stream
            .capabilities
            .as_ref()
            .and_then(|caps| caps.subscribe.as_ref()),
        Some(&vec!["jobs.admin.stream".to_string()])
    );
}

#[test]
fn expected_contract_uses_generated_jobs_sdk_metadata() {
    let expected = service_contract::expected_contract();
    assert_eq!(expected.id, generated_contract::CONTRACT_ID);
    assert_eq!(expected.digest, generated_contract::CONTRACT_DIGEST);
}
