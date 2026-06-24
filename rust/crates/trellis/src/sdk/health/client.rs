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
impl<'a> Rpc<'a> {}
/// Typed event surface.
pub struct Event<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Event<'a> {
    pub fn health(&self) -> HealthEvent<'a> {
        HealthEvent { inner: self._inner }
    }
}
pub struct HealthEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> HealthEvent<'a> {
    pub fn heartbeat(&self) -> HealthHeartbeatEvent<'a> {
        HealthHeartbeatEvent { inner: self.inner }
    }
}
pub struct HealthHeartbeatEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> HealthHeartbeatEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::HealthHeartbeatEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::HealthHeartbeatEventDescriptor>(event)
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::HealthHeartbeatEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe_with_options::<super::events::HealthHeartbeatEventDescriptor>(
                crate::client::EventSubscribeOptions {
                    stream: None,
                    mode: crate::client::EventSubscriptionMode::Ephemeral,
                    replay: crate::client::EventReplayPolicy::New,
                    durable_name: None,
                },
            )
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
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
