//! Auth-callout scaffold.

/// Runtime state for the Trellis NATS auth-callout implementation.
///
/// The platform subsystem owns auth-callout behavior for runtime connection
/// identities, including validating materialized authority before minting
/// scoped NATS user credentials.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AuthCallout;
