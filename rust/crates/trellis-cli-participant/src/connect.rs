//! CLI-specific connection helpers for the local participant facade.

use trellis_auth::{
    connect_admin_client_async, persist_renewed_admin_session, AdminSessionState, TrellisAuthError,
};
use trellis_client::{ServiceConnectOptions, TrellisClient, TrellisClientError, UserConnectOptions};

use crate::Client;

/// A connected CLI participant session that owns the underlying runtime client.
pub struct ConnectedClient {
    inner: TrellisClient,
}

impl ConnectedClient {
    /// Wrap an existing low-level Trellis client.
    pub fn new(inner: TrellisClient) -> Self {
        Self { inner }
    }

    /// Return the local participant facade.
    pub fn facade(&self) -> Client<'_> {
        Client::new(&self.inner)
    }

    /// Expose the underlying low-level Trellis client.
    pub fn raw(&self) -> &TrellisClient {
        &self.inner
    }

    /// Renew the admin binding token and persist it back into session state.
    pub async fn renew_admin_session(
        &self,
        state: &mut AdminSessionState,
    ) -> Result<(), TrellisAuthError> {
        let renewed = self.facade().auth().auth_renew_binding_token().await?;
        persist_renewed_admin_session(state, renewed)
    }
}

/// Connect the CLI participant using stored admin session credentials.
pub async fn connect_admin(
    state: &AdminSessionState,
) -> Result<ConnectedClient, TrellisAuthError> {
    Ok(ConnectedClient::new(connect_admin_client_async(state).await?))
}

/// Connect the CLI participant as a service principal.
pub async fn connect_service(
    opts: ServiceConnectOptions<'_>,
) -> Result<ConnectedClient, TrellisClientError> {
    Ok(ConnectedClient::new(TrellisClient::connect_service(opts).await?))
}

/// Connect the CLI participant as a user principal.
pub async fn connect_user(
    opts: UserConnectOptions<'_>,
) -> Result<ConnectedClient, TrellisClientError> {
    Ok(ConnectedClient::new(TrellisClient::connect_user(opts).await?))
}
