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
    /// Call `State.Admin.Delete`.
    pub async fn state_admin_delete(
        &self,
        input: &super::types::StateAdminDeleteRequest,
    ) -> Result<super::types::StateAdminDeleteResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::StateAdminDeleteRpc>(input)
            .await
    }
    /// Call `State.Admin.Get`.
    pub async fn state_admin_get(
        &self,
        input: &super::types::StateAdminGetRequest,
    ) -> Result<super::types::StateAdminGetResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StateAdminGetRpc>(input).await
    }
    /// Call `State.Admin.List`.
    pub async fn state_admin_list(
        &self,
        input: &super::types::StateAdminListRequest,
    ) -> Result<super::types::StateAdminListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::StateAdminListRpc>(input)
            .await
    }
    /// Call `State.Delete`.
    pub async fn state_delete(
        &self,
        input: &super::types::StateDeleteRequest,
    ) -> Result<super::types::StateDeleteResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StateDeleteRpc>(input).await
    }
    /// Call `State.Get`.
    pub async fn state_get(
        &self,
        input: &super::types::StateGetRequest,
    ) -> Result<super::types::StateGetResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StateGetRpc>(input).await
    }
    /// Call `State.List`.
    pub async fn state_list(
        &self,
        input: &super::types::StateListRequest,
    ) -> Result<super::types::StateListResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StateListRpc>(input).await
    }
    /// Call `State.Put`.
    pub async fn state_put(
        &self,
        input: &super::types::StatePutRequest,
    ) -> Result<super::types::StatePutResponse, TrellisClientError> {
        self.inner.call::<super::rpc::StatePutRpc>(input).await
    }
}
