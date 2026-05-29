pub use trellis_rs::service::DefaultRequestValidator as AuthRequestValidatorAdapter;
pub use trellis_rs::service::DefaultRequestValidatorClientPort as AuthRequestValidatorClientPort;

/// Compatibility exports for the unpublished auth-adapters crate.
pub mod request_validator {
    use trellis_rs::sdk::auth::types::AuthRequestsValidateRequest;
    use trellis_rs::service::{RequestContext, ServerError};

    pub use trellis_rs::service::payload_hash_base64url;
    pub use trellis_rs::service::DefaultRequestValidator as AuthRequestValidatorAdapter;
    pub use trellis_rs::service::DefaultRequestValidatorClientPort as AuthRequestValidatorClientPort;

    /// Builds the auth request-validation payload from an inbound request context.
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
}
