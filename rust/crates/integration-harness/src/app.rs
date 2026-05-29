use std::collections::BTreeSet;

use miette::{miette, IntoDiagnostic, Result};

use crate::admin::{run_admin_api_fixture, run_password_change_fixture};
use crate::app_identity_approval::run_app_identity_approval_fixture;
use crate::browser::{complete_admin_bootstrap, complete_local_login, BrowserContainer};
use crate::catalog_authority::{
    run_catalog_authority_fixture, verify_catalog_authority_persistence_after_restart,
    CatalogAuthorityPersistenceCheck,
};
use crate::cli::{IntegrationArgs, ListCommand};
use crate::container::{ContainerBackend, IntegrationWorkdir};
use crate::device_activation::run_device_activation_fixture;
use crate::events::run_events_fixture;
use crate::feeds::run_feeds_fixture;
use crate::fixture::{
    integration_fixtures, print_fixtures, select_run_fixtures, write_fixture_junit,
    write_fixture_reports, FixtureRunReport,
};
use crate::health::run_health_fixture;
use crate::jobs::run_jobs_fixture;
use crate::nats::{
    assert_jobs_shared_streams, ensure_event_stream, ensure_jobs_shared_streams, NatsContainer,
};
use crate::operations::run_operations_fixture;
use crate::optional_uses::run_optional_uses_fixture;
use crate::portal::build_login_portal;
use crate::process::{CommandSpec, ProcessRunner};
use crate::report::{
    known_integration_failures, print_known_failures, print_required_coverage,
    required_integration_coverage, KnownFailure, RequiredCoverage,
};
use crate::resources::run_resources_fixture;
use crate::rpc::{reauth_contract, run_rpc_fixture};
use crate::runtime::{extract_bootstrap_url_from_log, reserve_local_port, TrellisRuntime};
use crate::service_approval::run_service_approval_fixture;
use crate::state::run_state_fixture;
use crate::transfer::run_transfer_fixture;
use serde_json::to_string;
use tracing::info;
use tracing_subscriber::EnvFilter;
use trellis::contracts::{use_contract, ContractKind, ContractManifestBuilder};
use trellis_local_bootstrap::{
    generate_local_trellis_bootstrap, ContainerRuntime, LocalTrellisBootstrapOptions,
};

pub(crate) fn admin_setup_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-agent@v1",
        "Trellis Integration Agent",
        "Verify delegated Rust agent login and admin-managed integration fixtures.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call([
            "Auth.Capabilities.List",
            "Auth.CapabilityGroups.Delete",
            "Auth.CapabilityGroups.Get",
            "Auth.CapabilityGroups.List",
            "Auth.CapabilityGroups.Put",
            "Auth.Connections.List",
            "Auth.Deployments.Create",
            "Auth.Deployments.Disable",
            "Auth.Deployments.Enable",
            "Auth.Deployments.List",
            "Auth.DeploymentAuthority.AcceptMigration",
            "Auth.DeploymentAuthority.AcceptUpdate",
            "Auth.DeploymentAuthority.Get",
            "Auth.DeploymentAuthority.List",
            "Auth.DeploymentAuthority.Plan",
            "Auth.DeploymentAuthority.Reconcile",
            "Auth.Health",
            "Auth.IdentityGrants.List",
            "Auth.Identities.List",
            "Auth.IdentityGrants.Revoke",
            "Auth.Devices.List",
            "Auth.Devices.Provision",
            "Auth.Portals.Get",
            "Auth.Portals.List",
            "Auth.Portals.Put",
            "Auth.Portals.Remove",
            "Auth.Portals.LoginSettings.Get",
            "Auth.Portals.Routes.Put",
            "Auth.Portals.Routes.Remove",
            "Auth.ServiceInstances.List",
            "Auth.ServiceInstances.Provision",
            "Auth.Sessions.List",
            "Auth.Sessions.Logout",
            "Auth.Sessions.Me",
            "Auth.UserIdentities.List",
            "Auth.Users.Get",
            "Auth.Users.List",
            "Auth.Users.Password.Change",
            "Auth.Users.Update",
        ]),
    )
    .use_ref(
        "core",
        use_contract("trellis.core@v1").with_rpc_call([
            "Trellis.Catalog",
            "Trellis.Contract.Get",
            "Trellis.Surface.Status",
        ]),
    )
    .build()
    .map_err(|error| miette!("failed to build integration admin setup contract: {error}"))?;

    to_string(&manifest)
        .map_err(|error| miette!("failed to serialize integration admin setup contract: {error}"))
}

/// Run the Trellis integration harness using the supplied prepare workflow hook.
pub fn run(args: IntegrationArgs, prepare: impl FnOnce() -> Result<()>) -> Result<()> {
    init_tracing();
    let runner = IntegrationRunner::new(args);
    runner.run(prepare)
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("trellis_integration_harness=info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(std::io::stderr)
        .try_init();
}

#[derive(Debug)]
struct IntegrationRunner {
    args: IntegrationArgs,
    process_runner: ProcessRunner,
}

impl IntegrationRunner {
    fn new(args: IntegrationArgs) -> Self {
        Self {
            args,
            process_runner: ProcessRunner,
        }
    }

    fn run(&self, prepare: impl FnOnce() -> Result<()>) -> Result<()> {
        let runtime = tokio::runtime::Runtime::new()
            .map_err(|error| miette!("failed to create integration async runtime: {error}"))?;
        runtime.block_on(self.run_async(prepare))
    }

    async fn run_async(&self, prepare: impl FnOnce() -> Result<()>) -> Result<()> {
        let known_failures = known_integration_failures();
        let required_coverage = required_integration_coverage();
        if self.report_inventory(&known_failures, &required_coverage)? {
            return Ok(());
        }
        let run_args = self
            .args
            .run_args()
            .ok_or_else(|| miette!("integration command is not runnable"))?;
        let selected_fixtures = select_run_fixtures(run_args)?;

        if run_args.skip_prepare {
            info!("integration preflight: skipping prepare workflow");
        } else {
            prepare()?;
        }
        let workdir = IntegrationWorkdir::create(run_args.keep_workdir)?;
        let container_runtime_name = self.detect_container_runtime()?;
        let container_backend = ContainerBackend::new(container_runtime_name);
        info!(
            "integration preflight: using {container_runtime_name} for rootless NATS/Trellis stack containers"
        );
        info!(
            "integration preflight: temporary workdir {}",
            workdir.path().display()
        );
        if workdir.keep() {
            info!("integration preflight: preserving temporary workdir");
        }
        let browser_artifact_dir = workdir.path().join("browser-artifacts");
        std::env::set_var(
            "TRELLIS_INTEGRATION_BROWSER_ARTIFACT_DIR",
            &browser_artifact_dir,
        );
        info!(
            "integration preflight: browser failure artifacts {}",
            browser_artifact_dir.display()
        );
        let trellis_port = reserve_local_port()?;
        let browser = BrowserContainer::start(&self.process_runner, container_backend).await?;
        let browser_trellis_origin = browser.trellis_origin(trellis_port);
        info!(
            "integration preflight: browser WebDriver {}",
            browser.webdriver_url()
        );
        info!("integration preflight: browser Trellis origin {browser_trellis_origin}");
        let mut bootstrap_options = LocalTrellisBootstrapOptions::new(workdir.path());
        bootstrap_options.container_runtime = container_runtime(container_runtime_name)?;
        bootstrap_options.trellis_port = trellis_port;
        bootstrap_options.public_origin = browser_trellis_origin.clone();
        bootstrap_options.force = true;
        let manifest = generate_local_trellis_bootstrap(&bootstrap_options)
            .map_err(|error| miette!("failed to generate local Trellis bootstrap: {error}"))?;
        let nats_manifest_path = workdir.path().join(&manifest.paths.nats_manifest);
        let nats_dir = nats_manifest_path
            .parent()
            .ok_or_else(|| miette!("bootstrap NATS manifest path has no parent"))?;

        let nats =
            NatsContainer::start(&self.process_runner, container_backend, &workdir, nats_dir)?;
        info!("integration preflight: NATS server {}", nats.server_url());
        info!(
            "integration preflight: NATS websocket {}",
            nats.websocket_url()
        );
        let trellis_creds = manifest
            .nats
            .paths
            .creds
            .get("trellisService")
            .ok_or_else(|| miette!("local NATS manifest is missing trellisService creds"))?;
        ensure_event_stream(&nats.server_url(), &nats_dir.join(trellis_creds)).await?;
        ensure_jobs_shared_streams(&nats.server_url(), &nats_dir.join(trellis_creds)).await?;
        let portal = build_login_portal(&self.process_runner, &workdir, &browser_trellis_origin)?;
        info!(
            "integration preflight: portal build {}",
            portal.build_dir().display()
        );
        let mut trellis_runtime = TrellisRuntime::start(
            &workdir,
            &manifest,
            bootstrap_options.clone(),
            &nats.server_url(),
            &nats.websocket_url(),
            portal.build_dir(),
        )
        .await?;
        info!(
            "integration preflight: Trellis runtime {}",
            trellis_runtime.public_url()
        );
        let bootstrap_url = std::fs::read_to_string(trellis_runtime.stdout_log())
            .map_err(|error| miette!("failed to read Trellis stdout log: {error}"))
            .and_then(|log| extract_bootstrap_url_from_log(&log))?;
        info!("integration preflight: completing admin bootstrap through portal");
        let driver = browser.driver().await?;
        let admin_result = complete_admin_bootstrap(
            &driver,
            &bootstrap_url,
            "admin",
            "trellis-admin-password",
            "Trellis Admin",
            "admin@example.test",
        )
        .await;
        let quit_result = driver
            .quit()
            .await
            .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
        admin_result?;
        quit_result?;
        info!("integration preflight: admin bootstrap completed through portal");

        let host_trellis_origin = format!("http://127.0.0.1:{trellis_port}");
        info!("integration preflight: starting delegated Rust agent login");
        let admin_setup_contract_json = admin_setup_contract_json()?;
        let challenge = trellis::auth::start_agent_login(&trellis::auth::StartAgentLoginOpts {
            trellis_url: &host_trellis_origin,
            contract_json: &admin_setup_contract_json,
        })
        .await
        .into_diagnostic()?;
        let login_url = challenge.login_url().to_string();
        let driver = browser.driver().await?;
        let login_result =
            complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
        let quit_result = driver
            .quit()
            .await
            .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
        login_result?;
        quit_result?;
        let outcome = challenge
            .complete(&host_trellis_origin)
            .await
            .into_diagnostic()?;
        if outcome.user.identity.subject != "admin" {
            return Err(miette!(
                "delegated Rust agent login returned non-admin identity `{}`",
                outcome.user.identity.subject
            ));
        }
        info!(
            "integration preflight: delegated Rust agent login returned admin userId={}",
            outcome.user.user_id
        );
        let mut reports = Vec::new();
        let mut catalog_authority_persistence_check: Option<CatalogAuthorityPersistenceCheck> =
            None;
        let mut executed_runner_ids = BTreeSet::new();
        for fixture in &selected_fixtures {
            if !executed_runner_ids.insert(fixture.runner_id) {
                continue;
            }

            info!(
                fixture.id,
                fixture.title,
                fixture.runner_id,
                fixture.runner_title,
                "integration fixture starting"
            );
            let passing_cases = match fixture.runner_id {
                "admin-api" => {
                    run_admin_api_fixture(&host_trellis_origin, &outcome, &browser).await?
                }
                "device-activation" => {
                    run_device_activation_fixture(&host_trellis_origin, &outcome, &browser).await?
                }
                "rpc" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_rpc_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "service-approval" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_service_approval_fixture(&host_trellis_origin, &admin_login, &browser)
                        .await?
                }
                "app-identity-approval" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_app_identity_approval_fixture(
                        &host_trellis_origin,
                        &browser_trellis_origin,
                        &admin_login,
                        &browser,
                    )
                    .await?
                }
                "optional-uses" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_optional_uses_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "operations" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_operations_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "events" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_events_fixture(
                        &host_trellis_origin,
                        &admin_login,
                        &browser,
                        &nats.server_url(),
                        &nats_dir.join(trellis_creds),
                    )
                    .await?
                }
                "health" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_health_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "state" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_state_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "transfer" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_transfer_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "feeds" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_feeds_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "resources" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_resources_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "jobs" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_jobs_fixture(&host_trellis_origin, &admin_login, &browser).await?
                }
                "catalog-authority" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    let (passing_cases, persistence_check) =
                        run_catalog_authority_fixture(&host_trellis_origin, &admin_login, &browser)
                            .await?;
                    catalog_authority_persistence_check = Some(persistence_check);
                    passing_cases
                }
                "catalog-authority-restart" => {
                    let persistence_check = catalog_authority_persistence_check.as_ref().ok_or_else(|| {
                        miette!(
                            "catalog-authority-restart requires catalog-authority to run first so it can create the persistence check"
                        )
                    })?;
                    assert_jobs_shared_streams(&nats.server_url(), &nats_dir.join(trellis_creds))
                        .await?;
                    info!("integration preflight: shared Jobs streams are present");
                    info!("integration preflight: restarting Trellis runtime for catalog authority persistence check");
                    drop(trellis_runtime);
                    trellis_runtime = TrellisRuntime::start(
                        &workdir,
                        &manifest,
                        bootstrap_options.clone(),
                        &nats.server_url(),
                        &nats.websocket_url(),
                        portal.build_dir(),
                    )
                    .await?;
                    info!(
                        "integration preflight: Trellis runtime restarted {}",
                        trellis_runtime.public_url()
                    );
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    verify_catalog_authority_persistence_after_restart(
                        &admin_login,
                        persistence_check,
                    )
                    .await?
                }
                "password-change" => {
                    let admin_login = fresh_admin_login(
                        &outcome,
                        &admin_setup_contract_json,
                        &host_trellis_origin,
                        &browser,
                    )
                    .await?;
                    run_password_change_fixture(&admin_login).await?
                }
                other => {
                    return Err(miette!(
                        "unsupported integration fixture runner id `{other}`"
                    ))
                }
            };
            info!(
                fixture.id,
                fixture.title, passing_cases, "integration fixture passed"
            );
            let selected_fixture_ids = selected_fixtures
                .iter()
                .filter(|selected| selected.runner_id == fixture.runner_id)
                .map(|selected| selected.id)
                .collect();
            reports.push(FixtureRunReport::new(
                fixture,
                passing_cases,
                selected_fixture_ids,
            ));
        }

        let passing_cases: usize = reports.iter().map(|report| report.cases).sum();
        write_fixture_reports(run_args.format, &reports);
        if let Some(junit_path) = &run_args.junit {
            write_fixture_junit(junit_path, &reports)?;
            eprintln!(
                "integration result: wrote JUnit report {}",
                junit_path.display()
            );
        }
        print_required_coverage(&required_coverage);
        print_known_failures(&known_failures);
        eprintln!(
            "integration result: {} passing case(s) across {} fixture(s), {} required coverage area(s), {} known failing case(s)",
            passing_cases,
            reports.len(),
            required_coverage.len(),
            known_failures.len()
        );

        Ok(())
    }

    fn report_inventory(
        &self,
        known_failures: &[KnownFailure],
        required_coverage: &[RequiredCoverage],
    ) -> Result<bool> {
        match self.args.list_target() {
            Some(ListCommand::Coverage) => {
                print_required_coverage(required_coverage);
                return Ok(true);
            }
            Some(ListCommand::Fixtures) => {
                print_fixtures(&integration_fixtures());
                return Ok(true);
            }
            Some(ListCommand::KnownFailures) => {
                print_known_failures(known_failures);
                return Ok(true);
            }
            None => {}
        }

        let run_args = self
            .args
            .run_args()
            .ok_or_else(|| miette!("integration command is not runnable"))?;
        if run_args.strict_known_failures && !known_failures.is_empty() {
            print_known_failures(known_failures);
            return Err(miette!(
                "integration suite has {} known failing case(s)",
                known_failures.len()
            ));
        }

        Ok(false)
    }

    fn detect_container_runtime(&self) -> Result<&'static str> {
        for runtime in ["podman", "docker"] {
            let spec = CommandSpec::new(runtime).arg("--version");
            match self.process_runner.status(&spec) {
                Ok(status) if status.success() => return Ok(runtime),
                Ok(_) | Err(_) => {}
            }
        }

        Err(miette!(
            "integration requires podman or docker; local nats-server is intentionally not used"
        ))
    }
}

async fn fresh_admin_login(
    outcome: &trellis::auth::AdminLoginOutcome,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<trellis::auth::AdminLoginOutcome> {
    reauth_contract(&outcome.state, contract_json, trellis_url, browser).await
}

fn container_runtime(runtime: &str) -> Result<ContainerRuntime> {
    match runtime {
        "podman" => Ok(ContainerRuntime::Podman),
        "docker" => Ok(ContainerRuntime::Docker),
        other => Err(miette!("unsupported container runtime `{other}`")),
    }
}
