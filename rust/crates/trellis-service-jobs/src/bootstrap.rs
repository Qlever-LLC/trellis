//! Service bootstrap helpers for the Jobs admin service.

use trellis_auth_adapters::{AuthRequestValidatorAdapter, AuthRequestValidatorClientPort};
use trellis_client::{ServiceConnectOptions, TrellisClient, TrellisClientError};
use trellis_core_bootstrap::{CoreBootstrapAdapter, CoreBootstrapBinding, CoreBootstrapClientPort};
use trellis_sdk_auth::AuthClient;
use trellis_sdk_core::CoreClient;
use trellis_server::{
    bootstrap_service_host, connect_service as connect_bound_service, resolve_bootstrap_binding,
    run_single_subject_service, BootstrapBindingInfo, ConnectServiceError, ConnectedService,
    ConnectedServiceHostWithValidator, ConnectedServiceParts, Router, ServerError,
};

use crate::advisory::{start_advisory_loop, AdvisoryHandle};
use crate::contract::{expected_contract, JOBS_RPC_SUBJECT_WILDCARD, SERVICE_NAME};
use crate::janitor::{start_janitor_loop, JanitorHandle};
use crate::kv_query::{
    jobs_admin_resources_from_binding, JobsAdminResources, JobsKvQuery, JobsQueryError,
};
use crate::projector::{start_jobs_projector, JobsProjectorHandle};
use crate::router::build_router_with_query;
use crate::worker_presence::{start_worker_presence_projector, WorkerPresenceProjectorHandle};

/// Controls whether this process owns background jobs-service loops or only RPC serving.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobsServiceMode {
    /// Serve RPCs only.
    RpcOnly,
    /// Serve RPCs and own projector, janitor, and advisory loops.
    Owner,
}

struct RuntimeLoops {
    advisory: AdvisoryHandle,
    janitor: JanitorHandle,
    projector: JobsProjectorHandle,
    worker_presence: WorkerPresenceProjectorHandle,
}

impl JobsServiceMode {
    fn starts_runtime_loops(self) -> bool {
        matches!(self, Self::Owner)
    }
}

impl RuntimeLoops {
    async fn start(
        nats: async_nats::Client,
        resources: &JobsAdminResources,
    ) -> Result<Self, ServerError> {
        let advisory = start_advisory_loop(
            nats.clone(),
            resources.jobs_state_bucket.clone(),
            resources.jobs_advisories_stream.clone(),
        )
        .await?;
        let janitor = start_janitor_loop(
            nats.clone(),
            resources.jobs_state_bucket.clone(),
            std::time::Duration::from_secs(30),
        )
        .await?;
        let projector = start_jobs_projector(
            nats.clone(),
            resources.jobs_state_bucket.clone(),
            resources.jobs_stream.clone(),
        )
        .await?;
        let worker_presence = start_worker_presence_projector(
            nats.clone(),
            resources.jobs_stream.clone(),
            resources.worker_presence_bucket.clone(),
            resources.worker_presence_replicas,
        )
        .await?;
        Ok(Self {
            advisory,
            janitor,
            projector,
            worker_presence,
        })
    }

    async fn stop(self) {
        let ((), (), ()) = tokio::join!(
            self.projector.stop(),
            self.janitor.stop(),
            self.advisory.stop(),
        );
        self.worker_presence.stop().await;
    }

    async fn wait_for_failure(&mut self) -> Result<(), ServerError> {
        tokio::select! {
            result = self.projector.wait() => map_runtime_loop_result("projector", result),
            result = self.worker_presence.wait() => map_runtime_loop_result("worker presence", result),
            result = self.janitor.wait() => map_runtime_loop_result("janitor", result),
            result = self.advisory.wait() => map_runtime_loop_result("advisory", result),
        }
    }
}

fn map_runtime_loop_result(
    loop_name: &str,
    result: Result<(), ServerError>,
) -> Result<(), ServerError> {
    match result {
        Ok(()) => Err(ServerError::Nats(format!(
            "jobs service {loop_name} loop exited unexpectedly"
        ))),
        Err(error) => Err(error),
    }
}

pub type JobsServiceHost<'a> =
    ConnectedServiceHostWithValidator<AuthRequestValidatorAdapter<AuthClient<'a>>>;
pub type JobsServiceHostWithValidator<Avc> =
    ConnectedServiceHostWithValidator<AuthRequestValidatorAdapter<Avc>>;

/// Connected jobs service wrapper that mirrors TS `connectService` ergonomics.
pub struct ConnectedJobsService {
    client: TrellisClient,
    binding: CoreBootstrapBinding,
}

impl ConnectedJobsService {
    /// Construct a connected Jobs service wrapper from a Trellis client and binding.
    pub fn new(client: TrellisClient, binding: CoreBootstrapBinding) -> Self {
        Self { client, binding }
    }

    /// Return the resolved bindings snapshot for this service.
    pub fn binding(&self) -> &trellis_sdk_core::types::TrellisBindingsGetResponseBinding {
        self.binding.as_ref()
    }

    /// Bootstrap an authenticated service host without starting background loops.
    pub async fn bootstrap(&self) -> Result<JobsServiceHost<'_>, ServerError> {
        let (_, router) = build_jobs_runtime(self.client.nats().clone(), self.binding())?;
        Ok(bootstrap_service_host(
            SERVICE_NAME,
            self.binding.bootstrap_binding(),
            router,
            AuthRequestValidatorAdapter::new(AuthClient::new(&self.client)),
        ))
    }

    /// Run the Jobs admin service loops and request handler until shutdown.
    pub async fn run(&self) -> Result<(), ServerError> {
        self.run_with_mode(JobsServiceMode::Owner).await
    }

    /// Run the Jobs admin service with an explicit loop ownership mode.
    pub async fn run_with_mode(&self, mode: JobsServiceMode) -> Result<(), ServerError> {
        let (resources, router) = build_jobs_runtime(self.client.nats().clone(), self.binding())?;
        let host = bootstrap_service_host(
            SERVICE_NAME,
            self.binding.bootstrap_binding(),
            router,
            AuthRequestValidatorAdapter::new(AuthClient::new(&self.client)),
        );
        run_jobs_service_runtime(
            self.client.nats().clone(),
            resources,
            mode,
            run_single_subject_service(self.client.nats().clone(), JOBS_RPC_SUBJECT_WILDCARD, host),
        )
        .await
    }
}

fn build_jobs_runtime(
    runtime_client: async_nats::Client,
    binding: &trellis_sdk_core::types::TrellisBindingsGetResponseBinding,
) -> Result<(JobsAdminResources, Router), ServerError> {
    let resources = jobs_admin_resources_from_binding(binding).map_err(map_query_error)?;
    let router = build_router_with_query(JobsKvQuery::new(runtime_client, resources.kv_buckets()));
    Ok((resources, router))
}

async fn run_jobs_service_runtime<F>(
    runtime_client: async_nats::Client,
    resources: JobsAdminResources,
    mode: JobsServiceMode,
    service_run: F,
) -> Result<(), ServerError>
where
    F: std::future::Future<Output = Result<(), ServerError>>,
{
    let mut loops = if mode.starts_runtime_loops() {
        Some(RuntimeLoops::start(runtime_client, &resources).await?)
    } else {
        None
    };

    let result = if let Some(loops_ref) = loops.as_mut() {
        tokio::select! {
            result = service_run => result,
            loop_result = loops_ref.wait_for_failure() => loop_result,
        }
    } else {
        service_run.await
    };

    if let Some(loops) = loops {
        loops.stop().await;
    }
    result
}

fn map_infallible_connect_error<T>(
    result: Result<T, ConnectServiceError<std::convert::Infallible>>,
) -> Result<T, ServerError> {
    result.map_err(|error| match error {
        ConnectServiceError::Connect(never) => match never {},
        ConnectServiceError::Server(error) => error,
    })
}

/// Errors returned while connecting or running the Jobs admin service.
#[derive(Debug, thiserror::Error)]
pub enum JobsServiceError {
    #[error(transparent)]
    Client(#[from] TrellisClientError),
    #[error(transparent)]
    Server(#[from] ServerError),
}

fn build_parts_from_client(
    client: &TrellisClient,
) -> ConnectedServiceParts<
    CoreBootstrapAdapter<CoreClient<'_>>,
    AuthRequestValidatorAdapter<AuthClient<'_>>,
    async_nats::Client,
> {
    ConnectedServiceParts {
        runtime_client: client.nats().clone(),
        core_port: CoreBootstrapAdapter::new(CoreClient::new(client)),
        validator: AuthRequestValidatorAdapter::new(AuthClient::new(client)),
    }
}

fn build_parts_from_clients<Cc, Avc>(
    (runtime_client, core_client, auth_validate_client): (async_nats::Client, Cc, Avc),
) -> ConnectedServiceParts<
    CoreBootstrapAdapter<Cc>,
    AuthRequestValidatorAdapter<Avc>,
    async_nats::Client,
>
where
    Cc: CoreBootstrapClientPort,
    Avc: AuthRequestValidatorClientPort,
{
    ConnectedServiceParts {
        runtime_client,
        core_port: CoreBootstrapAdapter::new(core_client),
        validator: AuthRequestValidatorAdapter::new(auth_validate_client),
    }
}

async fn connect_jobs_service<'meta, Conn, BuildParts, C, V>(
    expected_contract: &'meta trellis_server::BootstrapContractRef,
    connector: Conn,
    build_parts: BuildParts,
) -> Result<ConnectedService<'meta, C::Binding, V, async_nats::Client>, ServerError>
where
    Conn: trellis_server::AsyncConnector<Error = std::convert::Infallible>,
    BuildParts: FnOnce(Conn::Output) -> ConnectedServiceParts<C, V, async_nats::Client>,
    C: trellis_server::CoreBootstrapPort,
    V: trellis_server::RequestValidator,
{
    map_infallible_connect_error(
        connect_bound_service(SERVICE_NAME, expected_contract, connector, build_parts).await,
    )
}

fn bootstrap_connected_jobs_service<'meta, B, V>(
    connected: ConnectedService<'meta, B, V, async_nats::Client>,
) -> Result<ConnectedServiceHostWithValidator<V>, ServerError>
where
    B: BootstrapBindingInfo + AsRef<trellis_sdk_core::types::TrellisBindingsGetResponseBinding>,
    V: trellis_server::RequestValidator,
{
    let (_, router) = build_jobs_runtime(
        connected.runtime_client().clone(),
        connected.binding().as_ref(),
    )?;
    connected.bootstrap(router)
}

/// Bootstrap a Jobs service host from an existing connected Trellis client.
pub async fn bootstrap_jobs_service_host_from_client<'a>(
    client: &'a TrellisClient,
) -> Result<JobsServiceHost<'a>, ServerError> {
    let contract = expected_contract();
    let connected = connect_jobs_service(
        &contract,
        || async move { Ok::<_, std::convert::Infallible>(client) },
        build_parts_from_client,
    )
    .await?;
    bootstrap_connected_jobs_service(connected)
}

/// Bootstrap a Jobs service host from injected core/auth client ports.
pub async fn bootstrap_jobs_service_host_with_clients<Cc, Avc>(
    nats_client: async_nats::Client,
    core_client: Cc,
    auth_validate_client: Avc,
) -> Result<JobsServiceHostWithValidator<Avc>, ServerError>
where
    Cc: CoreBootstrapClientPort,
    Avc: AuthRequestValidatorClientPort,
{
    let contract = expected_contract();
    let connected = connect_jobs_service(
        &contract,
        || async move {
            Ok::<_, std::convert::Infallible>((nats_client, core_client, auth_validate_client))
        },
        build_parts_from_clients,
    )
    .await?;
    bootstrap_connected_jobs_service(connected)
}

async fn run_connected_jobs_service<B, V>(
    connected: ConnectedService<'_, B, V, async_nats::Client>,
    mode: JobsServiceMode,
) -> Result<(), ServerError>
where
    B: BootstrapBindingInfo + AsRef<trellis_sdk_core::types::TrellisBindingsGetResponseBinding>,
    V: trellis_server::RequestValidator,
{
    let (resources, router) = build_jobs_runtime(
        connected.runtime_client().clone(),
        connected.binding().as_ref(),
    )?;
    run_jobs_service_runtime(
        connected.runtime_client().clone(),
        resources,
        mode,
        connected.run(JOBS_RPC_SUBJECT_WILDCARD, router),
    )
    .await
}

/// Run the Jobs admin service from an existing connected Trellis client.
pub async fn run_jobs_service_from_client(client: &TrellisClient) -> Result<(), ServerError> {
    run_jobs_service_from_client_with_mode(client, JobsServiceMode::Owner).await
}

/// Run the Jobs admin service from an existing connected Trellis client with explicit mode.
pub async fn run_jobs_service_from_client_with_mode(
    client: &TrellisClient,
    mode: JobsServiceMode,
) -> Result<(), ServerError> {
    let contract = expected_contract();
    let connected = connect_jobs_service(
        &contract,
        || async move { Ok::<_, std::convert::Infallible>(client) },
        build_parts_from_client,
    )
    .await?;
    run_connected_jobs_service(connected, mode).await
}

/// Run the Jobs admin service from injected runtime/core/auth clients.
pub async fn run_jobs_service_with_clients<Cc, Avc>(
    nats_client: async_nats::Client,
    core_client: Cc,
    auth_validate_client: Avc,
) -> Result<(), ServerError>
where
    Cc: CoreBootstrapClientPort,
    Avc: AuthRequestValidatorClientPort,
{
    run_jobs_service_with_clients_with_mode(
        nats_client,
        core_client,
        auth_validate_client,
        JobsServiceMode::Owner,
    )
    .await
}

/// Run the Jobs admin service from injected runtime/core/auth clients with explicit mode.
pub async fn run_jobs_service_with_clients_with_mode<Cc, Avc>(
    nats_client: async_nats::Client,
    core_client: Cc,
    auth_validate_client: Avc,
    mode: JobsServiceMode,
) -> Result<(), ServerError>
where
    Cc: CoreBootstrapClientPort,
    Avc: AuthRequestValidatorClientPort,
{
    let contract = expected_contract();
    let connected = connect_jobs_service(
        &contract,
        || async move {
            Ok::<_, std::convert::Infallible>((nats_client, core_client, auth_validate_client))
        },
        build_parts_from_clients,
    )
    .await?;
    run_connected_jobs_service(connected, mode).await
}

fn map_query_error(error: JobsQueryError) -> ServerError {
    ServerError::Nats(error.to_string())
}

/// Connect a Jobs admin service client and eagerly resolve its bindings.
pub async fn connect_service(
    opts: ServiceConnectOptions<'_>,
) -> Result<ConnectedJobsService, JobsServiceError> {
    let client = TrellisClient::connect_service(opts).await?;
    let binding = resolve_bootstrap_binding(
        SERVICE_NAME,
        &expected_contract(),
        &CoreBootstrapAdapter::new(CoreClient::new(&client)),
    )
    .await?;
    Ok(ConnectedJobsService::new(client, binding))
}

/// Convenience helper that connects and immediately runs the Jobs admin service.
pub async fn connect_and_run(opts: ServiceConnectOptions<'_>) -> Result<(), JobsServiceError> {
    let connected = connect_service(opts).await?;
    connected.run().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use trellis_client::{ServiceConnectOptions, TrellisClientError};

    use super::{connect_and_run, connect_service, map_runtime_loop_result, JobsServiceMode};

    const VALID_SEED_BASE64URL: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn missing_creds_path() -> String {
        format!(
            "/tmp/trellis-service-jobs-missing-creds-{}",
            std::process::id()
        )
    }

    #[tokio::test]
    async fn connect_service_rejects_invalid_session_seed_before_network() {
        let result = connect_service(ServiceConnectOptions {
            servers: "nats://127.0.0.1:4222",
            sentinel_creds_path: "/tmp/unused-creds-file",
            session_key_seed_base64url: "not-base64url",
            timeout_ms: 1_000,
        })
        .await;

        assert!(matches!(
            result,
            Err(super::JobsServiceError::Client(TrellisClientError::Base64(
                _
            ))) | Err(super::JobsServiceError::Client(
                TrellisClientError::InvalidSeedLen(_)
            ))
        ));
    }

    #[tokio::test]
    async fn connect_service_returns_io_error_for_missing_creds_file() {
        let missing_path = missing_creds_path();
        let result = connect_service(ServiceConnectOptions {
            servers: "nats://127.0.0.1:4222",
            sentinel_creds_path: &missing_path,
            session_key_seed_base64url: VALID_SEED_BASE64URL,
            timeout_ms: 1_000,
        })
        .await;

        assert!(matches!(
            result,
            Err(super::JobsServiceError::Client(TrellisClientError::Io(_)))
        ));
    }

    #[tokio::test]
    async fn connect_and_run_propagates_connect_error() {
        let result = connect_and_run(ServiceConnectOptions {
            servers: "nats://127.0.0.1:4222",
            sentinel_creds_path: "/tmp/unused-creds-file",
            session_key_seed_base64url: "not-base64url",
            timeout_ms: 1_000,
        })
        .await;

        assert!(matches!(
            result,
            Err(super::JobsServiceError::Client(TrellisClientError::Base64(
                _
            ))) | Err(super::JobsServiceError::Client(
                TrellisClientError::InvalidSeedLen(_)
            ))
        ));
    }

    #[test]
    fn jobs_service_mode_controls_background_loop_ownership() {
        assert!(!JobsServiceMode::RpcOnly.starts_runtime_loops());
        assert!(JobsServiceMode::Owner.starts_runtime_loops());
    }

    #[test]
    fn unexpected_clean_runtime_loop_exit_is_treated_as_failure() {
        let error =
            map_runtime_loop_result("projector", Ok(())).expect_err("clean exit should fail");
        assert!(error
            .to_string()
            .contains("projector loop exited unexpectedly"));
    }
}
