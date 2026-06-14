use super::{EventDescriptor, ServerError};
use crate::client::PreparedTrellisEvent;

/// A thin descriptor-backed event publisher over NATS.
#[derive(Debug, Clone)]
pub struct EventPublisher {
    client: async_nats::Client,
}

impl EventPublisher {
    pub(crate) fn new(client: async_nats::Client) -> Self {
        Self { client }
    }

    /// Publish one descriptor-backed event.
    pub async fn publish<D>(&self, event: &D::Event) -> Result<(), ServerError>
    where
        D: EventDescriptor,
    {
        let prepared =
            PreparedTrellisEvent::new(D::SUBJECT, bytes::Bytes::from(serde_json::to_vec(event)?));
        self.client
            .publish_with_headers(
                prepared.subject().to_string(),
                prepared.publish_headers(),
                prepared.payload_bytes(),
            )
            .await
            .map_err(|error| ServerError::Nats(error.to_string()))?;
        Ok(())
    }
}
