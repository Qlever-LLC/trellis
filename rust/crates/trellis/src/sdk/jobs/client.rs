//! Thin typed client helpers for `trellis.jobs@v1`.
use crate::client::TrellisClientError;
/// Typed API wrapper for the `trellis.jobs@v1` contract.
pub struct JobsClient<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> JobsClient<'a> {
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
    pub fn jobs(&self) -> JobsRpc<'a> {
        JobsRpc { inner: self._inner }
    }
}
pub struct JobsRpc<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> JobsRpc<'a> {
    /// Call `Jobs.Cancel`.
    pub async fn cancel(
        &self,
        input: &super::types::JobsCancelRequest,
    ) -> Result<super::types::JobsCancelResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsCancelRpc>(input).await
    }
    /// Call `Jobs.DismissDLQ`.
    pub async fn dismiss_dlq(
        &self,
        input: &super::types::JobsDismissDLQRequest,
    ) -> Result<super::types::JobsDismissDLQResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::JobsDismissDLQRpc>(input)
            .await
    }
    /// Call `Jobs.Get`.
    pub async fn get(
        &self,
        input: &super::types::JobsGetRequest,
    ) -> Result<super::types::JobsGetResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsGetRpc>(input).await
    }
    /// Call `Jobs.Health`.
    pub async fn health(&self) -> Result<super::types::JobsHealthResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::JobsHealthRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Jobs.List`.
    pub async fn list(
        &self,
        input: &super::types::JobsListRequest,
    ) -> Result<super::types::JobsListResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsListRpc>(input).await
    }
    /// Call `Jobs.ListDLQ`.
    pub async fn list_dlq(
        &self,
        input: &super::types::JobsListDLQRequest,
    ) -> Result<super::types::JobsListDLQResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsListDLQRpc>(input).await
    }
    /// Call `Jobs.ListServices`.
    pub async fn list_services(
        &self,
        input: &super::types::JobsListServicesRequest,
    ) -> Result<super::types::JobsListServicesResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::JobsListServicesRpc>(input)
            .await
    }
    /// Call `Jobs.ReplayDLQ`.
    pub async fn replay_dlq(
        &self,
        input: &super::types::JobsReplayDLQRequest,
    ) -> Result<super::types::JobsReplayDLQResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsReplayDLQRpc>(input).await
    }
    /// Call `Jobs.Retry`.
    pub async fn retry(
        &self,
        input: &super::types::JobsRetryRequest,
    ) -> Result<super::types::JobsRetryResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsRetryRpc>(input).await
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
