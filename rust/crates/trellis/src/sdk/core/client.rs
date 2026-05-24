//! Thin typed client helpers for `trellis.core@v1`.
use crate::client::TrellisClientError;
/// Typed API wrapper for the `trellis.core@v1` contract.
pub struct CoreClient<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> CoreClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a crate::client::TrellisClient) -> Self {
        Self { inner }
    }
    /// Call `Trellis.Bindings.Get`.
    pub async fn trellis_bindings_get(
        &self,
        input: &super::types::TrellisBindingsGetRequest,
    ) -> Result<super::types::TrellisBindingsGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::TrellisBindingsGetRpc>(input)
            .await
    }
    /// Call `Trellis.Catalog`.
    pub async fn trellis_catalog(
        &self,
    ) -> Result<super::types::TrellisCatalogResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::TrellisCatalogRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Trellis.Contract.Get`.
    pub async fn trellis_contract_get(
        &self,
        input: &super::types::TrellisContractGetRequest,
    ) -> Result<super::types::TrellisContractGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::TrellisContractGetRpc>(input)
            .await
    }
    /// Call `Trellis.Surface.Status`.
    pub async fn trellis_surface_status(
        &self,
        input: &super::types::TrellisSurfaceStatusRequest,
    ) -> Result<super::types::TrellisSurfaceStatusResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::TrellisSurfaceStatusRpc>(input)
            .await
    }
}
