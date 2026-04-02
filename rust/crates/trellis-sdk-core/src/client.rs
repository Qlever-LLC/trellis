//! Thin typed client helpers for `trellis.core@v1`.

use trellis_client::TrellisClientError;

/// Typed API wrapper for the `trellis.core@v1` contract.
pub struct CoreClient<'a> {
    inner: &'a trellis_client::TrellisClient,
}

impl<'a> CoreClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {
        Self { inner }
    }

    /// Call `Trellis.Bindings.Get`.
    pub async fn trellis_bindings_get(
        &self,
        input: &crate::types::TrellisBindingsGetRequest,
    ) -> Result<crate::types::TrellisBindingsGetResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::TrellisBindingsGetRpc>(input)
            .await
    }

    /// Call `Trellis.Catalog`.
    pub async fn trellis_catalog(
        &self,
    ) -> Result<crate::types::TrellisCatalogResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::TrellisCatalogRpc>(&crate::rpc::Empty {})
            .await
    }

    /// Call `Trellis.Contract.Get`.
    pub async fn trellis_contract_get(
        &self,
        input: &crate::types::TrellisContractGetRequest,
    ) -> Result<crate::types::TrellisContractGetResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::TrellisContractGetRpc>(input)
            .await
    }
}
