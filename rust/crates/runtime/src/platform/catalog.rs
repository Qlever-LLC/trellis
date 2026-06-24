//! Platform contract catalog scaffold.

/// Runtime state for the built-in Trellis contract catalog.
///
/// The catalog tracks Trellis-owned contract metadata used by platform control
/// surfaces and by runtime materialization decisions.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct BuiltinCatalog;
