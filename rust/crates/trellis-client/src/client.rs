use async_nats::header::HeaderMap;
use async_nats::ConnectOptions;
use bytes::Bytes;
use nkeys::KeyPair;
use serde_json::Value;
use tokio::time::timeout;

use crate::proof::now_iat_seconds;
use crate::{EventDescriptor, RpcDescriptor, SessionAuth, TrellisClientError};

/// Connection options for a Trellis service/session-key principal.
pub struct ServiceConnectOptions<'a> {
    pub servers: &'a str,
    pub sentinel_creds_path: &'a str,
    pub session_key_seed_base64url: &'a str,
    pub timeout_ms: u64,
}

/// Connection options for a user/binding-token principal.
pub struct UserConnectOptions<'a> {
    pub servers: &'a str,
    pub sentinel_jwt: &'a str,
    pub sentinel_seed: &'a str,
    pub session_key_seed_base64url: &'a str,
    pub binding_token: &'a str,
    pub timeout_ms: u64,
}

/// A low-level Trellis client over NATS request/reply and publish primitives.
pub struct TrellisClient {
    nats: async_nats::Client,
    auth: SessionAuth,
    timeout_ms: u64,
}

impl TrellisClient {
    /// Expose the underlying NATS client for advanced use.
    pub fn nats(&self) -> &async_nats::Client {
        &self.nats
    }

    /// Return the session auth helper used by this client.
    pub fn auth(&self) -> &SessionAuth {
        &self.auth
    }

    /// Connect using sentinel credentials plus an `iat`-based service token.
    pub async fn connect_service(
        opts: ServiceConnectOptions<'_>,
    ) -> Result<Self, TrellisClientError> {
        let auth = SessionAuth::from_seed_base64url(opts.session_key_seed_base64url)?;
        let token = auth.nats_connect_token(now_iat_seconds());
        let inbox_prefix = auth.inbox_prefix();

        let nats = ConnectOptions::new()
            .credentials(opts.sentinel_creds_path)?
            .token(token)
            .custom_inbox_prefix(inbox_prefix)
            .connect(opts.servers)
            .await
            .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?;

        Ok(Self {
            nats,
            auth,
            timeout_ms: opts.timeout_ms,
        })
    }

    /// Connect using a previously issued binding token.
    pub async fn connect_user(opts: UserConnectOptions<'_>) -> Result<Self, TrellisClientError> {
        let auth = SessionAuth::from_seed_base64url(opts.session_key_seed_base64url)?;
        let token = auth.nats_connect_binding_token(opts.binding_token);
        let inbox_prefix = auth.inbox_prefix();
        let key_pair = std::sync::Arc::new(
            KeyPair::from_seed(opts.sentinel_seed)
                .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?,
        );

        let nats = ConnectOptions::with_jwt(opts.sentinel_jwt.to_string(), move |nonce| {
            let key_pair = key_pair.clone();
            async move { key_pair.sign(&nonce).map_err(async_nats::AuthError::new) }
        })
        .token(token)
        .custom_inbox_prefix(inbox_prefix)
        .connect(opts.servers)
        .await
        .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?;

        Ok(Self {
            nats,
            auth,
            timeout_ms: opts.timeout_ms,
        })
    }

    async fn request(
        &self,
        subject: &str,
        payload: Bytes,
    ) -> Result<async_nats::Message, TrellisClientError> {
        let proof = self.auth.create_proof(subject, &payload);

        let mut headers = HeaderMap::new();
        headers.insert("session-key", self.auth.session_key.as_str());
        headers.insert("proof", proof.as_str());

        let future = self
            .nats
            .request_with_headers(subject.to_string(), headers, payload);
        let message = timeout(std::time::Duration::from_millis(self.timeout_ms), future)
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        Ok(message)
    }

    async fn request_json(&self, subject: &str, body: Value) -> Result<Value, TrellisClientError> {
        let payload = Bytes::from(serde_json::to_vec(&body)?);
        let message = self.request(subject, payload).await?;

        if let Some(headers) = &message.headers {
            if let Some(status) = headers.get("status") {
                if status.as_str() == "error" {
                    let value: Value = serde_json::from_slice(&message.payload)?;
                    return Err(TrellisClientError::RpcError(value.to_string()));
                }
            }
        }

        Ok(serde_json::from_slice(&message.payload)?)
    }

    /// Call a raw subject with a JSON value payload.
    pub async fn request_json_value(
        &self,
        subject: &str,
        body: &Value,
    ) -> Result<Value, TrellisClientError> {
        self.request_json(subject, body.clone()).await
    }

    /// Call one descriptor-backed RPC.
    pub async fn call<D>(&self, input: &D::Input) -> Result<D::Output, TrellisClientError>
    where
        D: RpcDescriptor,
    {
        let value = serde_json::to_value(input)?;
        let response = self.request_json(D::SUBJECT, value).await?;
        Ok(serde_json::from_value(response)?)
    }

    /// Publish one descriptor-backed event.
    pub async fn publish<D>(&self, event: &D::Event) -> Result<(), TrellisClientError>
    where
        D: EventDescriptor,
    {
        let payload = Bytes::from(serde_json::to_vec(event)?);
        self.nats
            .publish(D::SUBJECT.to_string(), payload)
            .await
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        Ok(())
    }
}
