//! High-level Trellis service runtime facade for generated Rust services.

use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::task::{Context, Poll};
use std::time::Duration;

use async_nats::header::HeaderMap;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use bytes::Bytes;
use futures_util::future::BoxFuture;
use futures_util::{Stream, StreamExt};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use tokio::task::{AbortHandle, JoinError, JoinHandle};

pub use super::core_bootstrap::CoreBootstrapBinding;
use super::request_loop::RequestHandler;
use super::resources::{validate_kv_binding, validate_store_binding, ResourceRuntimeClient};
use super::resources::{KvHandle, KvResourceHandle, StoreHandle, StoreResourceHandle};
use super::runtime::run_multi_subject_service;
use super::transfer::{
    spawn_download_transfer_endpoint, spawn_upload_transfer_endpoint_with_completion,
    spawn_upload_transfer_endpoint_with_progress,
};
use super::{
    bootstrap_service_host, control_subject, AcceptedOperation, BootstrapBindingInfo,
    DownloadTransferGrantPlan, EventPublisher, FeedDescriptor, HandlerResult, JobsResourceBinding,
    KvResourceBinding, OperationDescriptor, OperationLiveEvent, OperationProvider,
    OperationSignalAccepted, OperationSnapshot, OperationTransferProgress, RequestContext,
    RequestValidation, RequestValidator, Router, RpcDescriptor, ServerError,
    ServiceResourceBindings, StoreResourceBinding, StoreResourceClient, UploadTransferCompletion,
    UploadTransferGrantPlan, UploadTransferSession,
};
use crate::client::{
    verify_event_proof, EventMessage, EventReplayPolicy, EventSubscribeOptions,
    EventSubscriptionMode, ServiceConnectWithContractOptions, TrellisClient, TrellisClientError,
};
use crate::jobs::{
    start_worker_host_from_client, JobDescriptor, JobIdentity, JobManager, JobProcessError, JobRef,
    JobSnapshot, JobsError, TrellisJobEventPublisher, TrellisJobMetaSource, WorkerHostHandle,
    WorkerHostOptions,
};
use crate::sdk::auth::rpc::{AuthEventsValidateRpc, AuthRequestsValidateRpc};
use crate::sdk::auth::types::{
    AuthEventsValidateRequest, AuthEventsValidateResponse, AuthEventsValidateResponsePublisher,
    AuthRequestsValidateRequest, AuthRequestsValidateResponse,
};
use crate::sdk::core::types::TrellisBindingsGetResponseBinding;

const AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS: usize = 3;
const AUTH_VALIDATE_SESSION_RETRY_MS: u64 = 25;
const DURABLE_EVENT_CONSUMER_RETRY_MS: u64 = 100;
static SERVICE_EVENT_HANDLER_ID: AtomicU64 = AtomicU64::new(1);

type SharedDurableEventListeners =
    Arc<Mutex<BTreeMap<DurableEventListenerKey, SharedDurableEventListener>>>;
type SharedEventHandler = Arc<
    dyn Fn(
            Bytes,
            ServiceEventListenerContext,
        ) -> BoxFuture<'static, Result<(), ServiceRuntimeError>>
        + Send
        + Sync,
>;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
struct DurableEventListenerKey {
    stream: String,
    durable_name: String,
}

struct SharedDurableEventListener {
    expected_subjects: BTreeSet<String>,
    handlers: BTreeMap<String, BTreeMap<u64, SharedEventHandler>>,
    concurrency: u32,
    pull_abort_handles: Vec<AbortHandle>,
}

#[derive(Clone)]
struct ServiceEventListenerRegistration {
    event_listeners: SharedDurableEventListeners,
    key: DurableEventListenerKey,
    subject: String,
    handler_id: u64,
}

struct ServiceEventListenerRegistryCleanup {
    event_listeners: SharedDurableEventListeners,
}

#[derive(Debug, Clone)]
struct EventProofValidationError {
    message: String,
    disposition: EventProofValidationDisposition,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum EventProofValidationDisposition {
    Nak,
    Pending,
    Term,
}

impl EventProofValidationError {
    fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            disposition: EventProofValidationDisposition::Term,
        }
    }

    fn nak(error: TrellisClientError) -> Self {
        Self {
            message: error.to_string(),
            disposition: EventProofValidationDisposition::Nak,
        }
    }

    fn pending(error: TrellisClientError) -> Self {
        Self {
            message: error.to_string(),
            disposition: EventProofValidationDisposition::Pending,
        }
    }

    fn disposition(&self) -> EventProofValidationDisposition {
        self.disposition
    }

    fn message(&self) -> &str {
        &self.message
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EventProofValidation {
    publisher: Option<ServiceEventPublisherContext>,
}

impl ServiceEventListenerRegistryCleanup {
    fn new(event_listeners: SharedDurableEventListeners) -> Self {
        Self { event_listeners }
    }
}

impl Drop for ServiceEventListenerRegistryCleanup {
    fn drop(&mut self) {
        spawn_service_event_listeners_cleanup(Arc::clone(&self.event_listeners));
    }
}

#[derive(Clone)]
struct LocalAuthRequestValidatorAdapter<C> {
    client: C,
}

impl<C> LocalAuthRequestValidatorAdapter<C> {
    fn new(client: C) -> Self {
        Self { client }
    }
}

impl RequestValidator for LocalAuthRequestValidatorAdapter<Arc<TrellisClient>> {
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
                Ok(RequestValidation::allowed_caller(serde_json::to_value(
                    response.caller,
                )?))
            } else {
                Ok(RequestValidation::denied())
            }
        })
    }
}

async fn validate_request_with_session_retry(
    client: &Arc<TrellisClient>,
    request: &AuthRequestsValidateRequest,
) -> Result<AuthRequestsValidateResponse, TrellisClientError> {
    for attempt in 0..AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS {
        match client.call::<AuthRequestsValidateRpc>(request).await {
            Ok(response) => return Ok(response),
            Err(error)
                if is_transient_event_validate_error(&error)
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

async fn validate_event_with_session_retry(
    client: &Arc<TrellisClient>,
    request: &AuthEventsValidateRequest,
) -> Result<AuthEventsValidateResponse, TrellisClientError> {
    for attempt in 0..AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS {
        match client.call::<AuthEventsValidateRpc>(request).await {
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

async fn validate_event_message(
    client: &Arc<TrellisClient>,
    subject: &str,
    payload: &[u8],
    headers: Option<&HeaderMap>,
) -> Result<EventProofValidation, EventProofValidationError> {
    let Some(headers) = headers else {
        return Err(EventProofValidationError::permanent(
            "missing event proof headers",
        ));
    };
    let session_key = required_event_header(headers, "session-key")?;
    let proof = required_event_header(headers, "proof")?;
    let event_id = required_event_header(headers, "Nats-Msg-Id")?;
    let event_time = required_event_header(headers, "Trellis-Event-Time")?;

    match verify_event_proof(
        &session_key,
        subject,
        payload,
        &event_id,
        &event_time,
        &proof,
    ) {
        Ok(true) => {}
        Ok(false) => {
            return Err(EventProofValidationError::permanent(
                "invalid event proof signature",
            ))
        }
        Err(error) => {
            return Err(EventProofValidationError::permanent(format!(
                "invalid event proof: {error}"
            )))
        }
    }

    let request = AuthEventsValidateRequest {
        event_id,
        event_time,
        payload_hash: payload_hash_base64url(payload),
        proof,
        session_key,
        subject: subject.to_string(),
    };
    let response = validate_event_with_session_retry(client, &request)
        .await
        .map_err(|error| {
            if is_transient_session_not_found(&error) {
                EventProofValidationError::nak(error)
            } else if is_definitive_event_validate_error(&error) {
                EventProofValidationError::permanent(format!(
                    "Auth.Events.Validate failed for {subject}: {error}"
                ))
            } else {
                EventProofValidationError::pending(error)
            }
        })?;
    if !response.allowed {
        return Err(EventProofValidationError::permanent(format!(
            "Auth.Events.Validate rejected event with status {}",
            response.status.as_str()
        )));
    }

    Ok(EventProofValidation {
        publisher: response.publisher.map(Into::into),
    })
}

fn required_event_header(
    headers: &HeaderMap,
    name: &str,
) -> Result<String, EventProofValidationError> {
    headers
        .get(name)
        .map(|value| value.as_str().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| EventProofValidationError::permanent(format!("missing event {name} header")))
}

fn is_transient_event_validate_error(error: &TrellisClientError) -> bool {
    is_transient_session_not_found(error)
        || matches!(
            error,
            TrellisClientError::Timeout | TrellisClientError::NatsRequest(_)
        )
}

fn is_definitive_event_validate_error(error: &TrellisClientError) -> bool {
    let TrellisClientError::RpcError(payload) = error else {
        return false;
    };
    if payload.error_type() != Some("AuthError") {
        return false;
    }

    payload
        .value()
        .and_then(|value| value.get("reason"))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|reason| reason != "session_not_found")
}

fn make_validate_request(
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

fn payload_hash_base64url(payload: &[u8]) -> String {
    let digest = Sha256::digest(payload);
    URL_SAFE_NO_PAD.encode(digest)
}

fn map_validate_request_error(subject: &str, error: TrellisClientError) -> ServerError {
    ServerError::Nats(format!(
        "Auth.Requests.Validate failed for {subject}: {error}"
    ))
}

/// Stream returned by high-level operation watch handlers.
pub type ServiceOperationWatch<TProgress, TOutput> =
    Pin<Box<dyn Stream<Item = Result<OperationSnapshot<TProgress, TOutput>, ServerError>> + Send>>;

/// Stream returned by operation handlers that opt in to live update events.
pub type ServiceOperationLiveWatch<TProgress, TUpdate, TOutput> = Pin<
    Box<
        dyn Stream<Item = Result<OperationLiveEvent<TProgress, TUpdate, TOutput>, ServerError>>
            + Send,
    >,
>;

/// Default request/connect timeout for service bootstrap and NATS RPC calls.
pub const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// Default retry delay while service deployment authority is pending.
pub const DEFAULT_RETRY_DELAY_MS: u64 = 1_000;

/// Default authority-pending wait limit. `None` waits until authority is ready.
pub const DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS: Option<u64> = None;

/// Contract constants emitted by generated Rust service SDKs.
pub trait GeneratedServiceContract {
    /// Trellis contract id, for example `example.service@v1`.
    const CONTRACT_ID: &'static str;

    /// Content digest for the generated contract manifest.
    const CONTRACT_DIGEST: &'static str;

    /// Canonical contract manifest JSON presented during service bootstrap.
    const CONTRACT_JSON: &'static str;
}

/// High-level options for connecting a generated Rust service runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceConnectOptions<'a> {
    /// Base Trellis runtime URL used for HTTP bootstrap.
    trellis_url: &'a str,
    /// Service instance name reported to the runtime.
    name: &'a str,
    /// Base64url-encoded service session seed.
    session_key_seed_base64url: &'a str,
    /// Request/connect timeout in milliseconds.
    timeout_ms: u64,
    /// Retry delay in milliseconds while bootstrap is pending authority readiness.
    retry_delay_ms: u64,
    /// Optional maximum authority-pending wait time. `None` waits until authority is ready.
    authority_pending_timeout_ms: Option<u64>,
}

impl<'a> ServiceConnectOptions<'a> {
    /// Create service connect options with ergonomic default timeouts.
    pub fn new(trellis_url: &'a str, name: &'a str, session_key_seed_base64url: &'a str) -> Self {
        Self {
            trellis_url,
            name,
            session_key_seed_base64url,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            retry_delay_ms: DEFAULT_RETRY_DELAY_MS,
            authority_pending_timeout_ms: DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
        }
    }

    /// Set the request/connect timeout in milliseconds.
    pub const fn with_timeout_ms(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }

    /// Set the delay between authority-pending bootstrap retries.
    pub const fn with_retry_delay_ms(mut self, retry_delay_ms: u64) -> Self {
        self.retry_delay_ms = retry_delay_ms;
        self
    }

    /// Limit authority-pending bootstrap wait time, or use `None` to wait indefinitely.
    pub const fn with_authority_pending_timeout_ms(mut self, timeout_ms: Option<u64>) -> Self {
        self.authority_pending_timeout_ms = timeout_ms;
        self
    }
}

/// Errors returned by the high-level service runtime facade.
#[derive(Debug, thiserror::Error)]
pub enum ServiceRuntimeError {
    /// Client-side bootstrap, transport, or outbound RPC failure.
    #[error(transparent)]
    Client(#[from] TrellisClientError),

    /// Server-side handler, auth-validation, or runtime-loop failure.
    #[error(transparent)]
    Server(#[from] ServerError),

    /// A service event listener handler failed while processing a concrete event message.
    #[error("event handler failed: {source}")]
    EventHandler {
        /// Handler failure returned by the service implementation.
        source: ServerError,
        /// Event metadata observed from the delivered message.
        context: ServiceEventListenerContext,
    },

    /// The service bootstrap response did not include a resource binding.
    #[error("service bootstrap response did not include a binding")]
    MissingBootstrapBinding,

    /// The service bootstrap binding could not be parsed as a core binding.
    #[error("invalid service bootstrap binding: {0}")]
    InvalidBootstrapBinding(#[source] serde_json::Error),

    /// Service-private jobs bindings were missing or invalid.
    #[error(transparent)]
    JobsBinding(#[from] crate::jobs::bindings::JobsBindingError),

    /// A service-private jobs worker host failed.
    #[error(transparent)]
    JobWorker(#[from] crate::jobs::internal::WorkerHostError),

    /// A generated jobs queue was not present in the resolved binding.
    #[error("jobs queue '{queue_type}' was not found in service bootstrap bindings")]
    MissingJobQueue {
        /// Declared queue type absent from the binding.
        queue_type: String,
    },

    /// The runtime was built without a client and cannot use the default runner.
    #[error("service runtime is missing a Trellis client")]
    MissingClient,

    /// A durable event listener supplied a caller-owned durable name.
    #[error(
        "durable event consumer names are provisioned by Trellis event consumer bindings; remove caller durable name '{durable_name}'"
    )]
    CallerDurableName {
        /// Caller-provided durable consumer name.
        durable_name: String,
    },

    /// No durable event consumer group was declared for the requested event subject.
    #[error("event subject '{subject}' is not declared in any event consumer group")]
    MissingEventConsumerGroup {
        /// Event subject requested by the listener.
        subject: String,
    },

    /// More than one durable event consumer group matched the requested event subject.
    #[error(
        "event subject '{subject}' is declared in multiple event consumer groups: {}; specify a group",
        groups.join(", ")
    )]
    AmbiguousEventConsumerGroup {
        /// Event subject requested by the listener.
        subject: String,
        /// Matching group names.
        groups: Vec<String>,
    },

    /// The requested event consumer group is not present in the bootstrap binding.
    #[error("event consumer group '{group}' was not found in service bootstrap bindings")]
    EventConsumerGroupNotFound {
        /// Requested event consumer group name.
        group: String,
    },

    /// The requested event consumer group does not include the event subject.
    #[error("event consumer group '{group}' does not include event subject '{subject}'")]
    EventConsumerGroupSubjectMismatch {
        /// Requested event consumer group name.
        group: String,
        /// Event subject requested by the listener.
        subject: String,
    },

    /// A durable listener count must be at least one.
    #[error("event consumer group '{group}' has invalid listener concurrency {concurrency}; expected >= 1")]
    InvalidEventListenerConcurrency {
        /// Event consumer group name.
        group: String,
        /// Invalid requested listener count.
        concurrency: u32,
    },

    /// Strict ordering permits only one pull loop per service instance.
    #[error(
        "event consumer group '{group}' uses strict ordering and requires listener concurrency 1"
    )]
    StrictEventListenerConcurrency {
        /// Strictly ordered event consumer group name.
        group: String,
    },

    /// Registrations sharing one durable consumer must use the same local count.
    #[error(
        "event consumer group '{group}' already uses listener concurrency {existing}; requested {requested}"
    )]
    EventListenerConcurrencyMismatch {
        /// Event consumer group name.
        group: String,
        /// Listener count already registered locally.
        existing: u32,
        /// Conflicting requested listener count.
        requested: u32,
    },
}

/// Options for registering a service event listener.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceEventListenOptions {
    /// Listener delivery mode. Durable listeners use Trellis-provisioned bindings by default.
    pub mode: ServiceEventListenerMode,
    /// Contract-local event consumer group name. Required when more than one group matches.
    pub group: Option<String>,
    /// Caller-provided durable names are rejected because Trellis owns durable consumers.
    pub durable_name: Option<String>,
    /// Number of local pull loops for a parallel durable consumer group.
    pub concurrency: u32,
}

impl Default for ServiceEventListenOptions {
    fn default() -> Self {
        Self {
            mode: ServiceEventListenerMode::Durable,
            group: None,
            durable_name: None,
            concurrency: 1,
        }
    }
}

/// Runtime context passed to service event listener handlers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceEventListenerContext {
    /// Listener delivery mode.
    pub mode: ServiceEventListenerMode,
    /// Contract-local event consumer group selected for durable listeners.
    pub group: Option<String>,
    /// Trellis event id from the `Nats-Msg-Id` header, when present.
    pub id: Option<String>,
    /// Trellis event timestamp from the `Trellis-Event-Time` header, when present.
    pub time: Option<String>,
    /// W3C traceparent propagated with the event, when present.
    pub traceparent: Option<String>,
    /// Raw event transport headers delivered with the message.
    pub headers: HeaderMap,
    /// Verified publisher metadata returned by `Auth.Events.Validate`, when available.
    pub publisher: Option<ServiceEventPublisherContext>,
}

/// Verified event publisher metadata returned by `Auth.Events.Validate`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceEventPublisherContext {
    /// Publisher participant kind.
    pub kind: String,
    /// Publisher deployment id, when the publisher is deployment-backed.
    pub deployment_id: Option<String>,
    /// Publisher runtime instance id, when known.
    pub instance_id: Option<String>,
    /// Publisher contract id, when known.
    pub contract_id: Option<String>,
    /// Publisher contract digest, when known.
    pub contract_digest: Option<String>,
    /// Retained session lifecycle status used for validation.
    pub session_status: String,
}

impl From<AuthEventsValidateResponsePublisher> for ServiceEventPublisherContext {
    fn from(publisher: AuthEventsValidateResponsePublisher) -> Self {
        Self {
            kind: publisher.kind.as_str().to_string(),
            deployment_id: publisher.deployment_id,
            instance_id: publisher.instance_id,
            contract_id: publisher.contract_id,
            contract_digest: publisher.contract_digest,
            session_status: publisher.session_status.as_str().to_string(),
        }
    }
}

/// Event listener delivery mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceEventListenerMode {
    /// Delivery comes from a live NATS subscription without durable JetStream cursor metadata.
    Ephemeral,
    /// Delivery comes from a Trellis-provisioned durable JetStream consumer.
    Durable,
}

/// Handle for a registered service event listener.
///
/// Call [`ServiceEventListenerHandle::abort`] to stop delivery for this handler
/// registration. Durable listeners are removed from the shared listener registry;
/// when the last handler for a durable consumer is removed, the shared pull task
/// is also aborted.
pub struct ServiceEventListenerHandle {
    task: JoinHandle<Result<(), ServiceRuntimeError>>,
    registration: StdMutex<Option<ServiceEventListenerRegistration>>,
}

impl std::fmt::Debug for ServiceEventListenerHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServiceEventListenerHandle")
            .field(
                "has_registration",
                &self
                    .registration
                    .lock()
                    .map(|registration| registration.is_some())
                    .unwrap_or(false),
            )
            .finish_non_exhaustive()
    }
}

impl ServiceEventListenerHandle {
    fn new(
        task: JoinHandle<Result<(), ServiceRuntimeError>>,
        registration: Option<ServiceEventListenerRegistration>,
    ) -> Self {
        Self {
            task,
            registration: StdMutex::new(registration),
        }
    }

    /// Abort this listener and remove its durable handler registration, if any.
    pub fn abort(&self) {
        if let Ok(mut registration) = self.registration.lock() {
            if let Some(registration) = registration.take() {
                spawn_service_event_listener_cleanup(registration);
            }
        }
        self.task.abort();
    }
}

impl Drop for ServiceEventListenerHandle {
    fn drop(&mut self) {
        if let Ok(registration) = self.registration.get_mut() {
            if let Some(registration) = registration.take() {
                spawn_service_event_listener_cleanup(registration);
            }
        }
        self.task.abort();
    }
}

impl Future for ServiceEventListenerHandle {
    type Output = Result<Result<(), ServiceRuntimeError>, JoinError>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        Pin::new(&mut self.task).poll(cx)
    }
}

/// Cloneable handle exposed to registered service handlers.
#[derive(Clone)]
pub struct ServiceHandle {
    client: Option<Arc<TrellisClient>>,
    service_name: Arc<str>,
    binding: CoreBootstrapBinding,
    resources: ServiceResourceBindings,
    event_listeners: SharedDurableEventListeners,
}

impl std::fmt::Debug for ServiceHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServiceHandle")
            .field("service_name", &self.service_name)
            .field("binding", &self.binding)
            .finish_non_exhaustive()
    }
}

impl ServiceHandle {
    /// Return the opaque caller used for generated outbound calls.
    pub fn caller(&self) -> crate::generated::Caller {
        crate::generated::Caller::from_client(Arc::clone(
            self.client
                .as_ref()
                .expect("connected service handles always include a Trellis client"),
        ))
    }

    /// Return the authenticated service session's public key.
    pub fn session_key(&self) -> &str {
        &self
            .client
            .as_ref()
            .expect("connected service handles always include a Trellis client")
            .auth()
            .session_key
    }

    fn client(&self) -> &Arc<TrellisClient> {
        self.client
            .as_ref()
            .expect("connected service handles always include a Trellis client")
    }

    /// Return the service instance name used during bootstrap.
    pub fn service_name(&self) -> &str {
        &self.service_name
    }

    /// Return the parsed core bootstrap binding supplied by service bootstrap.
    pub fn binding(&self) -> &CoreBootstrapBinding {
        &self.binding
    }

    /// Return all typed resource bindings resolved during service bootstrap.
    pub fn resources(&self) -> &ServiceResourceBindings {
        &self.resources
    }

    /// Return one KV/state resource binding by contract-local resource name.
    pub fn kv_binding(&self, name: &str) -> Result<&KvResourceBinding, ServerError> {
        self.resources
            .kv
            .get(name)
            .ok_or_else(|| ServerError::MissingResourceBinding {
                service_name: self.service_name().to_string(),
                resource_kind: "kv".to_string(),
                resource_name: name.to_string(),
            })
    }

    /// Return one object-store resource binding by contract-local resource name.
    pub fn store_binding(&self, name: &str) -> Result<&StoreResourceBinding, ServerError> {
        self.resources
            .store
            .get(name)
            .ok_or_else(|| ServerError::MissingResourceBinding {
                service_name: self.service_name().to_string(),
                resource_kind: "store".to_string(),
                resource_name: name.to_string(),
            })
    }

    /// Return the service-private jobs resource binding.
    pub fn jobs_binding(&self) -> Result<&JobsResourceBinding, ServerError> {
        self.resources
            .jobs
            .as_ref()
            .ok_or_else(|| ServerError::MissingResourceBinding {
                service_name: self.service_name().to_string(),
                resource_kind: "jobs".to_string(),
                resource_name: "jobs".to_string(),
            })
    }

    /// Return an event publisher backed by the connected Trellis client.
    pub fn event_publisher(&self) -> EventPublisher {
        EventPublisher::new(Arc::clone(self.client()))
    }

    /// Submit a typed service-private job for generated participant code.
    #[doc(hidden)]
    pub async fn generated_submit_job<D>(
        &self,
        payload: D::Payload,
    ) -> Result<JobRef<D::Payload, D::Result>, JobsError>
    where
        D: JobDescriptor,
    {
        let binding = self
            .binding
            .jobs_runtime_binding()
            .map_err(|error| JobsError::Message {
                message: error.to_string(),
            })?;
        let key_coordinator = crate::jobs::keys::NatsKeyCoordinator::open_for_service(
            self.client().nats().clone(),
            &binding.jobs.namespace,
        )
        .await
        .map_err(|error| JobsError::Message {
            message: error.to_string(),
        })?;
        let manager = JobManager::new_with_key_coordinator(
            TrellisJobEventPublisher::new(self.client().nats().clone()),
            binding.jobs,
            TrellisJobMetaSource,
            Arc::new(key_coordinator),
        );
        let job = manager
            .create(D::QUEUE_TYPE, payload)
            .await
            .map_err(|error| JobsError::Message {
                message: error.to_string(),
            })?;
        let queue = manager
            .bindings()
            .queues
            .get(D::QUEUE_TYPE)
            .cloned()
            .ok_or_else(|| JobsError::Message {
                message: format!("missing jobs queue binding '{}'", D::QUEUE_TYPE),
            })?;
        let waiter = crate::jobs::runtime_ref::NatsJobWaiter::new(
            self.client().nats().clone(),
            queue,
            Duration::from_secs(30),
        );
        let state = Arc::new(Mutex::new(job.clone()));
        let identity = JobIdentity::from(&job);

        let get_state = Arc::clone(&state);
        let get_waiter = waiter.clone();
        let wait_state = Arc::clone(&state);
        let wait_waiter = waiter.clone();
        let cancel_state = Arc::clone(&state);
        let cancel_waiter = waiter;
        let cancel_manager = manager;
        Ok(JobRef::new(
            identity,
            move || {
                let state = Arc::clone(&get_state);
                let waiter = get_waiter.clone();
                Box::pin(async move {
                    let current = state.lock().await.clone();
                    let current = waiter.get(current).await?;
                    *state.lock().await = current.clone();
                    JobSnapshot::try_from(current)
                })
            },
            move || {
                let state = Arc::clone(&wait_state);
                let waiter = wait_waiter.clone();
                Box::pin(async move {
                    let current = state.lock().await.clone();
                    let current = waiter.wait_for_terminal(current).await?;
                    *state.lock().await = current.clone();
                    JobSnapshot::try_from(current)
                })
            },
            move || {
                let state = Arc::clone(&cancel_state);
                let waiter = cancel_waiter.clone();
                let manager = cancel_manager.clone();
                Box::pin(async move {
                    let current = state.lock().await.clone();
                    manager
                        .cancel(&current)
                        .await
                        .map_err(|error| JobsError::Message {
                            message: error.to_string(),
                        })?;
                    let current = waiter.get(current).await?;
                    *state.lock().await = current.clone();
                    JobSnapshot::try_from(current)
                })
            },
        ))
    }

    /// Start a descriptor-backed event listener.
    pub async fn listen_event<D, F, Fut>(
        &self,
        handler: F,
        options: ServiceEventListenOptions,
    ) -> Result<ServiceEventListenerHandle, ServiceRuntimeError>
    where
        D: crate::client::EventDescriptor + 'static,
        D::Event: Send + 'static,
        F: Fn(D::Event, ServiceEventListenerContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<(), ServerError>> + Send + 'static,
    {
        listen_event_with_bindings::<D, _, _>(
            self.client(),
            &self.resources.event_consumers,
            Arc::clone(&self.event_listeners),
            handler,
            options,
        )
        .await
    }

    /// Open a bound KV resource client by contract-local resource name.
    pub async fn kv_client(&self, name: &str) -> Result<KvHandle, ServerError> {
        let binding = self.kv_binding(name)?;
        validate_kv_binding(self.service_name(), name, binding)?;
        let client = self.client().nats().open_kv(binding).await?;
        Ok(KvResourceHandle::new(name, binding.clone(), client))
    }

    /// Open a bound object-store resource client by contract-local resource name.
    pub async fn store_client(&self, name: &str) -> Result<StoreHandle, ServerError> {
        let binding = self.store_binding(name)?;
        validate_store_binding(self.service_name(), name, binding)?;
        let client = self.client().nats().open_store(binding).await?;
        Ok(StoreResourceHandle::new(
            self.service_name(),
            name,
            binding.clone(),
            client,
        ))
    }

    /// Subscribe and run an upload transfer endpoint backed by the connected NATS client.
    pub async fn spawn_upload_transfer_endpoint_with_progress<C, F>(
        &self,
        session: UploadTransferSession,
        store: C,
        on_progress: F,
    ) -> Result<(), ServerError>
    where
        C: StoreResourceClient,
        F: Fn(OperationTransferProgress) + Send + Sync + 'static,
    {
        spawn_upload_transfer_endpoint_with_progress(
            self.client().nats().clone(),
            session,
            store,
            super::DefaultRequestValidator::new(Arc::clone(self.client())),
            on_progress,
        )
        .await
    }

    /// Subscribe and run an upload transfer endpoint that can be awaited until durable storage.
    pub async fn spawn_upload_transfer_endpoint_with_completion<C>(
        &self,
        session: UploadTransferSession,
        store: C,
    ) -> Result<UploadTransferCompletion, ServerError>
    where
        C: StoreResourceClient,
    {
        spawn_upload_transfer_endpoint_with_completion(
            self.client().nats().clone(),
            session,
            store,
            super::DefaultRequestValidator::new(Arc::clone(self.client())),
        )
        .await
    }

    /// Subscribe and run a download transfer endpoint backed by the connected NATS client.
    pub async fn spawn_download_transfer_endpoint<C>(
        &self,
        plan: DownloadTransferGrantPlan,
        store: C,
    ) -> Result<(), ServerError>
    where
        C: StoreResourceClient,
    {
        spawn_download_transfer_endpoint(
            self.client().nats().clone(),
            plan,
            store,
            super::DefaultRequestValidator::new(Arc::clone(self.client())),
        )
        .await
    }
}

/// Per-request handler context with request metadata and a cloneable service handle.
#[derive(Debug, Clone)]
pub struct ServiceHandlerContext {
    request: RequestContext,
    handle: ServiceHandle,
}

impl ServiceHandlerContext {
    /// Build a handler context from low-level request metadata and a service handle.
    pub fn new(request: RequestContext, handle: ServiceHandle) -> Self {
        Self { request, handle }
    }

    /// Return low-level request metadata, including caller and tracing fields.
    pub fn request(&self) -> &RequestContext {
        &self.request
    }

    /// Return the cloneable service handle for outbound calls and bindings.
    pub fn handle(&self) -> &ServiceHandle {
        &self.handle
    }

    /// Plan an upload transfer using this request's authenticated caller and service bindings.
    #[allow(clippy::too_many_arguments)]
    pub fn plan_upload_transfer(
        &self,
        store: &str,
        key: &str,
        transfer_id: &str,
        expires_at: &str,
        chunk_bytes: u64,
        max_bytes: Option<u64>,
        content_type: Option<&str>,
        metadata: BTreeMap<String, String>,
    ) -> Result<UploadTransferGrantPlan, ServerError> {
        let session_key =
            self.request
                .session_key
                .as_deref()
                .ok_or_else(|| ServerError::MissingSessionKey {
                    subject: self.request.subject.clone(),
                })?;
        super::plan_upload_transfer_grant(super::TransferUploadGrantArgs {
            service_name: self.handle.service_name(),
            session_key,
            service_session_key: self.handle.session_key(),
            resources: self.handle.resources(),
            store,
            key,
            transfer_id,
            expires_at,
            chunk_bytes,
            max_bytes,
            content_type,
            metadata,
        })
    }

    /// Plan a download transfer using this request's authenticated caller and service bindings.
    pub fn plan_download_transfer(
        &self,
        store: &str,
        transfer_id: &str,
        expires_at: &str,
        chunk_bytes: u64,
        info: super::FileTransferInfo,
    ) -> Result<DownloadTransferGrantPlan, ServerError> {
        let session_key =
            self.request
                .session_key
                .as_deref()
                .ok_or_else(|| ServerError::MissingSessionKey {
                    subject: self.request.subject.clone(),
                })?;
        super::plan_download_transfer_grant(super::TransferDownloadGrantArgs {
            service_name: self.handle.service_name(),
            session_key,
            service_session_key: self.handle.session_key(),
            resources: self.handle.resources(),
            store,
            transfer_id,
            expires_at,
            chunk_bytes,
            info,
        })
    }

    /// Consume this context into the low-level request metadata.
    pub fn into_request_context(self) -> RequestContext {
        self.request
    }
}

/// Connected high-level service runtime for one generated service contract.
pub struct ConnectedServiceRuntime<C> {
    client: Option<Arc<TrellisClient>>,
    caller: Option<crate::generated::Caller>,
    binding: CoreBootstrapBinding,
    resources: ServiceResourceBindings,
    event_listeners: SharedDurableEventListeners,
    _event_listener_cleanup: ServiceEventListenerRegistryCleanup,
    router: Router,
    service_name: String,
    registered_subjects: BTreeSet<String>,
    job_hosts: Vec<WorkerHostHandle>,
    _contract: PhantomData<C>,
}

impl<C> std::fmt::Debug for ConnectedServiceRuntime<C> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectedServiceRuntime")
            .field("binding", &self.binding)
            .field("service_name", &self.service_name)
            .field("registered_subjects", &self.registered_subjects)
            .finish_non_exhaustive()
    }
}

impl<C> ConnectedServiceRuntime<C> {
    /// Build a connected runtime from an injected client and bootstrap binding.
    pub(crate) fn from_parts(
        service_name: impl Into<String>,
        client: Arc<TrellisClient>,
        binding: CoreBootstrapBinding,
    ) -> Self {
        let resources = binding.resource_bindings();
        let event_listeners = SharedDurableEventListeners::default();
        let caller = crate::generated::Caller::new(Arc::clone(&client));
        Self {
            client: Some(client),
            caller: Some(caller),
            binding,
            resources,
            event_listeners: Arc::clone(&event_listeners),
            _event_listener_cleanup: ServiceEventListenerRegistryCleanup::new(event_listeners),
            router: Router::new(),
            service_name: service_name.into(),
            registered_subjects: BTreeSet::new(),
            job_hosts: Vec::new(),
            _contract: PhantomData,
        }
    }

    /// Build a connected runtime from a service client that already completed bootstrap.
    #[cfg(feature = "test-support")]
    pub(crate) fn from_connected_client(
        service_name: impl Into<String>,
        client: Arc<TrellisClient>,
    ) -> Result<Self, ServiceRuntimeError> {
        let binding = parse_bootstrap_binding(client.as_ref())?;
        Ok(Self::from_parts(service_name, client, binding))
    }

    /// Return the internal Trellis client owned by this runtime.
    pub(crate) fn client(&self) -> &Arc<TrellisClient> {
        self.client
            .as_ref()
            .expect("connected service runtimes always include a Trellis client")
    }

    /// Return the opaque caller handle consumed by generated facades.
    #[doc(hidden)]
    pub fn caller(&self) -> &crate::generated::Caller {
        self.caller
            .as_ref()
            .expect("connected service runtimes always include a caller handle")
    }

    /// Return the parsed core bootstrap binding supplied by service bootstrap.
    pub fn binding(&self) -> &CoreBootstrapBinding {
        &self.binding
    }

    /// Return all typed resource bindings resolved during service bootstrap.
    pub fn resources(&self) -> &ServiceResourceBindings {
        &self.resources
    }

    /// Return one KV/state resource binding by contract-local resource name.
    pub fn kv_binding(&self, name: &str) -> Result<&KvResourceBinding, ServerError> {
        self.resources
            .kv
            .get(name)
            .ok_or_else(|| ServerError::MissingResourceBinding {
                service_name: self.service_name().to_string(),
                resource_kind: "kv".to_string(),
                resource_name: name.to_string(),
            })
    }

    /// Return one object-store resource binding by contract-local resource name.
    pub fn store_binding(&self, name: &str) -> Result<&StoreResourceBinding, ServerError> {
        self.resources
            .store
            .get(name)
            .ok_or_else(|| ServerError::MissingResourceBinding {
                service_name: self.service_name().to_string(),
                resource_kind: "store".to_string(),
                resource_name: name.to_string(),
            })
    }

    /// Return the service-private jobs resource binding.
    pub fn jobs_binding(&self) -> Result<&JobsResourceBinding, ServerError> {
        self.resources
            .jobs
            .as_ref()
            .ok_or_else(|| ServerError::MissingResourceBinding {
                service_name: self.service_name().to_string(),
                resource_kind: "jobs".to_string(),
                resource_name: "jobs".to_string(),
            })
    }

    /// Return the Jobs-domain transport used by Trellis infrastructure services.
    pub fn jobs_runtime(&self) -> crate::jobs::JobsRuntime {
        crate::jobs::JobsRuntime::from_client(self.client())
    }

    /// Return Jobs-only worker host access for Trellis integration tests.
    #[cfg(feature = "test-support")]
    #[doc(hidden)]
    pub fn test_jobs_worker_runtime(
        &self,
    ) -> Result<crate::jobs::TestJobsWorkerRuntime, ServiceRuntimeError> {
        Ok(crate::jobs::TestJobsWorkerRuntime::new(
            Arc::clone(self.client()),
            self.binding.jobs_runtime_binding()?,
        ))
    }

    /// Return the Event Log domain transport used by Trellis infrastructure.
    pub fn eventlog_runtime(&self) -> super::EventLogRuntime {
        super::EventLogRuntime::from_client(Arc::clone(self.client()))
    }

    /// Submit a typed service-private job for generated participant code.
    #[doc(hidden)]
    pub async fn generated_submit_job<D>(
        &self,
        payload: D::Payload,
    ) -> Result<JobRef<D::Payload, D::Result>, JobsError>
    where
        D: JobDescriptor,
    {
        self.generated_handle()
            .generated_submit_job::<D>(payload)
            .await
    }

    /// Start one generated service-private job worker and retain its lifecycle.
    #[doc(hidden)]
    pub async fn register_generated_job_worker<D, H, Fut, E>(
        &mut self,
        handler: H,
    ) -> Result<(), ServiceRuntimeError>
    where
        D: JobDescriptor + 'static,
        H: Fn(crate::jobs::ActiveJob<D::Payload, D::Result>) -> Fut + Clone + Send + Sync + 'static,
        Fut: Future<Output = Result<D::Result, E>> + Send + 'static,
        E: ToString + Send + 'static,
    {
        let mut binding = self.binding.jobs_runtime_binding()?;
        binding
            .jobs
            .queues
            .retain(|queue, _| queue == D::QUEUE_TYPE);
        if binding.jobs.queues.is_empty() {
            return Err(ServiceRuntimeError::MissingJobQueue {
                queue_type: D::QUEUE_TYPE.to_string(),
            });
        }
        let host = start_worker_host_from_client(
            self.client(),
            binding,
            ulid::Ulid::new().to_string(),
            |_, _| TrellisJobMetaSource,
            move |active| {
                let handler = handler.clone();
                async move {
                    let active = crate::jobs::internal::typed_active_job::<D>(active)
                        .map_err(|error| JobProcessError::Failed(error.to_string()))?;
                    let result = handler(active)
                        .await
                        .map_err(|error| JobProcessError::Failed(error.to_string()))?;
                    serde_json::to_value(result)
                        .map_err(|error| JobProcessError::Failed(error.to_string()))
                }
            },
            WorkerHostOptions::default(),
        )
        .await?;
        self.job_hosts.push(host);
        Ok(())
    }

    /// Return an event publisher backed by the connected NATS client.
    pub fn event_publisher(&self) -> EventPublisher {
        EventPublisher::new(Arc::clone(self.client()))
    }

    /// Start a descriptor-backed event listener.
    pub async fn listen_event<D, F, Fut>(
        &self,
        handler: F,
        options: ServiceEventListenOptions,
    ) -> Result<ServiceEventListenerHandle, ServiceRuntimeError>
    where
        D: crate::client::EventDescriptor + 'static,
        D::Event: Send + 'static,
        F: Fn(D::Event, ServiceEventListenerContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<(), ServerError>> + Send + 'static,
    {
        listen_event_with_bindings::<D, _, _>(
            self.client(),
            &self.resources.event_consumers,
            Arc::clone(&self.event_listeners),
            handler,
            options,
        )
        .await
    }

    /// Open a bound KV resource client by contract-local resource name.
    pub async fn kv_client(&self, name: &str) -> Result<KvHandle, ServerError> {
        let binding = self.kv_binding(name)?;
        validate_kv_binding(self.service_name(), name, binding)?;
        let client = self.client().nats().open_kv(binding).await?;
        Ok(KvResourceHandle::new(name, binding.clone(), client))
    }

    /// Open a bound object-store resource client by contract-local resource name.
    pub async fn store_client(&self, name: &str) -> Result<StoreHandle, ServerError> {
        let binding = self.store_binding(name)?;
        validate_store_binding(self.service_name(), name, binding)?;
        let client = self.client().nats().open_store(binding).await?;
        Ok(StoreResourceHandle::new(
            self.service_name(),
            name,
            binding.clone(),
            client,
        ))
    }

    /// Return the service instance name used during bootstrap.
    pub fn service_name(&self) -> &str {
        &self.service_name
    }

    /// Return the registered NATS subjects, derived from descriptors.
    pub fn registered_subjects(&self) -> Vec<&str> {
        self.registered_subjects
            .iter()
            .map(String::as_str)
            .collect()
    }

    /// Register one descriptor-backed RPC handler and record its subject.
    pub fn register_rpc<D, F, Fut>(&mut self, handler: F)
    where
        D: RpcDescriptor + 'static,
        F: Fn(ServiceHandlerContext, D::Input) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = HandlerResult<D::Output>> + Send + 'static,
    {
        let handle = self.generated_handle();
        self.router.register_rpc::<D, _, _>(move |request, input| {
            handler(ServiceHandlerContext::new(request, handle.clone()), input)
        });
        self.registered_subjects.insert(D::SUBJECT.to_string());
    }

    /// Register one descriptor-backed feed handler and record its subject.
    pub fn register_feed<D, F, S>(&mut self, handler: F)
    where
        D: FeedDescriptor + 'static,
        F: Fn(ServiceHandlerContext, D::Input) -> S + Send + Sync + 'static,
        S: Stream<Item = Result<D::Event, ServerError>> + Send + 'static,
    {
        let handle = self.generated_handle();
        self.router.register_feed::<D, _, _>(move |request, input| {
            handler(ServiceHandlerContext::new(request, handle.clone()), input)
        });
        self.registered_subjects.insert(D::SUBJECT.to_string());
    }

    /// Register one operation-backed provider and record data/control subjects.
    pub fn register_operation_provider<D, P>(&mut self, provider: P)
    where
        D: OperationDescriptor + 'static,
        P: ServiceOperationProvider<D>,
    {
        self.router
            .register_operation_provider::<D, _>(OperationProviderAdapter {
                handle: self.generated_handle(),
                provider,
                _descriptor: PhantomData,
            });
        self.registered_subjects.insert(D::SUBJECT.to_string());
        self.registered_subjects.insert(control_subject(D::SUBJECT));
    }

    /// Register one operation handler with an explicit watch stream and record data/control subjects.
    pub fn register_operation_with_watch<
        D,
        FStart,
        FutStart,
        FGet,
        FutGet,
        FWatch,
        FCancel,
        FutCancel,
    >(
        &mut self,
        start: FStart,
        get: FGet,
        watch: FWatch,
        cancel: FCancel,
    ) where
        D: OperationDescriptor + 'static,
        FStart: Fn(ServiceHandlerContext, D::Input) -> FutStart + Send + Sync + 'static,
        FutStart: Future<Output = Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FGet: Fn(ServiceHandlerContext, String) -> FutGet + Send + Sync + 'static,
        FutGet: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FWatch: Fn(ServiceHandlerContext, String) -> ServiceOperationWatch<D::Progress, D::Output>
            + Send
            + Sync
            + 'static,
        FCancel: Fn(ServiceHandlerContext, String) -> FutCancel + Send + Sync + 'static,
        FutCancel: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
    {
        let start_handle = self.generated_handle();
        let get_handle = self.generated_handle();
        let watch_handle = self.generated_handle();
        let cancel_handle = self.generated_handle();
        self.router
            .register_operation_with_watch::<D, _, _, _, _, _, _, _>(
                move |request, input| {
                    start(
                        ServiceHandlerContext::new(request, start_handle.clone()),
                        input,
                    )
                },
                move |request, operation_id| {
                    get(
                        ServiceHandlerContext::new(request, get_handle.clone()),
                        operation_id,
                    )
                },
                move |request, operation_id| {
                    watch(
                        ServiceHandlerContext::new(request, watch_handle.clone()),
                        operation_id,
                    )
                },
                move |request, operation_id| {
                    cancel(
                        ServiceHandlerContext::new(request, cancel_handle.clone()),
                        operation_id,
                    )
                },
            );
        self.registered_subjects.insert(D::SUBJECT.to_string());
        self.registered_subjects.insert(control_subject(D::SUBJECT));
    }

    /// Register one operation handler with a single wait snapshot and record data/control subjects.
    pub fn register_operation<
        D,
        FStart,
        FutStart,
        FGet,
        FutGet,
        FWait,
        FutWait,
        FCancel,
        FutCancel,
    >(
        &mut self,
        start: FStart,
        get: FGet,
        wait: FWait,
        cancel: FCancel,
    ) where
        D: OperationDescriptor + 'static,
        FStart: Fn(ServiceHandlerContext, D::Input) -> FutStart + Send + Sync + 'static,
        FutStart: Future<Output = Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FGet: Fn(ServiceHandlerContext, String) -> FutGet + Send + Sync + 'static,
        FutGet: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FWait: Fn(ServiceHandlerContext, String) -> FutWait + Send + Sync + 'static,
        FutWait: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FCancel: Fn(ServiceHandlerContext, String) -> FutCancel + Send + Sync + 'static,
        FutCancel: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
    {
        let start_handle = self.generated_handle();
        let get_handle = self.generated_handle();
        let wait_handle = self.generated_handle();
        let cancel_handle = self.generated_handle();
        self.router.register_operation::<D, _, _, _, _, _, _, _, _>(
            move |request, input| {
                start(
                    ServiceHandlerContext::new(request, start_handle.clone()),
                    input,
                )
            },
            move |request, operation_id| {
                get(
                    ServiceHandlerContext::new(request, get_handle.clone()),
                    operation_id,
                )
            },
            move |request, operation_id| {
                wait(
                    ServiceHandlerContext::new(request, wait_handle.clone()),
                    operation_id,
                )
            },
            move |request, operation_id| {
                cancel(
                    ServiceHandlerContext::new(request, cancel_handle.clone()),
                    operation_id,
                )
            },
        );
        self.registered_subjects.insert(D::SUBJECT.to_string());
        self.registered_subjects.insert(control_subject(D::SUBJECT));
    }

    /// Register one operation handler with watch and signal control support.
    pub fn register_operation_with_watch_and_signal<
        D,
        FStart,
        FutStart,
        FGet,
        FutGet,
        FWatch,
        FCancel,
        FutCancel,
        FSignal,
        FutSignal,
    >(
        &mut self,
        start: FStart,
        get: FGet,
        watch: FWatch,
        cancel: FCancel,
        signal: FSignal,
    ) where
        D: OperationDescriptor + 'static,
        FStart: Fn(ServiceHandlerContext, D::Input) -> FutStart + Send + Sync + 'static,
        FutStart: Future<Output = Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FGet: Fn(ServiceHandlerContext, String) -> FutGet + Send + Sync + 'static,
        FutGet: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FWatch: Fn(ServiceHandlerContext, String) -> ServiceOperationWatch<D::Progress, D::Output>
            + Send
            + Sync
            + 'static,
        FCancel: Fn(ServiceHandlerContext, String) -> FutCancel + Send + Sync + 'static,
        FutCancel: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FSignal: Fn(ServiceHandlerContext, String, String, Option<Value>) -> FutSignal
            + Send
            + Sync
            + 'static,
        FutSignal: Future<Output = Result<OperationSignalAccepted<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
    {
        let start_handle = self.generated_handle();
        let get_handle = self.generated_handle();
        let watch_handle = self.generated_handle();
        let cancel_handle = self.generated_handle();
        let signal_handle = self.generated_handle();
        self.router
            .register_operation_with_watch_and_signal::<D, _, _, _, _, _, _, _, _, _>(
                move |request, input| {
                    start(
                        ServiceHandlerContext::new(request, start_handle.clone()),
                        input,
                    )
                },
                move |request, operation_id| {
                    get(
                        ServiceHandlerContext::new(request, get_handle.clone()),
                        operation_id,
                    )
                },
                move |request, operation_id| {
                    watch(
                        ServiceHandlerContext::new(request, watch_handle.clone()),
                        operation_id,
                    )
                },
                move |request, operation_id| {
                    cancel(
                        ServiceHandlerContext::new(request, cancel_handle.clone()),
                        operation_id,
                    )
                },
                move |request, operation_id, signal_name, input| {
                    signal(
                        ServiceHandlerContext::new(request, signal_handle.clone()),
                        operation_id,
                        signal_name,
                        input,
                    )
                },
            );
        self.registered_subjects.insert(D::SUBJECT.to_string());
        self.registered_subjects.insert(control_subject(D::SUBJECT));
    }

    /// Register one operation handler with typed live updates and signal control support.
    pub fn register_operation_with_updates_and_signal<
        D,
        FStart,
        FutStart,
        FGet,
        FutGet,
        FWatch,
        FCancel,
        FutCancel,
        FSignal,
        FutSignal,
    >(
        &mut self,
        start: FStart,
        get: FGet,
        watch: FWatch,
        cancel: FCancel,
        signal: FSignal,
    ) where
        D: super::OperationUpdateDescriptor + 'static,
        D::Update: serde::Serialize + Send + 'static,
        FStart: Fn(ServiceHandlerContext, D::Input) -> FutStart + Send + Sync + 'static,
        FutStart: Future<Output = Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FGet: Fn(ServiceHandlerContext, String) -> FutGet + Send + Sync + 'static,
        FutGet: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FWatch: Fn(
                ServiceHandlerContext,
                String,
            ) -> ServiceOperationLiveWatch<D::Progress, D::Update, D::Output>
            + Send
            + Sync
            + 'static,
        FCancel: Fn(ServiceHandlerContext, String) -> FutCancel + Send + Sync + 'static,
        FutCancel: Future<Output = Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
        FSignal: Fn(ServiceHandlerContext, String, String, Option<Value>) -> FutSignal
            + Send
            + Sync
            + 'static,
        FutSignal: Future<Output = Result<OperationSignalAccepted<D::Progress, D::Output>, ServerError>>
            + Send
            + 'static,
    {
        let start_handle = self.generated_handle();
        let get_handle = self.generated_handle();
        let watch_handle = self.generated_handle();
        let cancel_handle = self.generated_handle();
        let signal_handle = self.generated_handle();
        self.router
            .register_operation_with_updates_and_signal::<D, _, _, _, _, _, _, _, _, _>(
                move |request, input| {
                    start(
                        ServiceHandlerContext::new(request, start_handle.clone()),
                        input,
                    )
                },
                move |request, operation_id| {
                    get(
                        ServiceHandlerContext::new(request, get_handle.clone()),
                        operation_id,
                    )
                },
                move |request, operation_id| {
                    watch(
                        ServiceHandlerContext::new(request, watch_handle.clone()),
                        operation_id,
                    )
                },
                move |request, operation_id| {
                    cancel(
                        ServiceHandlerContext::new(request, cancel_handle.clone()),
                        operation_id,
                    )
                },
                move |request, operation_id, signal_name, input| {
                    signal(
                        ServiceHandlerContext::new(request, signal_handle.clone()),
                        operation_id,
                        signal_name,
                        input,
                    )
                },
            );
        self.registered_subjects.insert(D::SUBJECT.to_string());
        self.registered_subjects.insert(control_subject(D::SUBJECT));
    }

    /// Run registered subjects using the default NATS request loop.
    pub async fn run(self) -> Result<(), ServiceRuntimeError> {
        self.run_with_runner(DefaultServiceRunner).await
    }

    /// Run registered subjects using an injected runner seam.
    pub(crate) async fn run_with_runner<R>(self, runner: R) -> Result<(), ServiceRuntimeError>
    where
        R: ServiceRuntimeRunner,
    {
        let subjects = self.registered_subjects.into_iter().collect::<Vec<_>>();
        let job_hosts = self.job_hosts;
        if let Some(client) = self.client {
            let host = bootstrap_service_host(
                &self.service_name,
                self.binding.bootstrap_binding(),
                self.router,
                LocalAuthRequestValidatorAdapter::new(Arc::clone(&client)),
            );
            if job_hosts.is_empty() {
                return runner
                    .run(Some(client), subjects, host)
                    .await
                    .map_err(ServiceRuntimeError::Server);
            }
            let serve = async {
                runner
                    .run(Some(client), subjects, host)
                    .await
                    .map_err(ServiceRuntimeError::Server)
            };
            let workers = async {
                futures_util::future::try_join_all(
                    job_hosts.into_iter().map(WorkerHostHandle::join),
                )
                .await
                .map_err(ServiceRuntimeError::JobWorker)?;
                Ok(())
            };
            tokio::try_join!(serve, workers)?;
            return Ok(());
        }

        #[cfg(test)]
        {
            return runner
                .run(None, subjects, EmptyHandler)
                .await
                .map_err(ServiceRuntimeError::Server);
        }

        #[cfg(not(test))]
        {
            Err(ServiceRuntimeError::MissingClient)
        }
    }

    /// Return a cloneable service handle for generated participant code.
    #[doc(hidden)]
    pub fn generated_handle(&self) -> ServiceHandle {
        ServiceHandle {
            client: self.client.as_ref().map(Arc::clone),
            service_name: Arc::from(self.service_name.as_str()),
            binding: self.binding.clone(),
            resources: self.resources.clone(),
            event_listeners: Arc::clone(&self.event_listeners),
        }
    }

    #[cfg(test)]
    fn from_test_binding(service_name: impl Into<String>, binding: CoreBootstrapBinding) -> Self {
        let resources = binding.resource_bindings();
        let event_listeners = SharedDurableEventListeners::default();
        Self {
            client: None,
            caller: None,
            binding,
            resources,
            event_listeners: Arc::clone(&event_listeners),
            _event_listener_cleanup: ServiceEventListenerRegistryCleanup::new(event_listeners),
            router: Router::new(),
            service_name: service_name.into(),
            registered_subjects: BTreeSet::new(),
            job_hosts: Vec::new(),
            _contract: PhantomData,
        }
    }
}

impl<C> ConnectedServiceRuntime<C>
where
    C: GeneratedServiceContract,
{
    /// Connect with generated contract constants and parse the returned bootstrap binding.
    pub async fn connect(options: ServiceConnectOptions<'_>) -> Result<Self, ServiceRuntimeError> {
        let client =
            TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
                trellis_url: options.trellis_url,
                contract_id: C::CONTRACT_ID,
                contract_digest: C::CONTRACT_DIGEST,
                contract_json: C::CONTRACT_JSON,
                session_key_seed_base64url: options.session_key_seed_base64url,
                timeout_ms: options.timeout_ms,
                retry_delay_ms: options.retry_delay_ms,
                authority_pending_timeout_ms: options.authority_pending_timeout_ms,
            })
            .await?;
        let binding = parse_bootstrap_binding(&client)?;
        Ok(Self::from_parts(options.name, Arc::new(client), binding))
    }
}

/// Provider-style operation handler using the high-level service handler context.
pub trait ServiceOperationProvider<D>: Send + Sync + 'static
where
    D: OperationDescriptor,
{
    /// Start a new operation instance from decoded input.
    fn start(
        &self,
        context: ServiceHandlerContext,
        input: D::Input,
    ) -> BoxFuture<'static, Result<AcceptedOperation<D::Progress, D::Output>, ServerError>>;

    /// Return the current snapshot for an operation id.
    fn get(
        &self,
        context: ServiceHandlerContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;

    /// Wait for a later or terminal snapshot for an operation id.
    fn wait(
        &self,
        context: ServiceHandlerContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;

    /// Cancel an operation id and return the resulting snapshot.
    fn cancel(
        &self,
        context: ServiceHandlerContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>>;
}

struct OperationProviderAdapter<D, P> {
    handle: ServiceHandle,
    provider: P,
    _descriptor: PhantomData<fn() -> D>,
}

impl<D, P> OperationProvider<D> for OperationProviderAdapter<D, P>
where
    D: OperationDescriptor + 'static,
    P: ServiceOperationProvider<D>,
{
    fn start(
        &self,
        context: RequestContext,
        input: D::Input,
    ) -> BoxFuture<'static, Result<AcceptedOperation<D::Progress, D::Output>, ServerError>> {
        self.provider.start(
            ServiceHandlerContext::new(context, self.handle.clone()),
            input,
        )
    }

    fn get(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>> {
        self.provider.get(
            ServiceHandlerContext::new(context, self.handle.clone()),
            operation_id,
        )
    }

    fn wait(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>> {
        self.provider.wait(
            ServiceHandlerContext::new(context, self.handle.clone()),
            operation_id,
        )
    }

    fn cancel(
        &self,
        context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<D::Progress, D::Output>, ServerError>> {
        self.provider.cancel(
            ServiceHandlerContext::new(context, self.handle.clone()),
            operation_id,
        )
    }
}

/// Runner seam for tests and alternate service loop implementations.
pub(crate) trait ServiceRuntimeRunner {
    /// Future returned by the runner.
    type RunFuture: Future<Output = Result<(), ServerError>>;

    /// Run a prepared authenticated host for the exact registered subjects.
    fn run<H>(
        self,
        client: Option<Arc<TrellisClient>>,
        subjects: Vec<String>,
        host: H,
    ) -> Self::RunFuture
    where
        H: RequestHandler + Send + Sync + 'static;
}

/// Default runner backed by the local multi-subject NATS loop.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct DefaultServiceRunner;

impl ServiceRuntimeRunner for DefaultServiceRunner {
    type RunFuture = BoxFuture<'static, Result<(), ServerError>>;

    fn run<H>(
        self,
        client: Option<Arc<TrellisClient>>,
        subjects: Vec<String>,
        host: H,
    ) -> Self::RunFuture
    where
        H: RequestHandler + Send + Sync + 'static,
    {
        Box::pin(async move {
            let client = client.ok_or(ServerError::Nats(
                "service runtime is missing a Trellis client".to_string(),
            ))?;
            if subjects.is_empty() {
                std::future::pending::<()>().await;
            }
            let subject_refs = subjects.iter().map(String::as_str).collect::<Vec<_>>();
            run_multi_subject_service(client.nats().clone(), &subject_refs, host).await
        })
    }
}

#[cfg(test)]
struct EmptyHandler;

#[cfg(test)]
impl RequestHandler for EmptyHandler {
    fn handle<'a>(
        &'a self,
        _subject: &'a str,
        _payload: Bytes,
        _context: RequestContext,
    ) -> BoxFuture<'a, Result<Bytes, ServerError>> {
        Box::pin(async { Err(ServerError::Nats("empty test handler".to_string())) })
    }
}

fn parse_bootstrap_binding(
    client: &TrellisClient,
) -> Result<CoreBootstrapBinding, ServiceRuntimeError> {
    let value = client
        .service_bootstrap_binding()
        .ok_or(ServiceRuntimeError::MissingBootstrapBinding)?;
    let binding = serde_json::from_value::<TrellisBindingsGetResponseBinding>(value.clone())
        .map_err(ServiceRuntimeError::InvalidBootstrapBinding)?;
    Ok(CoreBootstrapBinding::new(binding))
}

fn service_event_context_from_message<T>(
    mode: ServiceEventListenerMode,
    group: Option<String>,
    message: &EventMessage<T>,
    publisher: Option<ServiceEventPublisherContext>,
) -> ServiceEventListenerContext {
    service_event_context_from_headers(mode, group, message.headers(), publisher)
}

fn service_event_context_from_headers(
    mode: ServiceEventListenerMode,
    group: Option<String>,
    headers: Option<&HeaderMap>,
    publisher: Option<ServiceEventPublisherContext>,
) -> ServiceEventListenerContext {
    let headers = headers.cloned().unwrap_or_default();
    ServiceEventListenerContext {
        mode,
        group,
        id: headers
            .get("Nats-Msg-Id")
            .map(|value| value.as_str().to_string()),
        time: headers
            .get("Trellis-Event-Time")
            .map(|value| value.as_str().to_string()),
        traceparent: headers
            .get("traceparent")
            .map(|value| value.as_str().to_string()),
        headers,
        publisher,
    }
}

async fn listen_event_with_bindings<D, F, Fut>(
    client: &Arc<TrellisClient>,
    bindings: &BTreeMap<String, super::EventConsumerResourceBinding>,
    event_listeners: SharedDurableEventListeners,
    handler: F,
    options: ServiceEventListenOptions,
) -> Result<ServiceEventListenerHandle, ServiceRuntimeError>
where
    D: crate::client::EventDescriptor + 'static,
    D::Event: Send + 'static,
    F: Fn(D::Event, ServiceEventListenerContext) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), ServerError>> + Send + 'static,
{
    if let Some(durable_name) = options.durable_name.as_deref() {
        return Err(ServiceRuntimeError::CallerDurableName {
            durable_name: durable_name.to_string(),
        });
    }

    if options.mode == ServiceEventListenerMode::Ephemeral {
        let mut events = client
            .nats()
            .subscribe(D::SUBJECT.to_string())
            .await
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        client.flush().await?;
        let event_client = Arc::clone(client);
        return Ok(ServiceEventListenerHandle::new(
            tokio::spawn(async move {
                while let Some(message) = events.next().await {
                    let validation = match validate_event_message(
                        &event_client,
                        message.subject.as_ref(),
                        &message.payload,
                        message.headers.as_ref(),
                    )
                    .await
                    {
                        Ok(validation) => validation,
                        Err(error) => {
                            tracing::warn!(
                                subject = %message.subject,
                                error = %error.message(),
                                "Event auth validation failed"
                            );
                            continue;
                        }
                    };
                    let context = service_event_context_from_headers(
                        ServiceEventListenerMode::Ephemeral,
                        None,
                        message.headers.as_ref(),
                        validation.publisher,
                    );
                    let event = serde_json::from_slice::<D::Event>(&message.payload)
                        .map_err(TrellisClientError::from)?;
                    if let Err(source) = handler(event, context.clone()).await {
                        return Err(ServiceRuntimeError::EventHandler { source, context });
                    }
                }
                Ok(())
            }),
            None,
        ));
    }

    let (group, binding) =
        resolve_event_consumer_binding(bindings, D::SUBJECT, options.group.as_deref(), None)?;
    validate_event_listener_concurrency(&group, binding.ordering, options.concurrency, None)?;
    let key = DurableEventListenerKey {
        stream: binding.stream.clone(),
        durable_name: binding.consumer_name.clone(),
    };
    let context = ServiceEventListenerContext {
        mode: ServiceEventListenerMode::Durable,
        group: Some(group),
        id: None,
        time: None,
        traceparent: None,
        headers: HeaderMap::new(),
        publisher: None,
    };
    let handler = Arc::new(handler);
    let handler_id = SERVICE_EVENT_HANDLER_ID.fetch_add(1, Ordering::Relaxed);
    let handler: SharedEventHandler = Arc::new(move |payload, context| {
        let handler = Arc::clone(&handler);
        let event = serde_json::from_slice::<D::Event>(&payload)
            .map_err(TrellisClientError::from)
            .map_err(ServiceRuntimeError::from);
        Box::pin(async move {
            handler(event?, context.clone())
                .await
                .map_err(|source| ServiceRuntimeError::EventHandler { source, context })
        })
    });

    {
        let mut listeners = event_listeners.lock().await;
        if let Some(listener) = listeners.get_mut(&key) {
            validate_event_listener_concurrency(
                context.group.as_deref().expect("durable listener group"),
                binding.ordering,
                options.concurrency,
                Some(listener.concurrency),
            )?;
            listener
                .handlers
                .entry(D::SUBJECT.to_string())
                .or_default()
                .insert(handler_id, handler);
            return Ok(ServiceEventListenerHandle::new(
                tokio::spawn(async { futures_util::future::pending().await }),
                Some(ServiceEventListenerRegistration {
                    event_listeners: Arc::clone(&event_listeners),
                    key,
                    subject: D::SUBJECT.to_string(),
                    handler_id,
                }),
            ));
        }
    }

    let subscribe_options = EventSubscribeOptions {
        stream: Some(binding.stream.clone()),
        mode: EventSubscriptionMode::Durable,
        replay: EventReplayPolicy::New,
        durable_name: Some(binding.consumer_name.clone()),
    };
    let pull_abort_handles = (0..options.concurrency)
        .map(|_| {
            tokio::spawn(run_durable_event_pull_loop::<D>(
                Arc::clone(client),
                Arc::clone(&event_listeners),
                key.clone(),
                subscribe_options.clone(),
                context.clone(),
            ))
            .abort_handle()
        })
        .collect();
    event_listeners.lock().await.insert(
        key.clone(),
        SharedDurableEventListener {
            expected_subjects: binding.filter_subjects.iter().cloned().collect(),
            handlers: BTreeMap::from([(
                D::SUBJECT.to_string(),
                BTreeMap::from([(handler_id, handler)]),
            )]),
            concurrency: options.concurrency,
            pull_abort_handles,
        },
    );

    Ok(ServiceEventListenerHandle::new(
        tokio::spawn(async { futures_util::future::pending().await }),
        Some(ServiceEventListenerRegistration {
            event_listeners,
            key,
            subject: D::SUBJECT.to_string(),
            handler_id,
        }),
    ))
}

fn validate_event_listener_concurrency(
    group: &str,
    ordering: super::EventConsumerOrdering,
    requested: u32,
    existing: Option<u32>,
) -> Result<(), ServiceRuntimeError> {
    if requested == 0 {
        return Err(ServiceRuntimeError::InvalidEventListenerConcurrency {
            group: group.to_string(),
            concurrency: requested,
        });
    }
    if ordering == super::EventConsumerOrdering::Strict && requested > 1 {
        return Err(ServiceRuntimeError::StrictEventListenerConcurrency {
            group: group.to_string(),
        });
    }
    if let Some(existing) = existing.filter(|existing| *existing != requested) {
        return Err(ServiceRuntimeError::EventListenerConcurrencyMismatch {
            group: group.to_string(),
            existing,
            requested,
        });
    }
    Ok(())
}

async fn remove_service_event_listener_registration(
    registration: ServiceEventListenerRegistration,
) {
    let mut listeners = registration.event_listeners.lock().await;
    let Some(listener) = listeners.get_mut(&registration.key) else {
        return;
    };
    if let Some(handlers) = listener.handlers.get_mut(&registration.subject) {
        handlers.remove(&registration.handler_id);
        if handlers.is_empty() {
            listener.handlers.remove(&registration.subject);
        }
    }
    if listener.handlers.values().all(BTreeMap::is_empty) {
        let listener = listeners.remove(&registration.key);
        if let Some(listener) = listener {
            for handle in listener.pull_abort_handles {
                handle.abort();
            }
        }
    }
}

fn spawn_service_event_listener_cleanup(registration: ServiceEventListenerRegistration) {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(remove_service_event_listener_registration(registration));
    }
}

async fn remove_service_event_listeners(event_listeners: SharedDurableEventListeners) {
    let listeners = std::mem::take(&mut *event_listeners.lock().await);
    for (_, listener) in listeners {
        for handle in listener.pull_abort_handles {
            handle.abort();
        }
    }
}

async fn run_durable_event_pull_loop<D>(
    client: Arc<TrellisClient>,
    event_listeners: SharedDurableEventListeners,
    key: DurableEventListenerKey,
    subscribe_options: EventSubscribeOptions,
    context: ServiceEventListenerContext,
) where
    D: crate::client::EventDescriptor + 'static,
    D::Event: Send + 'static,
{
    loop {
        if !durable_listener_ready(&event_listeners, &key).await {
            tokio::time::sleep(Duration::from_millis(25)).await;
            continue;
        }

        let mut messages = match client
            .subscribe_messages::<D>(subscribe_options.clone())
            .await
        {
            Ok(messages) => messages,
            Err(error) if is_missing_durable_event_consumer_error(&error) => {
                tokio::time::sleep(Duration::from_millis(DURABLE_EVENT_CONSUMER_RETRY_MS)).await;
                continue;
            }
            Err(error) => {
                tracing::warn!(
                    group = ?context.group,
                    error = %error,
                    "Durable event subscription failed; retrying"
                );
                tokio::time::sleep(Duration::from_millis(DURABLE_EVENT_CONSUMER_RETRY_MS)).await;
                continue;
            }
        };

        while durable_listener_ready(&event_listeners, &key).await {
            let Some(result) = messages.next().await else {
                break;
            };
            let message = match result {
                Ok(message) => message,
                Err(error) if is_missing_durable_event_consumer_error(&error) => {
                    tokio::time::sleep(Duration::from_millis(DURABLE_EVENT_CONSUMER_RETRY_MS))
                        .await;
                    break;
                }
                Err(error) => {
                    tracing::warn!(
                        group = ?context.group,
                        error = %error,
                        "Durable event pull failed; retrying"
                    );
                    tokio::time::sleep(Duration::from_millis(DURABLE_EVENT_CONSUMER_RETRY_MS))
                        .await;
                    break;
                }
            };
            if !durable_listener_ready(&event_listeners, &key).await {
                break;
            }
            let handlers = event_listeners
                .lock()
                .await
                .get(&key)
                .and_then(|listener| listener.handlers.get(message.subject()).cloned())
                .unwrap_or_default();
            let validation = match validate_event_message(
                &client,
                message.subject(),
                message.payload(),
                message.headers(),
            )
            .await
            {
                Ok(validation) => validation,
                Err(error) => {
                    tracing::warn!(
                        subject = %message.subject(),
                        error = %error.message(),
                        "Event auth validation failed"
                    );
                    match error.disposition() {
                        EventProofValidationDisposition::Nak => {
                            let _ = message.nak().await;
                        }
                        EventProofValidationDisposition::Pending => {
                            // Indeterminate runtime and transport failures intentionally remain
                            // unacknowledged so the consumer AckWait policy controls redelivery.
                        }
                        EventProofValidationDisposition::Term => {
                            let _ = message.term().await;
                        }
                    }
                    continue;
                }
            };
            let mut handled = true;
            for handler in handlers.values() {
                let context = service_event_context_from_message(
                    context.mode,
                    context.group.clone(),
                    &message,
                    validation.publisher.clone(),
                );
                if handler(Bytes::copy_from_slice(message.payload()), context)
                    .await
                    .is_err()
                {
                    let _ = message.nak().await;
                    handled = false;
                    break;
                }
            }
            if !handled {
                continue;
            }
            if !durable_listener_ready(&event_listeners, &key).await {
                break;
            }
            if let Err(error) = message.ack().await {
                tracing::warn!(
                    group = ?context.group,
                    error = %error,
                    "Durable event acknowledgement failed; retrying"
                );
                break;
            }
        }
    }
}

fn spawn_service_event_listeners_cleanup(event_listeners: SharedDurableEventListeners) {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(remove_service_event_listeners(event_listeners));
    }
}

async fn durable_listener_ready(
    event_listeners: &SharedDurableEventListeners,
    key: &DurableEventListenerKey,
) -> bool {
    event_listeners
        .lock()
        .await
        .get(key)
        .map(|listener| {
            listener
                .expected_subjects
                .iter()
                .all(|subject| listener.handlers.contains_key(subject))
        })
        .unwrap_or(false)
}

fn resolve_event_consumer_binding(
    bindings: &BTreeMap<String, super::EventConsumerResourceBinding>,
    subject: &str,
    group: Option<&str>,
    durable_name: Option<&str>,
) -> Result<(String, super::EventConsumerResourceBinding), ServiceRuntimeError> {
    if let Some(durable_name) = durable_name {
        return Err(ServiceRuntimeError::CallerDurableName {
            durable_name: durable_name.to_string(),
        });
    }

    if let Some(group) = group {
        let binding =
            bindings
                .get(group)
                .ok_or_else(|| ServiceRuntimeError::EventConsumerGroupNotFound {
                    group: group.to_string(),
                })?;
        if !binding
            .filter_subjects
            .iter()
            .any(|filter_subject| filter_subject == subject)
        {
            return Err(ServiceRuntimeError::EventConsumerGroupSubjectMismatch {
                group: group.to_string(),
                subject: subject.to_string(),
            });
        }
        return Ok((group.to_string(), binding.clone()));
    }

    let matches = bindings
        .iter()
        .filter(|(_, binding)| {
            binding
                .filter_subjects
                .iter()
                .any(|filter_subject| filter_subject == subject)
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => Err(ServiceRuntimeError::MissingEventConsumerGroup {
            subject: subject.to_string(),
        }),
        [(group, binding)] => Ok(((*group).clone(), (*binding).clone())),
        _ => Err(ServiceRuntimeError::AmbiguousEventConsumerGroup {
            subject: subject.to_string(),
            groups: matches.iter().map(|(group, _)| (*group).clone()).collect(),
        }),
    }
}

fn is_missing_durable_event_consumer_error(error: &TrellisClientError) -> bool {
    let TrellisClientError::NatsRequest(message) = error else {
        return false;
    };

    let message = message.to_ascii_lowercase();
    message.contains("consumer not found")
        || message.contains("consumer does not exist")
        || message.contains("no consumer")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::{
        EventConsumerOrdering, EventConsumerReplay, EventConsumerResourceBinding, OperationFailure,
    };
    use futures_util::future::ready;
    use serde::{Deserialize, Serialize};
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    #[test]
    fn service_connect_waits_indefinitely_for_authority_by_default() {
        let options = ServiceConnectOptions::new("http://localhost:3000", "svc", "seed");

        assert_eq!(options.authority_pending_timeout_ms, None);
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct PingInput {
        value: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct PingOutput {
        echoed: String,
    }

    struct PingRpc;

    impl RpcDescriptor for PingRpc {
        type Input = PingInput;
        type Output = PingOutput;

        const KEY: &'static str = "Ping";
        const SUBJECT: &'static str = "rpc.v1.Ping";
        const INPUT_SCHEMA_JSON: &'static str =
            r#"{"type":"object","properties":{},"required":[]}"#;
        const OUTPUT_SCHEMA_JSON: &'static str =
            r#"{"type":"object","properties":{},"required":[]}"#;
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct FeedInput;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct FeedEvent;

    struct StatusFeed;

    impl FeedDescriptor for StatusFeed {
        type Input = FeedInput;
        type Event = FeedEvent;

        const KEY: &'static str = "Status";
        const SUBJECT: &'static str = "feed.v1.Status";
        const INPUT_SCHEMA_JSON: &'static str =
            r#"{"type":"object","properties":{},"required":[]}"#;
        const EVENT_SCHEMA_JSON: &'static str =
            r#"{"type":"object","properties":{},"required":[]}"#;
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct OperationInput;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct OperationProgress;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct OperationOutput;

    struct TestOperation;

    impl OperationDescriptor for TestOperation {
        type Input = OperationInput;
        type Progress = OperationProgress;
        type Output = OperationOutput;
        type Error = OperationFailure;

        const KEY: &'static str = "Test.Operation";
        const SUBJECT: &'static str = "op.v1.TestOperation";
        const CANCELABLE: bool = true;
        const ERRORS: &'static [&'static str] = &[];
        const INPUT_SCHEMA_JSON: &'static str =
            r#"{"type":"object","properties":{},"required":[]}"#;
        const PROGRESS_SCHEMA_JSON: Option<&'static str> = None;
        const OUTPUT_SCHEMA_JSON: &'static str =
            r#"{"type":"object","properties":{},"required":[]}"#;
        const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = "{}";
    }

    struct TestContract;

    impl GeneratedServiceContract for TestContract {
        const CONTRACT_ID: &'static str = "example.service@v1";
        const CONTRACT_DIGEST: &'static str = "sha256:test";
        const CONTRACT_JSON: &'static str = r#"{"id":"example.service@v1"}"#;
    }

    struct RecordingRunner {
        subjects: Arc<Mutex<Vec<String>>>,
    }

    impl ServiceRuntimeRunner for RecordingRunner {
        type RunFuture = BoxFuture<'static, Result<(), ServerError>>;

        fn run<H>(
            self,
            _client: Option<Arc<TrellisClient>>,
            subjects: Vec<String>,
            _host: H,
        ) -> Self::RunFuture
        where
            H: RequestHandler + Send + Sync + 'static,
        {
            *self.subjects.lock().expect("lock subjects") = subjects;
            Box::pin(ready(Ok(())))
        }
    }

    fn binding() -> CoreBootstrapBinding {
        CoreBootstrapBinding::new(TrellisBindingsGetResponseBinding {
            contract_id: "example.service@v1".to_string(),
            digest: "sha256:test".to_string(),
            resources: crate::sdk::core::types::TrellisBindingsGetResponseBindingResources {
                event_consumers: Some(BTreeMap::from([(
                    "projection".to_string(),
                    crate::sdk::core::types::TrellisBindingsGetResponseBindingResourcesEventConsumersValue {
                        stream: "trellis".to_string(),
                        consumer_name: "svc-projection".to_string(),
                        filter_subjects: vec!["events.v1.Billing.Paid".to_string()],
                        replay: serde_json::from_value(serde_json::json!("new")).unwrap(),
                        ordering: serde_json::from_value(serde_json::json!("strict")).unwrap(),
                        ack_wait_ms: 30_000,
                        max_deliver: 5,
                        backoff_ms: vec![1_000, 5_000],
                    },
                )])),
                jobs: None,
                kv: Some(BTreeMap::from([(
                    "drafts".to_string(),
                    crate::sdk::core::types::TrellisBindingsGetResponseBindingResourcesKvValue {
                        bucket: "svc_drafts".to_string(),
                        history: 3,
                        max_value_bytes: Some(4096),
                        ttl_ms: 60_000,
                    },
                )])),
                store: Some(BTreeMap::from([(
                    "evidence".to_string(),
                    crate::sdk::core::types::TrellisBindingsGetResponseBindingResourcesStoreValue {
                        name: "svc_evidence".to_string(),
                        max_object_bytes: Some(8192),
                        max_total_bytes: None,
                        ttl_ms: 0,
                    },
                )])),
            },
        })
    }

    fn event_consumer_binding(subjects: &[&str]) -> EventConsumerResourceBinding {
        EventConsumerResourceBinding {
            stream: "trellis".to_string(),
            consumer_name: "consumer".to_string(),
            filter_subjects: subjects
                .iter()
                .map(|subject| (*subject).to_string())
                .collect(),
            replay: EventConsumerReplay::New,
            ordering: EventConsumerOrdering::Strict,
            ack_wait_ms: 30_000,
            max_deliver: 5,
            backoff_ms: vec![1_000, 5_000],
        }
    }

    #[test]
    fn resolve_event_consumer_binding_infers_unique_group() {
        let bindings = BTreeMap::from([(
            "projection".to_string(),
            event_consumer_binding(&["events.v1.Billing.Paid"]),
        )]);

        let (group, binding) =
            resolve_event_consumer_binding(&bindings, "events.v1.Billing.Paid", None, None)
                .expect("binding resolves");

        assert_eq!(group, "projection");
        assert_eq!(binding.consumer_name, "consumer");
    }

    #[test]
    fn durable_event_listener_concurrency_defaults_to_one() {
        assert_eq!(ServiceEventListenOptions::default().concurrency, 1);
    }

    #[test]
    fn core_bootstrap_maps_parallel_event_consumer_ordering() {
        let mut core = binding().into_inner();
        core.resources
            .event_consumers
            .as_mut()
            .expect("event consumer bindings")
            .get_mut("projection")
            .expect("projection event consumer binding")
            .ordering = serde_json::from_value(serde_json::json!("parallel")).unwrap();

        let resources = CoreBootstrapBinding::new(core).resource_bindings();
        assert_eq!(
            resources.event_consumers["projection"].ordering,
            EventConsumerOrdering::Parallel
        );
    }

    #[test]
    fn durable_event_listener_concurrency_enforces_ordering_and_group_agreement() {
        assert!(validate_event_listener_concurrency(
            "projection",
            EventConsumerOrdering::Parallel,
            4,
            Some(4)
        )
        .is_ok());
        assert!(matches!(
            validate_event_listener_concurrency(
                "projection",
                EventConsumerOrdering::Strict,
                2,
                None
            ),
            Err(ServiceRuntimeError::StrictEventListenerConcurrency { group })
                if group == "projection"
        ));
        assert!(matches!(
            validate_event_listener_concurrency(
                "projection",
                EventConsumerOrdering::Parallel,
                2,
                Some(4)
            ),
            Err(ServiceRuntimeError::EventListenerConcurrencyMismatch {
                group,
                existing: 4,
                requested: 2
            }) if group == "projection"
        ));
        assert!(matches!(
            validate_event_listener_concurrency(
                "projection",
                EventConsumerOrdering::Parallel,
                0,
                None
            ),
            Err(ServiceRuntimeError::InvalidEventListenerConcurrency {
                group,
                concurrency: 0
            }) if group == "projection"
        ));
    }

    #[test]
    fn resolve_event_consumer_binding_rejects_invalid_group_selection() {
        let bindings = BTreeMap::from([(
            "projection".to_string(),
            event_consumer_binding(&["events.v1.Billing.Paid"]),
        )]);

        assert!(matches!(
            resolve_event_consumer_binding(
                &bindings,
                "events.v1.Billing.Paid",
                None,
                Some("caller-owned"),
            ),
            Err(ServiceRuntimeError::CallerDurableName { durable_name })
                if durable_name == "caller-owned"
        ));
        assert!(matches!(
            resolve_event_consumer_binding(&bindings, "events.v1.Missing", None, None),
            Err(ServiceRuntimeError::MissingEventConsumerGroup { subject })
                if subject == "events.v1.Missing"
        ));
        assert!(matches!(
            resolve_event_consumer_binding(
                &bindings,
                "events.v1.Billing.Paid",
                Some("missing"),
                None,
            ),
            Err(ServiceRuntimeError::EventConsumerGroupNotFound { group })
                if group == "missing"
        ));
        assert!(matches!(
            resolve_event_consumer_binding(
                &bindings,
                "events.v1.Other",
                Some("projection"),
                None,
            ),
            Err(ServiceRuntimeError::EventConsumerGroupSubjectMismatch { group, subject })
                if group == "projection" && subject == "events.v1.Other"
        ));
    }

    #[test]
    fn resolve_event_consumer_binding_requires_group_for_ambiguous_match() {
        let bindings = BTreeMap::from([
            (
                "first".to_string(),
                event_consumer_binding(&["events.v1.Billing.Paid"]),
            ),
            (
                "second".to_string(),
                event_consumer_binding(&["events.v1.Billing.Paid"]),
            ),
        ]);

        assert!(matches!(
            resolve_event_consumer_binding(
                &bindings,
                "events.v1.Billing.Paid",
                None,
                None,
            ),
            Err(ServiceRuntimeError::AmbiguousEventConsumerGroup { subject, groups })
                if subject == "events.v1.Billing.Paid"
                    && groups == vec!["first".to_string(), "second".to_string()]
        ));
    }

    #[test]
    fn is_missing_durable_event_consumer_error_matches_only_missing_consumer_requests() {
        assert!(is_missing_durable_event_consumer_error(
            &TrellisClientError::NatsRequest("consumer not found".to_string())
        ));
        assert!(is_missing_durable_event_consumer_error(
            &TrellisClientError::NatsRequest("Consumer does not exist".to_string())
        ));
        assert!(is_missing_durable_event_consumer_error(
            &TrellisClientError::NatsRequest("no consumer available".to_string())
        ));
        assert!(!is_missing_durable_event_consumer_error(
            &TrellisClientError::NatsRequest("permissions violation".to_string())
        ));
        assert!(!is_missing_durable_event_consumer_error(
            &TrellisClientError::Timeout
        ));
    }

    #[test]
    fn registration_records_subjects() {
        let mut runtime =
            ConnectedServiceRuntime::<TestContract>::from_test_binding("test-service", binding());

        runtime.register_rpc::<PingRpc, _, _>(|_ctx, input| async move {
            Ok(PingOutput {
                echoed: input.value,
            })
        });
        runtime.register_feed::<StatusFeed, _, _>(|_ctx, _input| futures_util::stream::empty());

        assert_eq!(
            runtime.registered_subjects(),
            vec!["feed.v1.Status", "rpc.v1.Ping"]
        );
    }

    #[test]
    fn watch_operation_registration_records_data_and_control_subjects() {
        let mut runtime =
            ConnectedServiceRuntime::<TestContract>::from_test_binding("test-service", binding());

        runtime.register_operation_with_watch::<TestOperation, _, _, _, _, _, _, _>(
            |_ctx, _input| async move {
                Ok(AcceptedOperation {
                    kind: "accepted".to_string(),
                    operation_ref: crate::service::OperationRefData {
                        id: "op_123".to_string(),
                        service: "test-service".to_string(),
                        operation: "Test.Operation".to_string(),
                    },
                    snapshot: OperationSnapshot::<OperationProgress, OperationOutput> {
                        revision: 1,
                        state: crate::service::OperationState::Pending,
                        ..Default::default()
                    },
                    transfer: None,
                })
            },
            |_ctx, _operation_id| async move {
                Ok(OperationSnapshot::<OperationProgress, OperationOutput> {
                    revision: 1,
                    state: crate::service::OperationState::Pending,
                    ..Default::default()
                })
            },
            |_ctx, _operation_id| Box::pin(futures_util::stream::empty()),
            |_ctx, _operation_id| async move {
                Ok(OperationSnapshot::<OperationProgress, OperationOutput> {
                    revision: 2,
                    state: crate::service::OperationState::Cancelled,
                    ..Default::default()
                })
            },
        );

        assert_eq!(
            runtime.registered_subjects(),
            vec!["op.v1.TestOperation", "op.v1.TestOperation.control"]
        );
    }

    #[test]
    fn resource_binding_accessors_return_typed_resources() {
        let runtime =
            ConnectedServiceRuntime::<TestContract>::from_test_binding("test-service", binding());

        assert_eq!(runtime.resources().kv.len(), 1);
        assert_eq!(
            runtime.resources().event_consumers["projection"].consumer_name,
            "svc-projection"
        );
        assert_eq!(
            runtime.kv_binding("drafts").expect("kv binding").bucket,
            "svc_drafts"
        );
        assert_eq!(
            runtime
                .store_binding("evidence")
                .expect("store binding")
                .name,
            "svc_evidence"
        );
        assert!(matches!(
            runtime.kv_binding("missing"),
            Err(ServerError::MissingResourceBinding { resource_kind, resource_name, .. })
                if resource_kind == "kv" && resource_name == "missing"
        ));

        let handle = runtime.generated_handle();
        assert_eq!(handle.resources().store.len(), 1);
        assert_eq!(
            handle
                .store_binding("evidence")
                .expect("handle store binding")
                .name,
            "svc_evidence"
        );
    }

    #[tokio::test]
    async fn run_passes_registered_subjects_to_runner() {
        let mut runtime =
            ConnectedServiceRuntime::<TestContract>::from_test_binding("test-service", binding());
        runtime.register_rpc::<PingRpc, _, _>(|_ctx, input| async move {
            Ok(PingOutput {
                echoed: input.value,
            })
        });

        let subjects = Arc::new(Mutex::new(Vec::new()));
        runtime
            .run_with_runner(RecordingRunner {
                subjects: Arc::clone(&subjects),
            })
            .await
            .expect("runtime runs with injected runner");

        assert_eq!(
            *subjects.lock().expect("lock subjects"),
            vec!["rpc.v1.Ping".to_string()]
        );
    }

    #[test]
    fn injected_client_and_binding_path_builds_runtime() {
        let runtime =
            ConnectedServiceRuntime::<TestContract>::from_test_binding("test-service", binding());

        assert_eq!(runtime.service_name(), "test-service");
        assert_eq!(runtime.binding().contract_id, "example.service@v1");
        assert_eq!(
            runtime.kv_binding("drafts").expect("kv binding").bucket,
            "svc_drafts"
        );
    }
}
