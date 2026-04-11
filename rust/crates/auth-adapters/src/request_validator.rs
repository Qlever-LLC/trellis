use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use bytes::Bytes;
use futures_util::future::BoxFuture;
use sha2::{Digest, Sha256};

use trellis_auth::{
    AuthClient, AuthValidateRequestRequest, AuthValidateRequestResponse, TrellisAuthError,
};
use trellis_client::TrellisClientError;
use trellis_server::{RequestContext, RequestValidator, ServerError};

pub trait AuthRequestValidatorClientPort: Send + Sync {
    fn auth_validate_request<'a>(
        &'a self,
        input: &'a AuthValidateRequestRequest,
    ) -> BoxFuture<'a, Result<AuthValidateRequestResponse, TrellisClientError>>;
}

impl<'a> AuthRequestValidatorClientPort for AuthClient<'a> {
    fn auth_validate_request<'b>(
        &'b self,
        input: &'b AuthValidateRequestRequest,
    ) -> BoxFuture<'b, Result<AuthValidateRequestResponse, TrellisClientError>> {
        Box::pin(async move { self.validate_request(input).await.map_err(map_auth_error) })
    }
}

fn map_auth_error(error: TrellisAuthError) -> TrellisClientError {
    match error {
        TrellisAuthError::TrellisClient(error) => error,
        other => TrellisClientError::RpcError(other.to_string()),
    }
}

pub struct AuthRequestValidatorAdapter<C> {
    client: C,
}

impl<C> AuthRequestValidatorAdapter<C> {
    pub fn new(client: C) -> Self {
        Self { client }
    }
}

impl<C> RequestValidator for AuthRequestValidatorAdapter<C>
where
    C: AuthRequestValidatorClientPort,
{
    fn validate<'a>(
        &'a self,
        subject: &'a str,
        payload: &'a Bytes,
        context: &'a RequestContext,
    ) -> BoxFuture<'a, Result<bool, ServerError>> {
        Box::pin(async move {
            let request = make_validate_request(subject, payload, context)?;
            let response = self
                .client
                .auth_validate_request(&request)
                .await
                .map_err(|error| map_validate_request_error(subject, error))?;
            Ok(response.allowed)
        })
    }
}

pub fn payload_hash_base64url(payload: &[u8]) -> String {
    let digest = Sha256::digest(payload);
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn make_validate_request(
    subject: &str,
    payload: &[u8],
    context: &RequestContext,
) -> Result<AuthValidateRequestRequest, ServerError> {
    let session_key =
        context
            .session_key
            .clone()
            .ok_or_else(|| ServerError::MissingSessionKey {
                subject: subject.to_string(),
            })?;

    let proof = context
        .proof
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::MissingProof {
            subject: subject.to_string(),
        })?;

    Ok(AuthValidateRequestRequest {
        capabilities: None,
        payload_hash: payload_hash_base64url(payload),
        proof,
        session_key,
        subject: subject.to_string(),
    })
}

pub fn map_validate_request_error(subject: &str, error: TrellisClientError) -> ServerError {
    ServerError::Nats(format!(
        "Auth.ValidateRequest failed for {subject}: {error}"
    ))
}
