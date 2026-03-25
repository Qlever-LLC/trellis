//! Typed event descriptors for `trellis.activity@v1`.

use trellis_client::EventDescriptor;
use trellis_server::EventDescriptor as ServerEventDescriptor;

/// Descriptor for `Activity.Recorded`.
pub struct ActivityRecordedEventDescriptor;

impl EventDescriptor for ActivityRecordedEventDescriptor {
    type Event = crate::types::ActivityRecordedEvent;
    const KEY: &'static str = "Activity.Recorded";
    const SUBJECT: &'static str = "events.v1.Activity.Recorded";
}

impl ServerEventDescriptor for ActivityRecordedEventDescriptor {
    type Event = crate::types::ActivityRecordedEvent;
    const KEY: &'static str = "Activity.Recorded";
    const SUBJECT: &'static str = "events.v1.Activity.Recorded";
}

