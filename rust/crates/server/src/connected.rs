use std::future::Future;

use crate::{
    bootstrap_service_host, resolve_bootstrap_binding, run_single_subject_service,
    AuthenticatedRouter, BootstrapBinding, BootstrapBindingInfo, BootstrapContractRef,
    CoreBootstrapPort, RequestValidator, Router, ServerError, ServiceHost,
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

/// Connected service wrapper for TS-like `connectService` ergonomics.
pub struct ConnectedService<'meta, B, V, Rc> {
    service_name: &'meta str,
    binding: B,
    bootstrap_binding: BootstrapBinding,
    runtime_client: Rc,
    validator: V,
}

impl<'meta, B, V, Rc> ConnectedService<'meta, B, V, Rc>
where
    B: BootstrapBindingInfo,
{
    pub fn new(
        service_name: &'meta str,
        binding: B,
        bootstrap_binding: BootstrapBinding,
        runtime_client: Rc,
        validator: V,
    ) -> Self {
        Self {
            service_name,
            binding,
            bootstrap_binding,
            runtime_client,
            validator,
        }
    }

    pub fn service_name(&self) -> &str {
        self.service_name
    }

    pub fn binding(&self) -> &B {
        &self.binding
    }

    pub fn bootstrap_binding(&self) -> &BootstrapBinding {
        &self.bootstrap_binding
    }

    pub fn runtime_client(&self) -> &Rc {
        &self.runtime_client
    }
}

/// Connect using an injected connector, eagerly resolve bindings, then build a `ConnectedService`.
pub async fn connect_service<'meta, Conn, BuildParts, C, V, Rc>(
    service_name: &'meta str,
    expected_contract: &'meta BootstrapContractRef,
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
    let bootstrap_binding = binding.bootstrap_binding();

    Ok(ConnectedService::new(
        service_name,
        binding,
        bootstrap_binding,
        runtime_client,
        validator,
    ))
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
