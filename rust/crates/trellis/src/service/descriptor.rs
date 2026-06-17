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

    const INPUT_SCHEMA_JSON: &'static str;
    const OUTPUT_SCHEMA_JSON: &'static str;
}

impl<D> RpcDescriptor for D
where
    D: crate::client::RpcDescriptor,
    D::Input: DeserializeOwned + Send + 'static,
    D::Output: Serialize + Send + 'static,
{
    type Input = D::Input;
    type Output = D::Output;

    const KEY: &'static str = D::KEY;
    const SUBJECT: &'static str = D::SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = D::CALLER_CAPABILITIES;
    const INPUT_SCHEMA_JSON: &'static str = D::INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = D::OUTPUT_SCHEMA_JSON;
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

impl<D> EventDescriptor for D
where
    D: crate::client::EventDescriptor,
    D::Event: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    type Event = D::Event;

    const KEY: &'static str = D::KEY;
    const SUBJECT: &'static str = D::SUBJECT;
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

    const INPUT_SCHEMA_JSON: &'static str;
    const EVENT_SCHEMA_JSON: &'static str;
}

impl<D> FeedDescriptor for D
where
    D: crate::client::FeedDescriptor,
    D::Input: DeserializeOwned + Send + 'static,
    D::Event: Serialize + Send + 'static,
{
    type Input = D::Input;
    type Event = D::Event;

    const KEY: &'static str = D::KEY;
    const SUBJECT: &'static str = D::SUBJECT;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = D::SUBSCRIBE_CAPABILITIES;
    const INPUT_SCHEMA_JSON: &'static str = D::INPUT_SCHEMA_JSON;
    const EVENT_SCHEMA_JSON: &'static str = D::EVENT_SCHEMA_JSON;
}
