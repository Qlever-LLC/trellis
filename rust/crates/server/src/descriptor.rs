use serde::{de::DeserializeOwned, Serialize};

/// Metadata required to mount one typed Trellis RPC handler.
pub trait RpcDescriptor {
    /// Request payload type.
    type Input: DeserializeOwned + Send + 'static;

    /// Success payload type.
    type Output: Serialize + Send + 'static;

    /// Logical contract key for the RPC.
    const KEY: &'static str;

    /// Concrete NATS subject for the RPC.
    const SUBJECT: &'static str;
}

/// Metadata required to publish one typed Trellis event.
pub trait EventDescriptor {
    /// Event payload type.
    type Event: Serialize + DeserializeOwned + Send + Sync + 'static;

    /// Logical contract key for the event.
    const KEY: &'static str;

    /// Concrete NATS subject for the event.
    const SUBJECT: &'static str;
}
