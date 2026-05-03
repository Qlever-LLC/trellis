//! Service bootstrap helpers for the Jobs admin service.

use std::path::Path;

use trellis_auth::AuthClient;
use trellis_auth_adapters::{AuthRequestValidatorAdapter, AuthRequestValidatorClientPort};
use trellis_client::{ServiceConnectOptions, TrellisClient, TrellisClientError};
use trellis_core_bootstrap::{CoreBootstrapAdapter, CoreBootstrapBinding, CoreBootstrapClientPort};
use trellis_sdk_core::{types::TrellisBindingsGetResponseBinding, CoreClient};
use trellis_service::{
    bootstrap_service_host, connect_service as connect_bound_service, run_multi_subject_service,
    BootstrapBindingInfo, ConnectServiceError, ConnectedService, ConnectedServiceHostWithValidator,
    ConnectedServiceParts, Router, ServerError,
};

use crate::advisory::{start_advisory_loop, AdvisoryHandle};
use crate::contract::{expected_contract, JOBS_RPC_SUBJECTS, SERVICE_NAME};
use crate::janitor::{start_janitor_loop, JanitorHandle};
use crate::projector::{start_jobs_projector, JobsProjectorHandle};
use crate::query::{
    jobs_admin_resources_from_binding, JobsAdminResources, JobsQuery, JobsQueryError,
};
use crate::router::build_router_with_query;
use crate::storage::SqliteJobsStore;
use crate::worker_presence::{start_worker_presence_projector, WorkerPresenceProjectorHandle};

const DEFAULT_JOBS_DB_PATH: &str = "/var/lib/trellis/jobs.sqlite";

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

#[derive(Debug, Clone, Copy)]
enum RuntimeLoopName {
    Advisory,
    Janitor,
    Projector,
    WorkerPresence,
}

impl RuntimeLoopName {
    fn as_str(self) -> &'static str {
        match self {
            Self::Advisory => "advisory",
            Self::Janitor => "janitor",
            Self::Projector => "projector",
            Self::WorkerPresence => "worker presence",
        }
    }
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
        store: SqliteJobsStore,
    ) -> Result<Self, ServerError> {
        let advisory = start_advisory_loop(
            nats.clone(),
            store.clone(),
            resources.jobs_advisories_stream.clone(),
        )
        .await?;
        let janitor = start_janitor_loop(
            nats.clone(),
            store.clone(),
            std::time::Duration::from_secs(30),
        )
        .await?;
        let projector =
            start_jobs_projector(nats.clone(), store.clone(), resources.jobs_stream.clone())
                .await?;
        let worker_presence =
            start_worker_presence_projector(nats.clone(), resources.jobs_stream.clone(), store)
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
        let (loop_name, result) = tokio::select! {
            result = self.projector.wait() => (RuntimeLoopName::Projector, result),
            result = self.worker_presence.wait() => (RuntimeLoopName::WorkerPresence, result),
            result = self.janitor.wait() => (RuntimeLoopName::Janitor, result),
            result = self.advisory.wait() => (RuntimeLoopName::Advisory, result),
        };

        match loop_name {
            RuntimeLoopName::Advisory => self.advisory.discard_completed(),
            RuntimeLoopName::Janitor => self.janitor.discard_completed(),
            RuntimeLoopName::Projector => self.projector.discard_completed(),
            RuntimeLoopName::WorkerPresence => self.worker_presence.discard_completed(),
        }

        map_runtime_loop_result(loop_name.as_str(), result)
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
    jobs_store: SqliteJobsStore,
}

impl ConnectedJobsService {
    /// Construct a connected Jobs service wrapper from a Trellis client and binding.
    pub fn new(client: TrellisClient, binding: CoreBootstrapBinding) -> Result<Self, ServerError> {
        Ok(Self {
            client,
            binding,
            jobs_store: open_jobs_store_from_env()?,
        })
    }

    /// Return the resolved bindings snapshot for this service.
    pub fn binding(&self) -> &trellis_sdk_core::types::TrellisBindingsGetResponseBinding {
        self.binding.as_ref()
    }

    /// Bootstrap an authenticated service host without starting background loops.
    pub async fn bootstrap(&self) -> Result<JobsServiceHost<'_>, ServerError> {
        let (_, router, _) = build_jobs_runtime(
            self.client.nats().clone(),
            self.binding(),
            self.jobs_store.clone(),
        )?;
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
        let (resources, router, store) = build_jobs_runtime(
            self.client.nats().clone(),
            self.binding(),
            self.jobs_store.clone(),
        )?;
        let host = bootstrap_service_host(
            SERVICE_NAME,
            self.binding.bootstrap_binding(),
            router,
            AuthRequestValidatorAdapter::new(AuthClient::new(&self.client)),
        );
        run_jobs_service_runtime(
            self.client.nats().clone(),
            resources,
            store,
            mode,
            run_multi_subject_service(self.client.nats().clone(), JOBS_RPC_SUBJECTS, host),
        )
        .await
    }
}

fn build_jobs_runtime(
    runtime_client: async_nats::Client,
    binding: &trellis_sdk_core::types::TrellisBindingsGetResponseBinding,
    store: SqliteJobsStore,
) -> Result<(JobsAdminResources, Router, SqliteJobsStore), ServerError> {
    let resources = jobs_admin_resources_from_binding(binding).map_err(map_query_error)?;
    let router = build_router_with_query(JobsQuery::with_store(runtime_client, store.clone()));
    Ok((resources, router, store))
}

fn open_jobs_store_from_env() -> Result<SqliteJobsStore, ServerError> {
    let db_path =
        std::env::var("TRELLIS_JOBS_DB_PATH").unwrap_or_else(|_| DEFAULT_JOBS_DB_PATH.to_string());
    open_jobs_store(Path::new(&db_path))
}

fn open_jobs_store(path: &Path) -> Result<SqliteJobsStore, ServerError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|error| {
            ServerError::Nats(format!(
                "failed to create Jobs SQLite projection directory '{}': {error}",
                parent.display()
            ))
        })?;
    }

    SqliteJobsStore::open(path).map_err(|error| {
        ServerError::Nats(format!(
            "failed to open Jobs SQLite projection at '{}': {error}",
            path.display()
        ))
    })
}

async fn run_jobs_service_runtime<F>(
    runtime_client: async_nats::Client,
    resources: JobsAdminResources,
    store: SqliteJobsStore,
    mode: JobsServiceMode,
    service_run: F,
) -> Result<(), ServerError>
where
    F: std::future::Future<Output = Result<(), ServerError>>,
{
    let mut loops = if mode.starts_runtime_loops() {
        Some(RuntimeLoops::start(runtime_client, &resources, store).await?)
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
    expected_contract: &'meta trellis_service::BootstrapContractRef,
    connector: Conn,
    build_parts: BuildParts,
) -> Result<ConnectedService<'meta, C::Binding, V, async_nats::Client>, ServerError>
where
    Conn: trellis_service::AsyncConnector<Error = std::convert::Infallible>,
    BuildParts: FnOnce(Conn::Output) -> ConnectedServiceParts<C, V, async_nats::Client>,
    C: trellis_service::CoreBootstrapPort,
    V: trellis_service::RequestValidator,
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
    V: trellis_service::RequestValidator,
{
    let (_, router, _) = build_jobs_runtime(
        connected.runtime_client().clone(),
        connected.binding().as_ref(),
        open_jobs_store_from_env()?,
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
    V: trellis_service::RequestValidator,
{
    let (resources, router, store) = build_jobs_runtime(
        connected.runtime_client().clone(),
        connected.binding().as_ref(),
        open_jobs_store_from_env()?,
    )?;
    run_jobs_service_runtime(
        connected.runtime_client().clone(),
        resources,
        store,
        mode,
        {
            let runtime_client = connected.runtime_client().clone();
            let host = connected.bootstrap(router)?;
            run_multi_subject_service(runtime_client, JOBS_RPC_SUBJECTS, host)
        },
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
    ServerError::Nats(format!("jobs query failed: {error}"))
}

/// Connect a Jobs admin service client and eagerly resolve its bindings.
pub async fn connect_service(
    opts: ServiceConnectOptions<'_>,
) -> Result<ConnectedJobsService, JobsServiceError> {
    let client = TrellisClient::connect_service(opts).await?;
    let binding = service_bootstrap_binding(&client)?;
    ConnectedJobsService::new(client, binding).map_err(JobsServiceError::Server)
}

fn service_bootstrap_binding(client: &TrellisClient) -> Result<CoreBootstrapBinding, ServerError> {
    let binding = client.service_bootstrap_binding().cloned().ok_or_else(|| {
        ServerError::Nats("service bootstrap response did not include bindings".into())
    })?;
    serde_json::from_value::<TrellisBindingsGetResponseBinding>(binding)
        .map(CoreBootstrapBinding::new)
        .map_err(|error| ServerError::Nats(format!("invalid service bootstrap binding: {error}")))
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

    #[tokio::test]
    async fn connect_service_rejects_invalid_session_seed_before_network() {
        let result = connect_service(ServiceConnectOptions {
            trellis_url: "http://127.0.0.1:1",
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
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
    async fn connect_service_returns_bootstrap_error_for_invalid_trellis_url() {
        let result = connect_service(ServiceConnectOptions {
            trellis_url: "not a url",
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
            session_key_seed_base64url: VALID_SEED_BASE64URL,
            timeout_ms: 1_000,
        })
        .await;

        assert!(matches!(
            result,
            Err(super::JobsServiceError::Client(
                TrellisClientError::Bootstrap(_)
            ))
        ));
    }

    #[tokio::test]
    async fn connect_and_run_propagates_connect_error() {
        let result = connect_and_run(ServiceConnectOptions {
            trellis_url: "http://127.0.0.1:1",
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
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
