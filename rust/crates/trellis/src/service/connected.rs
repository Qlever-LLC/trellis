use std::future::Future;

use super::resources::{
    validate_kv_binding, validate_store_binding, KvResourceHandle, ResourceRuntimeClient,
    StoreResourceHandle,
};
use super::{
    bootstrap_service_host, resolve_bootstrap_binding, run_single_subject_service,
    AuthenticatedRouter, BootstrapBinding, BootstrapBindingInfo, BootstrapContractRef,
    CoreBootstrapPort, JobsResourceBinding, KvResourceBinding, RequestValidator, Router,
    ServerError, ServiceHost, ServiceResourceBindings, StoreResourceBinding,
};

/// Generic service host returned after auth-aware bootstrap.
pub type ConnectedServiceHostWithValidator<V> = ServiceHost<AuthenticatedRouter<V>>;

/// Connector seam for async service client setup.
pub trait AsyncConnector {
    type Output;
    type Error;
    type ConnectFuture: Future<Output = Result<Self::Output, Self::Error>>;

    fn connect(self) -> Self::ConnectFuture;
}

impl<T, E, F, Fut> AsyncConnector for F
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    type Output = T;
    type Error = E;
    type ConnectFuture = Fut;

    fn connect(self) -> Self::ConnectFuture {
        self()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConnectServiceError<E> {
    #[error(transparent)]
    Connect(E),
    #[error(transparent)]
    Server(ServerError),
}

/// Runtime and bootstrap parts required by `ConnectedService`.
pub struct ConnectedServiceParts<C, V, Rc> {
    pub runtime_client: Rc,
    pub core_port: C,
    pub validator: V,
}

/// Runner seam for testing service startup without a live NATS server.
pub trait SingleSubjectServiceRunner<Rc, H> {
    type RunFuture: Future<Output = Result<(), ServerError>>;

    fn run(self, runtime_client: Rc, subject: String, host: H) -> Self::RunFuture;
}

impl<Rc, H, F, Fut> SingleSubjectServiceRunner<Rc, H> for F
where
    F: FnOnce(Rc, String, H) -> Fut,
    Fut: Future<Output = Result<(), ServerError>>,
{
    type RunFuture = Fut;

    fn run(self, runtime_client: Rc, subject: String, host: H) -> Self::RunFuture {
        self(runtime_client, subject, host)
    }
}

/// Authenticated service bootstrap inputs shared by higher-level service facades.
///
/// `trellis-service` intentionally keeps the concrete Trellis HTTP/NATS client
/// outside this crate. Callers pass these options into their connector, then the
/// generic service path validates the resolved binding against `contract_id` and
/// `contract_digest`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthenticatedServiceConnectOptions<'a> {
    pub service_name: &'a str,
    pub trellis_url: &'a str,
    pub contract_id: &'a str,
    pub contract_digest: &'a str,
    pub service_instance_seed_base64url: &'a str,
    pub timeout_ms: u64,
}

impl AuthenticatedServiceConnectOptions<'_> {
    /// Return the contract reference that must be active for this service session.
    pub fn expected_contract(&self) -> BootstrapContractRef {
        BootstrapContractRef {
            id: self.contract_id.to_string(),
            digest: self.contract_digest.to_string(),
        }
    }
}

/// Connected service wrapper for TS-like `connectService` ergonomics.
pub struct ConnectedService<'meta, B, V, Rc> {
    service_name: &'meta str,
    binding: B,
    bootstrap_binding: BootstrapBinding,
    resources: ServiceResourceBindings,
    runtime_client: Rc,
    validator: V,
}

impl<'meta, B, V, Rc> ConnectedService<'meta, B, V, Rc>
where
    B: BootstrapBindingInfo,
{
    /// Build a connected service from an already resolved bootstrap binding.
    pub fn new(service_name: &'meta str, binding: B, runtime_client: Rc, validator: V) -> Self {
        let bootstrap_binding = binding.bootstrap_binding();
        let resources = binding.resource_bindings();
        Self {
            service_name,
            binding,
            bootstrap_binding,
            resources,
            runtime_client,
            validator,
        }
    }

    /// Return the service instance name used during bootstrap.
    pub fn service_name(&self) -> &str {
        self.service_name
    }

    /// Return the original bootstrap binding object.
    pub fn binding(&self) -> &B {
        &self.binding
    }

    /// Return the validated contract id and digest for this service session.
    pub fn bootstrap_binding(&self) -> &BootstrapBinding {
        &self.bootstrap_binding
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
                service_name: self.service_name.to_string(),
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
                service_name: self.service_name.to_string(),
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
                service_name: self.service_name.to_string(),
                resource_kind: "jobs".to_string(),
                resource_name: "jobs".to_string(),
            })
    }

    /// Return the runtime client passed to the connected service.
    pub fn runtime_client(&self) -> &Rc {
        &self.runtime_client
    }

    /// Open a high-level KV resource handle by contract-local resource name.
    pub async fn kv(&self, name: &str) -> Result<KvResourceHandle<Rc::Kv>, ServerError>
    where
        Rc: ResourceRuntimeClient,
    {
        let binding = self.kv_binding(name)?;
        validate_kv_binding(self.service_name, name, binding)?;
        let client = self.runtime_client.open_kv(binding).await?;
        Ok(KvResourceHandle::new(name, binding.clone(), client))
    }

    /// Open a high-level object-store resource handle by contract-local resource name.
    pub async fn store(&self, name: &str) -> Result<StoreResourceHandle<Rc::Store>, ServerError>
    where
        Rc: ResourceRuntimeClient,
    {
        let binding = self.store_binding(name)?;
        validate_store_binding(self.service_name, name, binding)?;
        let client = self.runtime_client.open_store(binding).await?;
        Ok(StoreResourceHandle::new(
            self.service_name,
            name,
            binding.clone(),
            client,
        ))
    }
}

/// Connect using an injected connector, eagerly resolve bindings, then build a `ConnectedService`.
pub async fn connect_service<'meta, 'expected, Conn, BuildParts, C, V, Rc>(
    service_name: &'meta str,
    expected_contract: &'expected BootstrapContractRef,
    connector: Conn,
    build_parts: BuildParts,
) -> Result<ConnectedService<'meta, C::Binding, V, Rc>, ConnectServiceError<Conn::Error>>
where
    Conn: AsyncConnector,
    BuildParts: FnOnce(Conn::Output) -> ConnectedServiceParts<C, V, Rc>,
    C: CoreBootstrapPort,
    V: RequestValidator,
{
    let connected = connector
        .connect()
        .await
        .map_err(ConnectServiceError::Connect)?;
    let ConnectedServiceParts {
        runtime_client,
        core_port,
        validator,
    } = build_parts(connected);
    let binding = resolve_bootstrap_binding(service_name, expected_contract, &core_port)
        .await
        .map_err(ConnectServiceError::Server)?;
    Ok(ConnectedService::new(
        service_name,
        binding,
        runtime_client,
        validator,
    ))
}

/// Connect an authenticated service using public bootstrap options and an injected connector.
pub async fn connect_service_with_options<'meta, MakeConnector, Conn, BuildParts, C, V, Rc>(
    options: AuthenticatedServiceConnectOptions<'meta>,
    make_connector: MakeConnector,
    build_parts: BuildParts,
) -> Result<ConnectedService<'meta, C::Binding, V, Rc>, ConnectServiceError<Conn::Error>>
where
    MakeConnector: FnOnce(&AuthenticatedServiceConnectOptions<'meta>) -> Conn,
    Conn: AsyncConnector,
    BuildParts: FnOnce(Conn::Output) -> ConnectedServiceParts<C, V, Rc>,
    C: CoreBootstrapPort,
    V: RequestValidator,
{
    let expected_contract = options.expected_contract();
    connect_service(
        options.service_name,
        &expected_contract,
        make_connector(&options),
        build_parts,
    )
    .await
}

impl<'meta, B, V, Rc> ConnectedService<'meta, B, V, Rc>
where
    B: BootstrapBindingInfo,
    V: RequestValidator,
{
    /// Bootstrap a service host using the eagerly resolved binding.
    pub fn bootstrap(
        self,
        router: Router,
    ) -> Result<ConnectedServiceHostWithValidator<V>, ServerError> {
        Ok(bootstrap_service_host(
            self.service_name,
            self.bootstrap_binding,
            router,
            self.validator,
        ))
    }

    /// Bootstrap then run with an injected runner seam.
    pub async fn run_with_runner<R>(
        self,
        subject: &str,
        router: Router,
        run: R,
    ) -> Result<(), ServerError>
    where
        R: SingleSubjectServiceRunner<Rc, ConnectedServiceHostWithValidator<V>>,
    {
        let host = bootstrap_service_host(
            self.service_name,
            self.bootstrap_binding,
            router,
            self.validator,
        );

        run.run(self.runtime_client, subject.to_string(), host)
            .await
    }
}

impl<'meta, B, V> ConnectedService<'meta, B, V, async_nats::Client>
where
    B: BootstrapBindingInfo,
    V: RequestValidator,
{
    /// Bootstrap then run against the default single-subject request loop.
    pub async fn run(self, subject: &str, router: Router) -> Result<(), ServerError> {
        self.run_with_runner(
            subject,
            router,
            |runtime_client, run_subject: String, host| async move {
                run_single_subject_service(runtime_client, &run_subject, host).await
            },
        )
        .await
    }
}
