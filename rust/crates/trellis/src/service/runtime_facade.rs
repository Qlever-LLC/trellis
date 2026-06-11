//! High-level Trellis service runtime facade for generated Rust services.

use std::collections::BTreeSet;
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use bytes::Bytes;
use futures_util::future::BoxFuture;
use futures_util::Stream;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub use super::core_bootstrap::CoreBootstrapBinding;
use super::request_loop::RequestHandler;
use super::runtime::run_multi_subject_service;
use super::transfer::{
    spawn_download_transfer_endpoint, spawn_upload_transfer_endpoint_with_completion,
    spawn_upload_transfer_endpoint_with_progress,
};
use super::{
    bootstrap_service_host, control_subject, AcceptedOperation, BootstrapBindingInfo,
    DownloadTransferGrantPlan, EventPublisher, FeedDescriptor, HandlerResult, JobsResourceBinding,
    KvResourceBinding, NatsKvResourceClient, NatsStoreResourceClient, OperationDescriptor,
    OperationProvider, OperationSignalAccepted, OperationSnapshot, OperationTransferProgress,
    RequestContext, RequestValidation, RequestValidator, ResourceRuntimeClient, Router,
    RpcDescriptor, ServerError, ServiceResourceBindings, StoreResourceBinding, StoreResourceClient,
    UploadTransferCompletion, UploadTransferSession,
};
use crate::client::{ServiceConnectWithContractOptions, TrellisClient, TrellisClientError};
use crate::sdk::auth::types::{AuthRequestsValidateRequest, AuthRequestsValidateResponse};
use crate::sdk::auth::AuthClient;
use crate::sdk::core::types::TrellisBindingsGetResponseBinding;

const AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS: usize = 3;
const AUTH_VALIDATE_SESSION_RETRY_MS: u64 = 25;

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
                Ok(RequestValidation::allowed_caller(response.caller))
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
        match AuthClient::new(client.as_ref())
            .rpc()
            .auth()
            .requests_validate(request)
            .await
        {
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

/// Default request/connect timeout for service bootstrap and NATS RPC calls.
pub const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// Default retry delay while service deployment authority is pending.
pub const DEFAULT_RETRY_DELAY_MS: u64 = 1_000;

/// Default maximum time to wait for service deployment authority to become ready.
pub const DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS: u64 = 60_000;

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
    pub trellis_url: &'a str,
    /// Service instance name reported to the runtime.
    pub name: &'a str,
    /// Base64url-encoded service session seed.
    pub session_key_seed_base64url: &'a str,
    /// Request/connect timeout in milliseconds.
    pub timeout_ms: u64,
    /// Retry delay in milliseconds while bootstrap is pending authority readiness.
    pub retry_delay_ms: u64,
    /// Maximum authority-pending wait time in milliseconds.
    pub authority_pending_timeout_ms: u64,
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

    /// The service bootstrap response did not include a resource binding.
    #[error("service bootstrap response did not include a binding")]
    MissingBootstrapBinding,

    /// The service bootstrap binding could not be parsed as a core binding.
    #[error("invalid service bootstrap binding: {0}")]
    InvalidBootstrapBinding(#[source] serde_json::Error),

    /// The runtime was built without a client and cannot use the default runner.
    #[error("service runtime is missing a Trellis client")]
    MissingClient,
}

/// Cloneable handle exposed to registered service handlers.
#[derive(Clone)]
pub struct ServiceHandle {
    client: Option<Arc<TrellisClient>>,
    service_name: Arc<str>,
    binding: CoreBootstrapBinding,
    resources: ServiceResourceBindings,
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
    /// Return the raw Trellis client for advanced outbound calls.
    pub fn client(&self) -> &Arc<TrellisClient> {
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

    /// Return an event publisher backed by the connected NATS client.
    pub fn event_publisher(&self) -> EventPublisher {
        EventPublisher::new(self.client().nats().clone())
    }

    /// Open a NATS-backed KV resource client by contract-local resource name.
    pub async fn kv_client(&self, name: &str) -> Result<NatsKvResourceClient, ServerError> {
        let binding = self.kv_binding(name)?;
        self.client().nats().open_kv(binding).await
    }

    /// Open a NATS-backed object-store resource client by contract-local resource name.
    pub async fn store_client(&self, name: &str) -> Result<NatsStoreResourceClient, ServerError> {
        let binding = self.store_binding(name)?;
        self.client().nats().open_store(binding).await
    }

    /// Subscribe and run an upload transfer endpoint backed by the connected NATS client.
    pub async fn spawn_upload_transfer_endpoint_with_progress<C, V, F>(
        &self,
        session: UploadTransferSession,
        store: C,
        validator: V,
        on_progress: F,
    ) -> Result<(), ServerError>
    where
        C: StoreResourceClient,
        V: RequestValidator + 'static,
        F: Fn(OperationTransferProgress) + Send + Sync + 'static,
    {
        spawn_upload_transfer_endpoint_with_progress(
            self.client().nats().clone(),
            session,
            store,
            validator,
            on_progress,
        )
        .await
    }

    /// Subscribe and run an upload transfer endpoint that can be awaited until durable storage.
    pub async fn spawn_upload_transfer_endpoint_with_completion<C, V>(
        &self,
        session: UploadTransferSession,
        store: C,
        validator: V,
    ) -> Result<UploadTransferCompletion, ServerError>
    where
        C: StoreResourceClient,
        V: RequestValidator + 'static,
    {
        spawn_upload_transfer_endpoint_with_completion(
            self.client().nats().clone(),
            session,
            store,
            validator,
        )
        .await
    }

    /// Subscribe and run a download transfer endpoint backed by the connected NATS client.
    pub async fn spawn_download_transfer_endpoint<C, V>(
        &self,
        plan: DownloadTransferGrantPlan,
        store: C,
        validator: V,
    ) -> Result<(), ServerError>
    where
        C: StoreResourceClient,
        V: RequestValidator + 'static,
    {
        spawn_download_transfer_endpoint(self.client().nats().clone(), plan, store, validator).await
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

    /// Consume this context into the low-level request metadata.
    pub fn into_request_context(self) -> RequestContext {
        self.request
    }
}

/// Connected high-level service runtime for one generated service contract.
pub struct ConnectedServiceRuntime<C> {
    client: Option<Arc<TrellisClient>>,
    binding: CoreBootstrapBinding,
    resources: ServiceResourceBindings,
    router: Router,
    service_name: String,
    registered_subjects: BTreeSet<String>,
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
    pub fn from_parts(
        service_name: impl Into<String>,
        client: Arc<TrellisClient>,
        binding: CoreBootstrapBinding,
    ) -> Self {
        let resources = binding.resource_bindings();
        Self {
            client: Some(client),
            binding,
            resources,
            router: Router::new(),
            service_name: service_name.into(),
            registered_subjects: BTreeSet::new(),
            _contract: PhantomData,
        }
    }

    /// Build a connected runtime from a service client that already completed bootstrap.
    pub fn from_connected_client(
        service_name: impl Into<String>,
        client: Arc<TrellisClient>,
    ) -> Result<Self, ServiceRuntimeError> {
        let binding = parse_bootstrap_binding(client.as_ref())?;
        Ok(Self::from_parts(service_name, client, binding))
    }

    /// Return the raw Trellis client owned by this runtime.
    pub fn client(&self) -> &Arc<TrellisClient> {
        self.client
            .as_ref()
            .expect("connected service runtimes always include a Trellis client")
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

    /// Return an event publisher backed by the connected NATS client.
    pub fn event_publisher(&self) -> EventPublisher {
        EventPublisher::new(self.client().nats().clone())
    }

    /// Open a NATS-backed KV resource client by contract-local resource name.
    pub async fn kv_client(&self, name: &str) -> Result<NatsKvResourceClient, ServerError> {
        let binding = self.kv_binding(name)?;
        self.client().nats().open_kv(binding).await
    }

    /// Open a NATS-backed object-store resource client by contract-local resource name.
    pub async fn store_client(&self, name: &str) -> Result<NatsStoreResourceClient, ServerError> {
        let binding = self.store_binding(name)?;
        self.client().nats().open_store(binding).await
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
        let handle = self.handle();
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
        let handle = self.handle();
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
                handle: self.handle(),
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
        let start_handle = self.handle();
        let get_handle = self.handle();
        let watch_handle = self.handle();
        let cancel_handle = self.handle();
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
        let start_handle = self.handle();
        let get_handle = self.handle();
        let wait_handle = self.handle();
        let cancel_handle = self.handle();
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
        let start_handle = self.handle();
        let get_handle = self.handle();
        let watch_handle = self.handle();
        let cancel_handle = self.handle();
        let signal_handle = self.handle();
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

    /// Run registered subjects using the default NATS request loop.
    pub async fn run(self) -> Result<(), ServiceRuntimeError> {
        self.run_with_runner(DefaultServiceRunner).await
    }

    /// Run registered subjects using an injected runner seam.
    pub async fn run_with_runner<R>(self, runner: R) -> Result<(), ServiceRuntimeError>
    where
        R: ServiceRuntimeRunner,
    {
        let subjects = self.registered_subjects.into_iter().collect::<Vec<_>>();
        if let Some(client) = self.client {
            let host = bootstrap_service_host(
                &self.service_name,
                self.binding.bootstrap_binding(),
                self.router,
                LocalAuthRequestValidatorAdapter::new(Arc::clone(&client)),
            );
            return runner
                .run(Some(client), subjects, host)
                .await
                .map_err(ServiceRuntimeError::Server);
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

    fn handle(&self) -> ServiceHandle {
        ServiceHandle {
            client: self.client.as_ref().map(Arc::clone),
            service_name: Arc::from(self.service_name.as_str()),
            binding: self.binding.clone(),
            resources: self.resources.clone(),
        }
    }

    #[cfg(test)]
    fn from_test_binding(service_name: impl Into<String>, binding: CoreBootstrapBinding) -> Self {
        let resources = binding.resource_bindings();
        Self {
            client: None,
            binding,
            resources,
            router: Router::new(),
            service_name: service_name.into(),
            registered_subjects: BTreeSet::new(),
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
pub trait ServiceRuntimeRunner {
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
pub struct DefaultServiceRunner;

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

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::future::ready;
    use serde::{Deserialize, Serialize};
    use std::collections::BTreeMap;
    use std::sync::Mutex;

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

        const KEY: &'static str = "Test.Operation";
        const SUBJECT: &'static str = "op.v1.TestOperation";
        const CANCELABLE: bool = true;
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
                        replay: "new".to_string(),
                        ordering: "strict".to_string(),
                        concurrency: 1,
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

        let handle = runtime.handle();
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
