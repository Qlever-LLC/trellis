use serde::{de::DeserializeOwned, Serialize};

/// Metadata required to call one typed Trellis RPC.
pub trait RpcDescriptor {
    /// Request payload type.
    type Input: Serialize;

    /// Success payload type.
    type Output: DeserializeOwned;

    /// Logical contract key for the RPC.
    const KEY: &'static str;

    /// Concrete NATS subject for the RPC.
    const SUBJECT: &'static str;

    /// Capability requirements declared for callers.
    const CALLER_CAPABILITIES: &'static [&'static str];

    /// Known error variants declared by the contract.
    const ERRORS: &'static [&'static str];
}

/// Metadata required to publish one typed Trellis event.
pub trait EventDescriptor {
    /// Event payload type.
    type Event: Serialize + DeserializeOwned;

    /// Logical contract key for the event.
    const KEY: &'static str;

    /// Concrete NATS subject for the event.
    const SUBJECT: &'static str;
}

/// Metadata required to subscribe to one typed Trellis feed.
pub trait FeedDescriptor {
    /// Feed subscription input type.
    type Input: Serialize;

    /// Feed event payload type.
    type Event: DeserializeOwned;

    /// Logical contract key for the feed.
    const KEY: &'static str;

    /// Concrete NATS subject for the feed.
    const SUBJECT: &'static str;

    /// Capability requirements declared for subscribers.
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str];
}
