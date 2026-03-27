//! Thin typed client helpers for `trellis.jobs@v1`.

use trellis_client::TrellisClientError;

/// Typed API wrapper for the `trellis.jobs@v1` contract.
pub struct JobsClient<'a> {
    inner: &'a trellis_client::TrellisClient,
}

impl<'a> JobsClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {
        Self { inner }
    }

    /// Call `Jobs.Cancel`.
    pub async fn jobs_cancel(&self, input: &crate::types::JobsCancelRequest) -> Result<crate::types::JobsCancelResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::JobsCancelRpc>(input).await
    }

    /// Call `Jobs.Get`.
    pub async fn jobs_get(&self, input: &crate::types::JobsGetRequest) -> Result<crate::types::JobsGetResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::JobsGetRpc>(input).await
    }

    /// Call `Jobs.Health`.
    pub async fn jobs_health(&self) -> Result<crate::types::JobsHealthResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::JobsHealthRpc>(&crate::rpc::Empty {}).await
    }

    /// Call `Jobs.List`.
    pub async fn jobs_list(&self, input: &crate::types::JobsListRequest) -> Result<crate::types::JobsListResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::JobsListRpc>(input).await
    }

    /// Call `Jobs.ListServices`.
    pub async fn jobs_list_services(&self) -> Result<crate::types::JobsListServicesResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::JobsListServicesRpc>(&crate::rpc::Empty {}).await
    }

    /// Call `Jobs.Retry`.
    pub async fn jobs_retry(&self, input: &crate::types::JobsRetryRequest) -> Result<crate::types::JobsRetryResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::JobsRetryRpc>(input).await
    }

}

