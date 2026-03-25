//! Thin typed client helpers for `trellis.activity@v1`.

use trellis_client::TrellisClientError;

/// Typed API wrapper for the `trellis.activity@v1` contract.
pub struct ActivityClient<'a> {
    inner: &'a trellis_client::TrellisClient,
}

impl<'a> ActivityClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {
        Self { inner }
    }

    /// Call `Activity.Get`.
    pub async fn activity_get(&self, input: &crate::types::ActivityGetRequest) -> Result<crate::types::ActivityGetResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::ActivityGetRpc>(input).await
    }

    /// Call `Activity.Health`.
    pub async fn activity_health(&self) -> Result<crate::types::ActivityHealthResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::ActivityHealthRpc>(&crate::rpc::Empty {}).await
    }

    /// Call `Activity.List`.
    pub async fn activity_list(&self, input: &crate::types::ActivityListRequest) -> Result<crate::types::ActivityListResponse, TrellisClientError> {
        self.inner.call::<crate::rpc::ActivityListRpc>(input).await
    }

    /// Publish `Activity.Recorded`.
    pub async fn publish_activity_recorded(&self, event: &crate::types::ActivityRecordedEvent) -> Result<(), TrellisClientError> {
        self.inner.publish::<crate::events::ActivityRecordedEventDescriptor>(event).await
    }

}

