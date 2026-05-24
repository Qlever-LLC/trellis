//! Typed event descriptors for `trellis.auth@v1`.
use crate::client::EventDescriptor;
/// Descriptor for `Auth.Connections.Closed`.
pub struct AuthConnectionsClosedEventDescriptor;
impl EventDescriptor for AuthConnectionsClosedEventDescriptor {
    type Event = super::types::AuthConnectionsClosedEvent;
    const KEY: &'static str = "Auth.Connections.Closed";
    const SUBJECT: &'static str = "events.v1.Auth.Connections.Closed";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
}
/// Descriptor for `Auth.Connections.Kicked`.
pub struct AuthConnectionsKickedEventDescriptor;
impl EventDescriptor for AuthConnectionsKickedEventDescriptor {
    type Event = super::types::AuthConnectionsKickedEvent;
    const KEY: &'static str = "Auth.Connections.Kicked";
    const SUBJECT: &'static str = "events.v1.Auth.Connections.Kicked";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
}
/// Descriptor for `Auth.Connections.Opened`.
pub struct AuthConnectionsOpenedEventDescriptor;
impl EventDescriptor for AuthConnectionsOpenedEventDescriptor {
    type Event = super::types::AuthConnectionsOpenedEvent;
    const KEY: &'static str = "Auth.Connections.Opened";
    const SUBJECT: &'static str = "events.v1.Auth.Connections.Opened";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Approved`.
pub struct AuthDeviceUserAuthoritiesApprovedEventDescriptor;
impl EventDescriptor for AuthDeviceUserAuthoritiesApprovedEventDescriptor {
    type Event = super::types::AuthDeviceUserAuthoritiesApprovedEvent;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Approved";
    const SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Approved.{/deploymentId}";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::device.review"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Requested`.
pub struct AuthDeviceUserAuthoritiesRequestedEventDescriptor;
impl EventDescriptor for AuthDeviceUserAuthoritiesRequestedEventDescriptor {
    type Event = super::types::AuthDeviceUserAuthoritiesRequestedEvent;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Requested";
    const SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Requested.{/deploymentId}";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::device.review"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Resolved`.
pub struct AuthDeviceUserAuthoritiesResolvedEventDescriptor;
impl EventDescriptor for AuthDeviceUserAuthoritiesResolvedEventDescriptor {
    type Event = super::types::AuthDeviceUserAuthoritiesResolvedEvent;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Resolved";
    const SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Resolved.{/deploymentId}";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] =
        &["trellis.auth::device.review", "trellis.auth::events.auth"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.ReviewRequested`.
pub struct AuthDeviceUserAuthoritiesReviewRequestedEventDescriptor;
impl EventDescriptor for AuthDeviceUserAuthoritiesReviewRequestedEventDescriptor {
    type Event = super::types::AuthDeviceUserAuthoritiesReviewRequestedEvent;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.ReviewRequested";
    const SUBJECT: &'static str =
        "events.v1.Auth.DeviceUserAuthorities.ReviewRequested.{/deploymentId}";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::device.review"];
}
/// Descriptor for `Auth.Sessions.Revoked`.
pub struct AuthSessionsRevokedEventDescriptor;
impl EventDescriptor for AuthSessionsRevokedEventDescriptor {
    type Event = super::types::AuthSessionsRevokedEvent;
    const KEY: &'static str = "Auth.Sessions.Revoked";
    const SUBJECT: &'static str = "events.v1.Auth.Sessions.Revoked";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.auth"];
}
