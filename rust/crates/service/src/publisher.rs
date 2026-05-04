use bytes::Bytes;

use crate::{EventDescriptor, ServerError};

/// A thin descriptor-backed event publisher over NATS.
#[derive(Debug, Clone)]
pub struct EventPublisher {
    client: async_nats::Client,
}

impl EventPublisher {
    /// Wrap an existing NATS client.
    pub fn new(client: async_nats::Client) -> Self {
        Self { client }
    }

    /// Publish one descriptor-backed event.
    pub async fn publish<D>(&self, event: &D::Event) -> Result<(), ServerError>
    where
        D: EventDescriptor,
    {
        let payload = Bytes::from(serde_json::to_vec(event)?);
        self.client
            .publish(D::SUBJECT.to_string(), payload)
            .await
            .map_err(|error| ServerError::Nats(error.to_string()))?;
        Ok(())
    }
}
