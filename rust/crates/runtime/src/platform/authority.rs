//! Deployment authority scaffold.

/// Runtime state for deployment-owned desired authority.
///
/// Deployment authority records the accepted access, contract, and resource
/// intent that reconciliation materializes into runtime bindings and grants.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DeploymentAuthority;
