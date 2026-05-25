//! Thin typed client helpers for `trellis.state@v1`.
use crate::client::TrellisClientError;
/// Typed API wrapper for the `trellis.state@v1` contract.
pub struct StateClient<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> StateClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a crate::client::TrellisClient) -> Self {
        Self { inner }
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
    pub fn state(&self) -> StateRpc<'a> {
        StateRpc { inner: self._inner }
    }
}
pub struct StateRpc<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> StateRpc<'a> {
    /// Call `State.Admin.Delete`.
    pub async fn admin_delete(
        &self,
        input: &super::types::StateAdminDeleteRequest,
    ) -> Result<super::types::StateAdminDeleteResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::StateAdminDeleteRpc>(input)
            .await
    }
    /// Call `State.Admin.Get`.
    pub async fn admin_get(
        &self,
        input: &super::types::StateAdminGetRequest,
    ) -> Result<super::types::StateAdminGetResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StateAdminGetRpc>(input).await
    }
    /// Call `State.Admin.List`.
    pub async fn admin_list(
        &self,
        input: &super::types::StateAdminListRequest,
    ) -> Result<super::types::StateAdminListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::StateAdminListRpc>(input)
            .await
    }
    /// Call `State.Delete`.
    pub async fn delete(
        &self,
        input: &super::types::StateDeleteRequest,
    ) -> Result<super::types::StateDeleteResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StateDeleteRpc>(input).await
    }
    /// Call `State.Get`.
    pub async fn get(
        &self,
        input: &super::types::StateGetRequest,
    ) -> Result<super::types::StateGetResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StateGetRpc>(input).await
    }
    /// Call `State.List`.
    pub async fn list(
        &self,
        input: &super::types::StateListRequest,
    ) -> Result<super::types::StateListResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StateListRpc>(input).await
    }
    /// Call `State.Put`.
    pub async fn put(
        &self,
        input: &super::types::StatePutRequest,
    ) -> Result<super::types::StatePutResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StatePutRpc>(input).await
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
