use bytes::Bytes;
use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::{HandlerResponse, RequestContext, Router, ServerError};

/// Result returned by request validators after checking caller authorization.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RequestValidation {
    pub allowed: bool,
    pub caller: Option<Value>,
}

impl RequestValidation {
    /// Construct an allowed validation result with no caller metadata.
    pub fn allowed() -> Self {
        Self {
            allowed: true,
            caller: None,
        }
    }

    /// Construct an allowed validation result with caller metadata.
    pub fn allowed_caller(caller: Value) -> Self {
        Self {
            allowed: true,
            caller: Some(caller),
        }
    }

    /// Construct a denied validation result.
    pub fn denied() -> Self {
        Self {
            allowed: false,
            caller: None,
        }
    }
}

/// Auth validator called before dispatching requests to mounted handlers.
pub trait RequestValidator: Send + Sync {
    fn validate<'a>(
        &'a self,
        subject: &'a str,
        payload: &'a Bytes,
        context: &'a RequestContext,
    ) -> BoxFuture<'a, Result<RequestValidation, ServerError>>;
}

/// A router wrapper that enforces auth validation before handler execution.
pub struct AuthenticatedRouter<V>
where
    V: RequestValidator,
{
    router: Router,
    validator: V,
}

impl<V> AuthenticatedRouter<V>
where
    V: RequestValidator,
{
    pub fn new(router: Router, validator: V) -> Self {
        Self { router, validator }
    }

    pub fn inner(&self) -> &Router {
        &self.router
    }

    pub async fn handle_request(
        &self,
        subject: &str,
        payload: Bytes,
        context: RequestContext,
    ) -> Result<Bytes, ServerError> {
        let session_key =
            context
                .session_key
                .clone()
                .ok_or_else(|| ServerError::MissingSessionKey {
                    subject: subject.to_string(),
                })?;

        if context
            .proof
            .as_deref()
            .map(|proof| proof.is_empty())
            .unwrap_or(true)
        {
            return Err(ServerError::MissingProof {
                subject: subject.to_string(),
            });
        }

        let validation = self.validator.validate(subject, &payload, &context).await?;
        if !validation.allowed {
            return Err(ServerError::RequestDenied {
                subject: subject.to_string(),
                session_key,
            });
        }

        validate_reply_inbox(subject, &session_key, context.reply_to.as_deref())?;

        let context = RequestContext {
            caller: validation.caller,
            ..context
        };
        self.router.handle_request(subject, payload, context).await
    }

    pub async fn handle_request_frames(
        &self,
        subject: &str,
        payload: Bytes,
        context: RequestContext,
    ) -> Result<Vec<Bytes>, ServerError> {
        let session_key =
            context
                .session_key
                .clone()
                .ok_or_else(|| ServerError::MissingSessionKey {
                    subject: subject.to_string(),
                })?;

        if context
            .proof
            .as_deref()
            .map(|proof| proof.is_empty())
            .unwrap_or(true)
        {
            return Err(ServerError::MissingProof {
                subject: subject.to_string(),
            });
        }

        let validation = self.validator.validate(subject, &payload, &context).await?;
        if !validation.allowed {
            return Err(ServerError::RequestDenied {
                subject: subject.to_string(),
                session_key,
            });
        }

        validate_reply_inbox(subject, &session_key, context.reply_to.as_deref())?;

        let context = RequestContext {
            caller: validation.caller,
            ..context
        };
        self.router
            .handle_request_frames(subject, payload, context)
            .await
    }

    pub async fn handle_request_response(
        &self,
        subject: &str,
        payload: Bytes,
        context: RequestContext,
    ) -> Result<HandlerResponse, ServerError> {
        let session_key =
            context
                .session_key
                .clone()
                .ok_or_else(|| ServerError::MissingSessionKey {
                    subject: subject.to_string(),
                })?;

        if context
            .proof
            .as_deref()
            .map(|proof| proof.is_empty())
            .unwrap_or(true)
        {
            return Err(ServerError::MissingProof {
                subject: subject.to_string(),
            });
        }

        let validation = self.validator.validate(subject, &payload, &context).await?;
        if !validation.allowed {
            return Err(ServerError::RequestDenied {
                subject: subject.to_string(),
                session_key,
            });
        }

        validate_reply_inbox(subject, &session_key, context.reply_to.as_deref())?;

        let context = RequestContext {
            caller: validation.caller,
            ..context
        };
        self.router
            .handle_request_response(subject, payload, context)
            .await
    }
}

fn validate_reply_inbox(
    subject: &str,
    session_key: &str,
    reply_to: Option<&str>,
) -> Result<(), ServerError> {
    let Some(reply_to) = reply_to else {
        return Ok(());
    };
    let prefix = format!("_INBOX.{}", &session_key[..16.min(session_key.len())]);
    if reply_to == prefix || reply_to.starts_with(&format!("{prefix}.")) {
        return Ok(());
    }

    Err(ServerError::ReplyInboxMismatch {
        subject: subject.to_string(),
        session_key: session_key.to_string(),
        reply_to: reply_to.to_string(),
    })
}
