//! Typed event descriptors for `trellis.auth@v1`.

use trellis_client::EventDescriptor;
use trellis_server::EventDescriptor as ServerEventDescriptor;

/// Descriptor for `Auth.Connect`.
pub struct AuthConnectEventDescriptor;

impl EventDescriptor for AuthConnectEventDescriptor {
    type Event = crate::types::AuthConnectEvent;
    const KEY: &'static str = "Auth.Connect";
    const SUBJECT: &'static str = "events.v1.Auth.Connect";
}

impl ServerEventDescriptor for AuthConnectEventDescriptor {
    type Event = crate::types::AuthConnectEvent;
    const KEY: &'static str = "Auth.Connect";
    const SUBJECT: &'static str = "events.v1.Auth.Connect";
}

/// Descriptor for `Auth.ConnectionKicked`.
pub struct AuthConnectionKickedEventDescriptor;

impl EventDescriptor for AuthConnectionKickedEventDescriptor {
    type Event = crate::types::AuthConnectionKickedEvent;
    const KEY: &'static str = "Auth.ConnectionKicked";
    const SUBJECT: &'static str = "events.v1.Auth.ConnectionKicked";
}

impl ServerEventDescriptor for AuthConnectionKickedEventDescriptor {
    type Event = crate::types::AuthConnectionKickedEvent;
    const KEY: &'static str = "Auth.ConnectionKicked";
    const SUBJECT: &'static str = "events.v1.Auth.ConnectionKicked";
}

/// Descriptor for `Auth.Disconnect`.
pub struct AuthDisconnectEventDescriptor;

impl EventDescriptor for AuthDisconnectEventDescriptor {
    type Event = crate::types::AuthDisconnectEvent;
    const KEY: &'static str = "Auth.Disconnect";
    const SUBJECT: &'static str = "events.v1.Auth.Disconnect";
}

impl ServerEventDescriptor for AuthDisconnectEventDescriptor {
    type Event = crate::types::AuthDisconnectEvent;
    const KEY: &'static str = "Auth.Disconnect";
    const SUBJECT: &'static str = "events.v1.Auth.Disconnect";
}

/// Descriptor for `Auth.SessionRevoked`.
pub struct AuthSessionRevokedEventDescriptor;

impl EventDescriptor for AuthSessionRevokedEventDescriptor {
    type Event = crate::types::AuthSessionRevokedEvent;
    const KEY: &'static str = "Auth.SessionRevoked";
    const SUBJECT: &'static str = "events.v1.Auth.SessionRevoked";
}

impl ServerEventDescriptor for AuthSessionRevokedEventDescriptor {
    type Event = crate::types::AuthSessionRevokedEvent;
    const KEY: &'static str = "Auth.SessionRevoked";
    const SUBJECT: &'static str = "events.v1.Auth.SessionRevoked";
}

