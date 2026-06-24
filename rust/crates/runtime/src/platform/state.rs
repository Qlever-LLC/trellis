//! Platform state scaffold.

/// Runtime state for Trellis-owned platform records.
///
/// Platform state is the authoritative store for Trellis-local auth, catalog,
/// deployment authority, materialization, and control-plane records.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PlatformState;
