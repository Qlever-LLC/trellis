//! Thin typed client helpers for `trellis.health@v1`.
use crate::client::TrellisClientError;
/// Typed API wrapper for the `trellis.health@v1` contract.
pub struct HealthClient<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> HealthClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a crate::client::TrellisClient) -> Self {
        Self { inner }
    }
    /// Publish `Health.Heartbeat`.
    pub async fn publish_health_heartbeat(
        &self,
        event: &super::types::HealthHeartbeatEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::HealthHeartbeatEventDescriptor>(event)
            .await
    }
}
