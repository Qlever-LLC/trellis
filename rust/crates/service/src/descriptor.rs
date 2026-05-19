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

    /// Capability requirements declared for callers.
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
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

/// Metadata required to mount one typed Trellis feed handler.
pub trait FeedDescriptor {
    /// Feed subscription input type.
    type Input: DeserializeOwned + Send + 'static;

    /// Feed event payload type.
    type Event: Serialize + Send + 'static;

    /// Logical contract key for the feed.
    const KEY: &'static str;

    /// Concrete NATS subject for the feed.
    const SUBJECT: &'static str;

    /// Capability requirements declared for subscribers.
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}
