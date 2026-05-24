pub mod bootstrap {
    use trellis::client::TrellisClientError;
    use trellis::sdk::core::types::{
        TrellisBindingsGetRequest, TrellisBindingsGetResponse, TrellisCatalogResponse,
    };
    use trellis::service::{BootstrapContractRef, ServerError};
    pub use trellis::service::{
        CoreBootstrapAdapter, CoreBootstrapBinding, CoreBootstrapClientPort,
    };

    pub fn make_bindings_get_request(expected: &BootstrapContractRef) -> TrellisBindingsGetRequest {
        TrellisBindingsGetRequest {
            contract_id: Some(expected.id.clone()),
            digest: Some(expected.digest.clone()),
        }
    }

    pub fn map_catalog_to_contract_refs(
        response: &TrellisCatalogResponse,
    ) -> Vec<BootstrapContractRef> {
        response
            .catalog
            .contracts
            .iter()
            .map(|contract| BootstrapContractRef {
                id: contract.id.clone(),
                digest: contract.digest.clone(),
            })
            .collect()
    }

    pub fn map_binding_response(
        response: &TrellisBindingsGetResponse,
    ) -> Option<CoreBootstrapBinding> {
        response.binding.clone().map(CoreBootstrapBinding::new)
    }

    pub fn map_client_error(subject: &'static str, error: TrellisClientError) -> ServerError {
        ServerError::Nats(format!("bootstrap {subject} request failed: {error}"))
    }
}

pub use trellis::service::{CoreBootstrapAdapter, CoreBootstrapBinding, CoreBootstrapClientPort};
