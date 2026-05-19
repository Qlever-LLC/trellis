use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use bytes::Bytes;
use futures_util::future::BoxFuture;
use sha2::{Digest, Sha256};

use trellis_auth::{
    AuthClient, AuthRequestsValidateRequest, AuthRequestsValidateResponse, TrellisAuthError,
};
use trellis_client::{RpcErrorPayload, TrellisClient, TrellisClientError};
use trellis_service::{RequestContext, RequestValidation, RequestValidator, ServerError};

const AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS: usize = 3;
const AUTH_VALIDATE_SESSION_RETRY_MS: u64 = 25;

pub trait AuthRequestValidatorClientPort: Send + Sync {
    fn auth_validate_request<'a>(
        &'a self,
        input: &'a AuthRequestsValidateRequest,
    ) -> BoxFuture<'a, Result<AuthRequestsValidateResponse, TrellisClientError>>;
}

impl<'a> AuthRequestValidatorClientPort for AuthClient<'a> {
    fn auth_validate_request<'b>(
        &'b self,
        input: &'b AuthRequestsValidateRequest,
    ) -> BoxFuture<'b, Result<AuthRequestsValidateResponse, TrellisClientError>> {
        Box::pin(async move { self.validate_request(input).await.map_err(map_auth_error) })
    }
}

impl AuthRequestValidatorClientPort for Arc<TrellisClient> {
    fn auth_validate_request<'a>(
        &'a self,
        input: &'a AuthRequestsValidateRequest,
    ) -> BoxFuture<'a, Result<AuthRequestsValidateResponse, TrellisClientError>> {
        Box::pin(async move {
            AuthClient::new(self.as_ref())
                .validate_request(input)
                .await
                .map_err(map_auth_error)
        })
    }
}

fn map_auth_error(error: TrellisAuthError) -> TrellisClientError {
    match error {
        TrellisAuthError::TrellisClient(error) => error,
        other => TrellisClientError::RpcError(RpcErrorPayload::from_message(other.to_string())),
    }
}

#[derive(Clone)]
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
    ) -> BoxFuture<'a, Result<RequestValidation, ServerError>> {
        Box::pin(async move {
            let request = make_validate_request(subject, payload, context)?;
            let response = validate_request_with_session_retry(&self.client, &request)
                .await
                .map_err(|error| map_validate_request_error(subject, error))?;
            if response.allowed {
                Ok(RequestValidation::allowed_caller(response.caller))
            } else {
                Ok(RequestValidation::denied())
            }
        })
    }
}

async fn validate_request_with_session_retry<C>(
    client: &C,
    request: &AuthRequestsValidateRequest,
) -> Result<AuthRequestsValidateResponse, TrellisClientError>
where
    C: AuthRequestValidatorClientPort,
{
    for attempt in 0..AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS {
        match client.auth_validate_request(request).await {
            Ok(response) => return Ok(response),
            Err(error)
                if is_transient_session_not_found(&error)
                    && attempt + 1 < AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS =>
            {
                tokio::time::sleep(Duration::from_millis(
                    AUTH_VALIDATE_SESSION_RETRY_MS * (attempt as u64 + 1),
                ))
                .await;
            }
            Err(error) => return Err(error),
        }
    }

    unreachable!("retry loop always returns on the final attempt")
}

fn is_transient_session_not_found(error: &TrellisClientError) -> bool {
    let TrellisClientError::RpcError(payload) = error else {
        return false;
    };

    payload.error_type() == Some("AuthError")
        && payload
            .value()
            .and_then(|value| value.get("reason"))
            .and_then(serde_json::Value::as_str)
            == Some("session_not_found")
}

pub fn payload_hash_base64url(payload: &[u8]) -> String {
    let digest = Sha256::digest(payload);
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn make_validate_request(
    subject: &str,
    payload: &[u8],
    context: &RequestContext,
) -> Result<AuthRequestsValidateRequest, ServerError> {
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

    Ok(AuthRequestsValidateRequest {
        capabilities: context.required_capabilities.clone(),
        iat: context.iat.unwrap_or_default(),
        payload_hash: payload_hash_base64url(payload),
        proof,
        request_id: context.request_id.clone().unwrap_or_default(),
        session_key,
        subject: subject.to_string(),
    })
}

pub fn map_validate_request_error(subject: &str, error: TrellisClientError) -> ServerError {
    ServerError::Nats(format!(
        "Auth.Requests.Validate failed for {subject}: {error}"
    ))
}
