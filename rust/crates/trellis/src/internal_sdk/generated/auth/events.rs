//! Typed event descriptors for `trellis.auth@v1`.
use crate::generated::EventDescriptor;
/// Descriptor for `Auth.Connections.Closed`.
pub struct AuthConnectionsClosedEventDescriptor;
impl EventDescriptor for AuthConnectionsClosedEventDescriptor {
    type Event = super::types::AuthConnectionsClosedEvent;
    const KEY: &'static str = "Auth.Connections.Closed";
    const SUBJECT: &'static str = "events.v1.Auth.Connections.Closed";
    const SUBSCRIBE_SUBJECT: &'static str = "events.v1.Auth.Connections.Closed";
    const EVENT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CONNECTIONS_CLOSED_EVENT_SCHEMA_JSON;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const DELEGATED_PUBLISH: bool = false;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.stream"];
}
/// Descriptor for `Auth.Connections.Kicked`.
pub struct AuthConnectionsKickedEventDescriptor;
impl EventDescriptor for AuthConnectionsKickedEventDescriptor {
    type Event = super::types::AuthConnectionsKickedEvent;
    const KEY: &'static str = "Auth.Connections.Kicked";
    const SUBJECT: &'static str = "events.v1.Auth.Connections.Kicked";
    const SUBSCRIBE_SUBJECT: &'static str = "events.v1.Auth.Connections.Kicked";
    const EVENT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CONNECTIONS_KICKED_EVENT_SCHEMA_JSON;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const DELEGATED_PUBLISH: bool = false;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.stream"];
}
/// Descriptor for `Auth.Connections.Opened`.
pub struct AuthConnectionsOpenedEventDescriptor;
impl EventDescriptor for AuthConnectionsOpenedEventDescriptor {
    type Event = super::types::AuthConnectionsOpenedEvent;
    const KEY: &'static str = "Auth.Connections.Opened";
    const SUBJECT: &'static str = "events.v1.Auth.Connections.Opened";
    const SUBSCRIBE_SUBJECT: &'static str = "events.v1.Auth.Connections.Opened";
    const EVENT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CONNECTIONS_OPENED_EVENT_SCHEMA_JSON;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const DELEGATED_PUBLISH: bool = false;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.stream"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Approved`.
pub struct AuthDeviceUserAuthoritiesApprovedEventDescriptor;
impl EventDescriptor for AuthDeviceUserAuthoritiesApprovedEventDescriptor {
    type Event = super::types::AuthDeviceUserAuthoritiesApprovedEvent;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Approved";
    const SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Approved";
    const SUBSCRIBE_SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Approved.*";
    const EVENT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_APPROVED_EVENT_SCHEMA_JSON;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const DELEGATED_PUBLISH: bool = false;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.stream"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Requested`.
pub struct AuthDeviceUserAuthoritiesRequestedEventDescriptor;
impl EventDescriptor for AuthDeviceUserAuthoritiesRequestedEventDescriptor {
    type Event = super::types::AuthDeviceUserAuthoritiesRequestedEvent;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Requested";
    const SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Requested";
    const SUBSCRIBE_SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Requested.*";
    const EVENT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_REQUESTED_EVENT_SCHEMA_JSON;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const DELEGATED_PUBLISH: bool = false;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.stream"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Resolved`.
pub struct AuthDeviceUserAuthoritiesResolvedEventDescriptor;
impl EventDescriptor for AuthDeviceUserAuthoritiesResolvedEventDescriptor {
    type Event = super::types::AuthDeviceUserAuthoritiesResolvedEvent;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Resolved";
    const SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Resolved";
    const SUBSCRIBE_SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.Resolved.*";
    const EVENT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_RESOLVED_EVENT_SCHEMA_JSON;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const DELEGATED_PUBLISH: bool = false;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.stream"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.ReviewRequested`.
pub struct AuthDeviceUserAuthoritiesReviewRequestedEventDescriptor;
impl EventDescriptor for AuthDeviceUserAuthoritiesReviewRequestedEventDescriptor {
    type Event = super::types::AuthDeviceUserAuthoritiesReviewRequestedEvent;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.ReviewRequested";
    const SUBJECT: &'static str = "events.v1.Auth.DeviceUserAuthorities.ReviewRequested";
    const SUBSCRIBE_SUBJECT: &'static str =
        "events.v1.Auth.DeviceUserAuthorities.ReviewRequested.*";
    const EVENT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_REVIEW_REQUESTED_EVENT_SCHEMA_JSON;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const DELEGATED_PUBLISH: bool = false;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.stream"];
}
/// Descriptor for `Auth.Sessions.Revoked`.
pub struct AuthSessionsRevokedEventDescriptor;
impl EventDescriptor for AuthSessionsRevokedEventDescriptor {
    type Event = super::types::AuthSessionsRevokedEvent;
    const KEY: &'static str = "Auth.Sessions.Revoked";
    const SUBJECT: &'static str = "events.v1.Auth.Sessions.Revoked";
    const SUBSCRIBE_SUBJECT: &'static str = "events.v1.Auth.Sessions.Revoked";
    const EVENT_SCHEMA_JSON: &'static str = super::schemas::AUTH_SESSIONS_REVOKED_EVENT_SCHEMA_JSON;
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const DELEGATED_PUBLISH: bool = false;
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["trellis.auth::events.stream"];
}
