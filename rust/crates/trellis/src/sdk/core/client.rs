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
    #[allow(dead_code)]
    pub(crate) fn inner(&self) -> &'a crate::client::TrellisClient {
        self.inner
    }
    /// Access typed RPC calls.
    pub fn rpc(&self) -> Rpc<'a> {
        Rpc { _inner: self.inner }
    }
    /// Access typed events.
    pub fn event(&self) -> Event<'a> {
        Event { _inner: self.inner }
    }
    /// Access typed feeds.
    pub fn feed(&self) -> Feed<'a> {
        Feed { _inner: self.inner }
    }
    /// Access typed operations.
    pub fn operation(&self) -> Operation<'a> {
        Operation { _inner: self.inner }
    }
}
/// Typed RPC surface.
pub struct Rpc<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Rpc<'a> {
    pub fn trellis(&self) -> TrellisRpc<'a> {
        TrellisRpc { inner: self._inner }
    }
}
pub struct TrellisRpc<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> TrellisRpc<'a> {
    /// Call `Trellis.Catalog`.
    pub async fn catalog(
        &self,
    ) -> Result<super::types::TrellisCatalogResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::TrellisCatalogRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Trellis.Contract.Get`.
    pub async fn contract_get(
        &self,
        input: &super::types::TrellisContractGetRequest,
    ) -> Result<super::types::TrellisContractGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::TrellisContractGetRpc>(input)
            .await
    }
    /// Call `Trellis.Surface.Status`.
    pub async fn surface_status(
        &self,
        input: &super::types::TrellisSurfaceStatusRequest,
    ) -> Result<super::types::TrellisSurfaceStatusResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::TrellisSurfaceStatusRpc>(input)
            .await
    }
}
/// Typed event surface.
pub struct Event<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Event<'a> {}
/// Typed feed surface.
pub struct Feed<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Feed<'a> {}
/// Typed operation surface.
pub struct Operation<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Operation<'a> {}
