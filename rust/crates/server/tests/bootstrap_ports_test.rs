use std::sync::Mutex;

use futures_util::future::{ready, BoxFuture, FutureExt};
use trellis_server::{
    resolve_bootstrap_binding, BootstrapBinding, BootstrapBindingInfo, BootstrapContractRef,
    CoreBootstrapPort, ServerError,
};

struct StubCorePort {
    catalog: Mutex<Option<Result<Vec<BootstrapContractRef>, ServerError>>>,
    binding: Mutex<Option<Result<Option<BootstrapBinding>, ServerError>>>,
}

impl CoreBootstrapPort for StubCorePort {
    type Binding = BootstrapBinding;

    fn fetch_catalog_contracts<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<BootstrapContractRef>, ServerError>> {
        let result = self
            .catalog
            .lock()
            .expect("lock catalog")
            .take()
            .expect("catalog result should be available");
        ready(result).boxed()
    }

    fn fetch_binding<'a>(
        &'a self,
        _expected: &'a BootstrapContractRef,
    ) -> BoxFuture<'a, Result<Option<BootstrapBinding>, ServerError>> {
        let result = self
            .binding
            .lock()
            .expect("lock binding")
            .take()
            .expect("binding result should be available");
        ready(result).boxed()
    }
}

fn expected_contract() -> BootstrapContractRef {
    BootstrapContractRef {
        id: "trellis.jobs@v1".to_string(),
        digest: "sha256:expected".to_string(),
    }
}

#[tokio::test]
async fn resolve_bootstrap_binding_happy_path() {
    let expected = expected_contract();
    let core = StubCorePort {
        catalog: Mutex::new(Some(Ok(vec![expected.clone()]))),
        binding: Mutex::new(Some(Ok(Some(BootstrapBinding {
            contract_id: expected.id.clone(),
            digest: expected.digest.clone(),
        })))),
    };

    let binding = resolve_bootstrap_binding("jobs-service", &expected, &core)
        .await
        .expect("bootstrap validation should succeed");

    assert_eq!(binding.bootstrap_binding().contract_id, expected.id);
    assert_eq!(binding.bootstrap_binding().digest, expected.digest);
}

#[tokio::test]
async fn resolve_bootstrap_binding_rejects_inactive_contract() {
    let expected = expected_contract();
    let core = StubCorePort {
        catalog: Mutex::new(Some(Ok(vec![BootstrapContractRef {
            id: expected.id.clone(),
            digest: "sha256:other".to_string(),
        }]))),
        binding: Mutex::new(Some(Ok(Some(BootstrapBinding {
            contract_id: expected.id.clone(),
            digest: expected.digest.clone(),
        })))),
    };

    let result = resolve_bootstrap_binding("jobs-service", &expected, &core).await;

    assert!(matches!(
        result,
        Err(ServerError::BootstrapInactiveContract {
            service_name,
            contract_id,
            contract_digest,
        }) if service_name == "jobs-service" && contract_id == expected.id && contract_digest == expected.digest
    ));
}

#[tokio::test]
async fn resolve_bootstrap_binding_propagates_port_error() {
    let expected = expected_contract();
    let core = StubCorePort {
        catalog: Mutex::new(Some(Err(ServerError::MissingHandler(
            "rpc.v1.Trellis.Catalog".to_string(),
        )))),
        binding: Mutex::new(Some(Ok(None))),
    };

    let result = resolve_bootstrap_binding("jobs-service", &expected, &core).await;

    assert!(matches!(
        result,
        Err(ServerError::MissingHandler(subject)) if subject == "rpc.v1.Trellis.Catalog"
    ));
}
