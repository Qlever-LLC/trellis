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
    /// Call `Jobs.Cancel`.
    pub async fn jobs_cancel(
        &self,
        input: &super::types::JobsCancelRequest,
    ) -> Result<super::types::JobsCancelResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsCancelRpc>(input).await
    }
    /// Call `Jobs.DismissDLQ`.
    pub async fn jobs_dismiss_dlq(
        &self,
        input: &super::types::JobsDismissDLQRequest,
    ) -> Result<super::types::JobsDismissDLQResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::JobsDismissDLQRpc>(input)
            .await
    }
    /// Call `Jobs.Get`.
    pub async fn jobs_get(
        &self,
        input: &super::types::JobsGetRequest,
    ) -> Result<super::types::JobsGetResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsGetRpc>(input).await
    }
    /// Call `Jobs.Health`.
    pub async fn jobs_health(
        &self,
    ) -> Result<super::types::JobsHealthResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::JobsHealthRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Jobs.List`.
    pub async fn jobs_list(
        &self,
        input: &super::types::JobsListRequest,
    ) -> Result<super::types::JobsListResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsListRpc>(input).await
    }
    /// Call `Jobs.ListDLQ`.
    pub async fn jobs_list_dlq(
        &self,
        input: &super::types::JobsListDLQRequest,
    ) -> Result<super::types::JobsListDLQResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsListDLQRpc>(input).await
    }
    /// Call `Jobs.ListServices`.
    pub async fn jobs_list_services(
        &self,
        input: &super::types::JobsListServicesRequest,
    ) -> Result<super::types::JobsListServicesResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::JobsListServicesRpc>(input)
            .await
    }
    /// Call `Jobs.ReplayDLQ`.
    pub async fn jobs_replay_dlq(
        &self,
        input: &super::types::JobsReplayDLQRequest,
    ) -> Result<super::types::JobsReplayDLQResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsReplayDLQRpc>(input).await
    }
    /// Call `Jobs.Retry`.
    pub async fn jobs_retry(
        &self,
        input: &super::types::JobsRetryRequest,
    ) -> Result<super::types::JobsRetryResponse, TrellisClientError> {
        self.inner.call::<super::rpc::JobsRetryRpc>(input).await
    }
}
