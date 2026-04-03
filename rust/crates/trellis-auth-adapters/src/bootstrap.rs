use futures_util::future::BoxFuture;

use trellis_auth::{AuthClient, AuthGetInstalledContractRequest, AuthGetInstalledContractResponse};
use trellis_client::TrellisClientError;
use trellis_server::{BootstrapContractRef, ServerError};

pub trait AuthBootstrapClientPort: Send + Sync {
    fn auth_get_installed_contract<'a>(
        &'a self,
        input: &'a AuthGetInstalledContractRequest,
    ) -> BoxFuture<'a, Result<AuthGetInstalledContractResponse, TrellisClientError>>;
}

impl<'a> AuthBootstrapClientPort for AuthClient<'a> {
    fn auth_get_installed_contract<'b>(
        &'b self,
        input: &'b AuthGetInstalledContractRequest,
    ) -> BoxFuture<'b, Result<AuthGetInstalledContractResponse, TrellisClientError>> {
        Box::pin(async move { self.get_installed_contract(input).await })
    }
}

pub struct AuthBootstrapAdapter<C> {
    client: C,
}

impl<C> AuthBootstrapAdapter<C> {
    pub fn new(client: C) -> Self {
        Self { client }
    }
}

impl<C> AuthBootstrapAdapter<C>
where
    C: AuthBootstrapClientPort,
{
    pub async fn fetch_installed_contract(
        &self,
        expected: &BootstrapContractRef,
    ) -> Result<Option<BootstrapContractRef>, ServerError> {
        let request = make_get_installed_contract_request(expected);
        let result = self.client.auth_get_installed_contract(&request).await;
        map_get_installed_contract_result(result, "Auth.GetInstalledContract")
    }
}

pub fn make_get_installed_contract_request(
    expected: &BootstrapContractRef,
) -> AuthGetInstalledContractRequest {
    AuthGetInstalledContractRequest {
        digest: expected.digest.clone(),
    }
}

pub fn map_installed_contract_response(
    response: &AuthGetInstalledContractResponse,
) -> BootstrapContractRef {
    BootstrapContractRef {
        id: response.contract.id.clone(),
        digest: response.contract.digest.clone(),
    }
}

pub fn is_contract_not_found_validation_error(rpc_error_json: &str) -> bool {
    let value = match serde_json::from_str::<serde_json::Value>(rpc_error_json) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let normalized = value.to_string().to_ascii_lowercase();
    normalized.contains("validationerror") && normalized.contains("not found")
}

pub fn map_get_installed_contract_result(
    result: Result<AuthGetInstalledContractResponse, TrellisClientError>,
    subject: &'static str,
) -> Result<Option<BootstrapContractRef>, ServerError> {
    match result {
        Ok(response) => Ok(Some(map_installed_contract_response(&response))),
        Err(TrellisClientError::RpcError(payload))
            if is_contract_not_found_validation_error(&payload) =>
        {
            Ok(None)
        }
        Err(error) => Err(map_client_error(subject, error)),
    }
}

pub fn map_client_error(subject: &'static str, error: TrellisClientError) -> ServerError {
    ServerError::Nats(format!("bootstrap {subject} request failed: {error}"))
}
