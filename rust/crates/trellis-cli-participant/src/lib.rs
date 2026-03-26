//! Local participant facade for `trellis.cli@v1`.

pub mod connect;
pub mod contract;
mod manifest_json;
pub mod owned {
    include!(concat!(env!("OUT_DIR"), "/generated/src/owned.rs"));
}

pub mod uses {
    pub mod auth {
        include!(concat!(env!("OUT_DIR"), "/generated/src/uses/auth.rs"));

        pub use trellis_sdk_auth::{
            AuthInstallServiceRequest, AuthListApprovalsRequest, AuthRevokeApprovalRequest,
            AuthUpgradeServiceContractRequest,
        };
    }

    pub mod core {
        include!(concat!(env!("OUT_DIR"), "/generated/src/uses/core.rs"));

        pub use trellis_sdk_core::TrellisContractGetRequest;
    }
}

pub use connect::{connect_admin, connect_service, connect_user, ConnectedClient};

/// Contract-shaped outbound facade for the CLI participant.
pub struct Client<'a> {
    inner: &'a trellis_client::TrellisClient,
}

/// Service-side facade for owned handlers plus outbound alias access.
pub struct Service<'a> {
    inner: &'a trellis_client::TrellisClient,
}

impl<'a> Client<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {
        Self { inner }
    }

    /// Access the participant's owned contract surface.
    pub fn owned(&self) -> owned::Client<'a> {
        owned::Client::new(self.inner)
    }

    /// Access the `auth` dependency alias facade.
    pub fn auth(&self) -> uses::auth::Client<'a> {
        uses::auth::Client::new(self.inner)
    }

    /// Access the `core` dependency alias facade.
    pub fn core(&self) -> uses::core::Client<'a> {
        uses::core::Client::new(self.inner)
    }
}

impl<'a> Service<'a> {
    /// Wrap an already connected low-level Trellis client for outbound service calls.
    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {
        Self { inner }
    }

    /// Access owned handler and publish helpers.
    pub fn owned(&self) -> owned::Service<'a> {
        owned::Service::new(self.inner)
    }

    /// Access the `auth` dependency alias facade for outbound calls.
    pub fn auth(&self) -> uses::auth::Client<'a> {
        uses::auth::Client::new(self.inner)
    }

    /// Access the `core` dependency alias facade for outbound calls.
    pub fn core(&self) -> uses::core::Client<'a> {
        uses::core::Client::new(self.inner)
    }
}
