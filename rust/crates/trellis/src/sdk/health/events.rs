//! Typed event descriptors for `trellis.health@v1`.
use crate::client::EventDescriptor;
/// Descriptor for `Health.Heartbeat`.
pub struct HealthHeartbeatEventDescriptor;
impl EventDescriptor for HealthHeartbeatEventDescriptor {
    type Event = super::types::HealthHeartbeatEvent;
    const KEY: &'static str = "Health.Heartbeat";
    const SUBJECT: &'static str = "events.v1.Health.Heartbeat";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
}
